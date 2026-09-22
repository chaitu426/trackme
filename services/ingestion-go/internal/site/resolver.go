package site

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"sync"
	"time"

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

type Resolver struct {
	pool  *pgxpool.Pool
	mu    sync.RWMutex
	cache map[string]cacheEntry // keyed by public_key_hash
}

type cacheEntry struct {
	site     ResolvedSite
	cachedAt time.Time
}

const cacheTTL = 60 * time.Second
const cacheMax = 5000

const InvalidateChannel = "site:invalidate"

func NewResolver(pool *pgxpool.Pool) *Resolver {
	return &Resolver{pool: pool, cache: make(map[string]cacheEntry)}
}

func HashPublicKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

func (r *Resolver) Resolve(ctx context.Context, publicKey string) (*ResolvedSite, error) {
	hash := HashPublicKey(publicKey)

	r.mu.RLock()
	if entry, ok := r.cache[hash]; ok && time.Since(entry.cachedAt) < cacheTTL {
		site := entry.site
		r.mu.RUnlock()
		return &site, nil
	}
	r.mu.RUnlock()

	var (
		id, workspaceID, domain string
		settingsRaw             []byte
		quota                   int
	)

	err := r.pool.QueryRow(ctx, `
		SELECT s.id::text, s.workspace_id::text, s.domain, s.settings, w.monthly_event_quota
		FROM sites s
		JOIN workspaces w ON w.id = s.workspace_id
		WHERE s.public_key_hash = $1
		LIMIT 1
	`, hash).Scan(&id, &workspaceID, &domain, &settingsRaw, &quota)
	if err != nil {
		return nil, err
	}

	settings := DefaultSettings()
	if len(settingsRaw) > 0 {
		_ = json.Unmarshal(settingsRaw, &settings)
		if settings.RetentionMonths == 0 {
			settings.RetentionMonths = 24
		}
	}

	resolved := ResolvedSite{
		ID:                id,
		WorkspaceID:       workspaceID,
		Domain:            domain,
		Settings:          settings,
		MonthlyEventQuota: quota,
	}

	r.mu.Lock()
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
	r.cache[hash] = cacheEntry{site: resolved, cachedAt: time.Now()}
	r.mu.Unlock()

	return &resolved, nil
}

// InvalidateByHash drops a cached site after settings/signing rotate.
func (r *Resolver) InvalidateByHash(publicKeyHash string) {
	r.mu.Lock()
	delete(r.cache, publicKeyHash)
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
