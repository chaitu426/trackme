package site

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Settings struct {
	CollectWebVitals       bool   `json:"collectWebVitals"`
	RespectDoNotTrack      bool   `json:"respectDoNotTrack"`
	AllowLocalhostTracking bool   `json:"allowLocalhostTracking"`
	RetentionMonths        int    `json:"retentionMonths"`
	PublicDashboardEnabled bool   `json:"publicDashboardEnabled"`
	RequireOriginMatch     bool   `json:"requireOriginMatch"`
	RequireConsent         bool   `json:"requireConsent"`
	SigningRequired        bool   `json:"signingRequired"`
	SigningSecret          string `json:"signingSecret,omitempty"`
	SigningSecretHash      string `json:"signingSecretHash,omitempty"`
}

func DefaultSettings() Settings {
	return Settings{
		CollectWebVitals:       true,
		RespectDoNotTrack:      true,
		AllowLocalhostTracking: false,
		RetentionMonths:        24,
		RequireOriginMatch:     true,
		RequireConsent:         false,
		SigningRequired:        false,
	}
}

type ResolvedSite struct {
	ID                string
	WorkspaceID       string
	Domain            string
	Settings          Settings
	MonthlyEventQuota int
}

// ErrNotFound means no site has this public key.
var ErrNotFound = errors.New("site not found")

const (
	cacheTTL    = 60 * time.Second
	cacheMax    = 5000
	negativeTTL = 10 * time.Second // short, so a site created a moment ago starts working quickly
	negativeMax = 10000
	loadTimeout = 5 * time.Second
)

const InvalidateChannel = "site:invalidate"

type loadFunc func(ctx context.Context, publicKeyHash string) (ResolvedSite, error)

type cacheEntry struct {
	site     ResolvedSite
	cachedAt time.Time
}

type inflight struct {
	done chan struct{}
	site ResolvedSite
	err  error
}

// Resolver maps a public site key to its settings. Lookups are cached per key
// hash, concurrent lookups for one key share a single database query, and keys
// that do not exist are remembered briefly so a flood of junk keys cannot turn
// into a flood of queries.
type Resolver struct {
	load loadFunc
	now  func() time.Time

	mu       sync.Mutex
	cache    map[string]cacheEntry // keyed by public_key_hash
	missing  map[string]time.Time  // hashes known not to exist, with when that was learned
	inflight map[string]*inflight
}

func NewResolver(pool *pgxpool.Pool) *Resolver {
	return newResolver(pgLoader(pool), time.Now)
}

func newResolver(load loadFunc, now func() time.Time) *Resolver {
	return &Resolver{
		load:     load,
		now:      now,
		cache:    make(map[string]cacheEntry),
		missing:  make(map[string]time.Time),
		inflight: make(map[string]*inflight),
	}
}

func HashPublicKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

func pgLoader(pool *pgxpool.Pool) loadFunc {
	return func(ctx context.Context, hash string) (ResolvedSite, error) {
		var (
			id, workspaceID, domain string
			settingsRaw             []byte
			quota                   int
		)
		err := pool.QueryRow(ctx, `
			SELECT s.id::text, s.workspace_id::text, s.domain, s.settings, w.monthly_event_quota
			FROM sites s
			JOIN workspaces w ON w.id = s.workspace_id
			WHERE s.public_key_hash = $1
			LIMIT 1
		`, hash).Scan(&id, &workspaceID, &domain, &settingsRaw, &quota)
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolvedSite{}, ErrNotFound
		}
		if err != nil {
			return ResolvedSite{}, err
		}

		settings := DefaultSettings()
		if len(settingsRaw) > 0 {
			_ = json.Unmarshal(settingsRaw, &settings)
			if settings.RetentionMonths == 0 {
				settings.RetentionMonths = 24
			}
		}
		return ResolvedSite{
			ID:                id,
			WorkspaceID:       workspaceID,
			Domain:            domain,
			Settings:          settings,
			MonthlyEventQuota: quota,
		}, nil
	}
}

func (r *Resolver) Resolve(ctx context.Context, publicKey string) (*ResolvedSite, error) {
	hash := HashPublicKey(publicKey)

	r.mu.Lock()
	if site, ok := r.cachedLocked(hash); ok {
		r.mu.Unlock()
		return &site, nil
	}
	if r.missingLocked(hash) {
		r.mu.Unlock()
		return nil, ErrNotFound
	}

	call, running := r.inflight[hash]
	if !running {
		call = &inflight{done: make(chan struct{})}
		r.inflight[hash] = call
	}
	r.mu.Unlock()

	if !running {
		// Own goroutine, so even the caller that started the lookup can give up
		// on its own context without waiting for the database.
		go r.run(hash, call)
	}

	select {
	case <-call.done:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if call.err != nil {
		return nil, call.err
	}
	site := call.site
	return &site, nil
}

// run performs the one shared lookup for hash. It is detached from every
// caller's context so one caller disconnecting does not fail everyone waiting.
func (r *Resolver) run(hash string, call *inflight) {
	ctx, cancel := context.WithTimeout(context.Background(), loadTimeout)
	defer cancel()
	site, err := r.load(ctx, hash)

	r.mu.Lock()
	switch {
	case err == nil:
		r.storeLocked(hash, site)
	case errors.Is(err, ErrNotFound):
		r.storeMissingLocked(hash)
	}
	delete(r.inflight, hash)
	r.mu.Unlock()

	call.site, call.err = site, err
	close(call.done)
}

func (r *Resolver) cachedLocked(hash string) (ResolvedSite, bool) {
	entry, ok := r.cache[hash]
	if !ok || r.now().Sub(entry.cachedAt) >= cacheTTL {
		return ResolvedSite{}, false
	}
	return entry.site, true
}

func (r *Resolver) missingLocked(hash string) bool {
	at, ok := r.missing[hash]
	if !ok {
		return false
	}
	if r.now().Sub(at) >= negativeTTL {
		delete(r.missing, hash)
		return false
	}
	return true
}

func (r *Resolver) storeLocked(hash string, site ResolvedSite) {
	delete(r.missing, hash)
	if len(r.cache) >= cacheMax {
		i := 0
		for k := range r.cache {
			delete(r.cache, k)
			i++
			if i >= cacheMax/2 {
				break
			}
		}
	}
	r.cache[hash] = cacheEntry{site: site, cachedAt: r.now()}
}

// Unknown keys live in their own map with their own cap. When it fills it is
// emptied outright, so an attacker spraying random keys can never evict the
// cached entries of real sites.
func (r *Resolver) storeMissingLocked(hash string) {
	if len(r.missing) >= negativeMax {
		r.missing = make(map[string]time.Time)
	}
	r.missing[hash] = r.now()
}

// InvalidateByHash drops a cached site, and any remembered miss for the same
// key, after settings or signing rotate or a site is created.
func (r *Resolver) InvalidateByHash(publicKeyHash string) {
	r.mu.Lock()
	delete(r.cache, publicKeyHash)
	delete(r.missing, publicKeyHash)
	r.mu.Unlock()
}

// WatchInvalidations listens for site:invalidate pub/sub messages (payload = public_key_hash).
func WatchInvalidations(ctx context.Context, rdb *redis.Client, r *Resolver) {
	pubsub := rdb.Subscribe(ctx, InvalidateChannel)
	ch := pubsub.Channel()
	go func() {
		defer pubsub.Close()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				if msg == nil || msg.Payload == "" {
					continue
				}
				r.InvalidateByHash(msg.Payload)
				log.Printf("site cache invalidated hash=%s…", msg.Payload[:min(12, len(msg.Payload))])
			}
		}
	}()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
