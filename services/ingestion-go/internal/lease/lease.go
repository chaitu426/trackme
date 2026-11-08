// Package lease admits batches without a Redis round trip per request.
//
// Redis stays the source of truth, but it is consulted per lease, not per request or event:
//
//   - Site rate: every Tick each edge reports the demand it saw for each active site (one
//     pipelined call for all sites) and receives a rate for the next lease period, computed by
//     proportional share over the demand of every edge (Google Doorman's algorithm). The edge
//     enforces it with a local token bucket. If renewal fails the grant expires and the edge
//     falls back to a safe rate (SiteRate/Fleet): limits tighten, they neither vanish nor 503.
//   - Quota: a workspace's monthly counter is withdrawn in chunks that shrink as the remainder
//     shrinks (remaining/(4*Fleet), capped), so large plans cost almost no Redis calls and a
//     nearly exhausted plan is enforced almost exactly. Overshoot is bounded by Fleet x chunk.
//   - Per-IP limit: a local sliding-window counter (Cloudflare's approximation: previous window
//     weighted by the unelapsed fraction, plus the current one). Per edge, so approximate.
//   - Duplicate event ids: a local two-generation fingerprint set. It only has to catch a client
//     retrying shortly after a lost response; anything it misses is absorbed downstream.
package lease

import (
	"context"
	"fmt"
	"hash/maphash"
	"log"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/trackme/ingestion-go/internal/gate"
	"github.com/trackme/ingestion-go/internal/metrics"
	"github.com/trackme/ingestion-go/internal/quota"
)

type Config struct {
	EdgeID        string
	SiteRate      float64       // events/s one site may send across the whole fleet
	BurstSeconds  float64       // token bucket depth, in seconds of rate
	Fleet         int           // expected number of edges
	Window        time.Duration // per-IP sliding window
	Tick          time.Duration // lease renewal period
	LeaseTTL      time.Duration // a grant is honoured this long after its last renewal
	QuotaChunkMax int
	DedupeTTL     time.Duration
	DedupeSlots   int // power of two; fingerprints held per generation
}

func (c Config) withDefaults() Config {
	if c.SiteRate <= 0 {
		c.SiteRate = 2000
	}
	if c.BurstSeconds <= 0 {
		c.BurstSeconds = 5
	}
	if c.Fleet <= 0 {
		c.Fleet = 1
	}
	if c.Window <= 0 {
		c.Window = time.Minute
	}
	if c.Tick <= 0 {
		c.Tick = 2 * time.Second
	}
	if c.LeaseTTL <= 0 {
		c.LeaseTTL = 5 * c.Tick
	}
	if c.QuotaChunkMax <= 0 {
		c.QuotaChunkMax = 10_000
	}
	if c.DedupeTTL <= 0 {
		c.DedupeTTL = 5 * time.Minute
	}
	if c.DedupeSlots <= 0 {
		c.DedupeSlots = 1 << 21
	}
	return c
}

// KEYS[1] site hash {edge -> "demand:expiresMs"}; ARGV: edge, demand, nowMs, ttlMs, siteRate.
// Returns this edge's rate in events/s as a string (Lua truncates numbers to integers).
var grantScript = redis.NewScript(`
local now, G = tonumber(ARGV[3]), tonumber(ARGV[5])
local mine, total, n = tonumber(ARGV[2]), 0, 1
local h = redis.call('HGETALL', KEYS[1])
for i = 1, #h, 2 do
  local d, exp = string.match(h[i + 1], '([^:]+):(%d+)')
  if tonumber(exp) < now then redis.call('HDEL', KEYS[1], h[i])
  elseif h[i] ~= ARGV[1] then total = total + tonumber(d); n = n + 1 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2] .. ':' .. string.format('%.0f', now + tonumber(ARGV[4])))
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]) * 2)
total = total + mine
local floor = G * 0.25 / n  -- every live edge can always start; floors sum to under G/4
local grant
if total * 1.25 <= G then grant = math.max(mine * 1.25, floor)
else grant = math.max(G * mine / total, floor) end
return tostring(math.min(grant, G))
`)

// KEYS[1] usage counter; ARGV: quota, need, fleet, chunkMax, ttl. Returns units withdrawn (0 = denied).
var chunkScript = redis.NewScript(`
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local quota, need = tonumber(ARGV[1]), tonumber(ARGV[2])
local c = tonumber(ARGV[4])
if quota > 0 then
  local remaining = quota - cur
  if remaining < need then return 0 end
  c = math.min(remaining, math.max(need, math.min(math.floor(remaining / (4 * tonumber(ARGV[3]))), c)))
else
  c = math.max(need, c)
end
redis.call('INCRBY', KEYS[1], c)
redis.call('EXPIRE', KEYS[1], ARGV[5])
return c
`)

type bucket struct {
	offered atomic.Int64 // events asked for since the last tick, admitted or not
	demand  float64      // owned by the tick goroutine
	idle    int          // owned by the tick goroutine

	mu      sync.Mutex
	rate    float64
	tokens  float64
	last    time.Time
	expires time.Time
}

func (b *bucket) take(n float64, now time.Time, safe, burst float64) bool {
	b.offered.Add(int64(n))
	b.mu.Lock()
	defer b.mu.Unlock()
	rate := b.rate
	if now.After(b.expires) {
		rate = safe
	}
	b.tokens = min(rate*burst, b.tokens+rate*now.Sub(b.last).Seconds())
	b.last = now
	if b.tokens < n {
		return false
	}
	b.tokens -= n
	return true
}

type Admitter struct {
	rdb *redis.Client
	cfg Config
	now func() time.Time

	sites sync.Map // site id -> *bucket

	qmu      sync.Mutex
	balance  map[string]int // workspace id -> units withdrawn from Redis and not yet spent
	reported map[string]int // what the ledger in Redis currently says; owned by the renew loop
	fleet    atomic.Int64   // live edges as last counted in Redis; 0 until the first count

	ipmu sync.Mutex
	ips  map[string]*ipEntry

	seed  maphash.Seed
	fpmu  sync.Mutex
	cur   []uint64 // open-addressed fingerprints, 0 = empty, tombstone = released
	old   []uint64
	n     int
	since time.Time
}

type ipEntry struct {
	idx        int64
	prev, curr float64
}

const tombstone = ^uint64(0)

// Redis keys shared with the usage-metering janitor (services/scheduled-worker/src/jobs/quota-reclaim.ts).
const (
	// EdgesKey is a ZSET of edge id -> last heartbeat (ms). It is how an edge learns how many
	// edges are alive (fleet size) and how the janitor learns that one died.
	EdgesKey = "lease:edges"
	// LedgerIndex is the SET of workspaces that have a ledger hash.
	LedgerIndex = "lease:q:index"
)

// ledgerKey is a HASH of edge id -> unspent quota units that edge holds. If the edge dies, the
// janitor gives those units back, so a crash no longer charges customers for quota nobody used.
func ledgerKey(workspace string) string { return "lease:q:" + workspace }

// New starts the renewal loop; it stops with ctx.
func New(ctx context.Context, rdb *redis.Client, cfg Config) *Admitter {
	cfg = cfg.withDefaults()
	a := &Admitter{
		rdb: rdb, cfg: cfg, now: time.Now,
		balance: map[string]int{}, reported: map[string]int{}, ips: map[string]*ipEntry{},
		seed: maphash.MakeSeed(), cur: make([]uint64, cfg.DedupeSlots), old: make([]uint64, cfg.DedupeSlots),
	}
	a.since = a.now()
	if err := grantScript.Load(ctx, rdb).Err(); err != nil {
		log.Printf("lease: could not preload the grant script (it loads on first use): %v", err)
	}
	go a.run(ctx)
	return a
}

// fleetSize is the number of live edges as counted in Redis, or the configured size until the
// first count arrives. Discovering it matters: a size configured 5x too small makes every edge
// withdraw 5x too much quota (stranded on idle edges) and allows each site 5x its fair rate.
func (a *Admitter) fleetSize() int {
	if n := a.fleet.Load(); n > 0 {
		return int(n)
	}
	return a.cfg.Fleet
}

func (a *Admitter) safeRate() float64 { return a.cfg.SiteRate / float64(a.fleetSize()) }

func (a *Admitter) bucketFor(site string) *bucket {
	if b, ok := a.sites.Load(site); ok {
		return b.(*bucket)
	}
	// Until the first renewal a site gets its equal share of the fleet budget.
	b, _ := a.sites.LoadOrStore(site, &bucket{rate: a.safeRate(), tokens: a.safeRate() * a.cfg.BurstSeconds, last: a.now()})
	return b.(*bucket)
}

// Admit mirrors gate.Gate.Admit: IP limit, site limit, event-id claims, quota. Quota is counted
// when withdrawn, so Reserved is always 0 and the server never tries to refund it.
func (a *Admitter) Admit(ctx context.Context, req gate.Request) (gate.Result, error) {
	if len(req.Billable) != len(req.EventIDs) {
		return gate.Result{}, fmt.Errorf("lease: %d billable flags for %d events", len(req.Billable), len(req.EventIDs))
	}
	now := a.now()
	if req.ClientIP != "" && req.IPLimit > 0 && !a.allowIP(req.ClientIP, float64(req.IPLimit), now) {
		return gate.Result{Status: gate.IPLimited}, nil
	}
	if !a.bucketFor(req.SiteID).take(float64(len(req.EventIDs)), now, a.safeRate(), a.cfg.BurstSeconds) {
		return gate.Result{Status: gate.SiteLimited}, nil
	}
	claimed := make([]bool, len(req.EventIDs))
	if req.Claim {
		a.claim(req.EventIDs, claimed, now)
	} else {
		for i := range claimed {
			claimed[i] = true
		}
	}
	billable := 0
	for i, ok := range claimed {
		if ok && req.Billable[i] {
			billable++
		}
	}
	if billable > 0 && !a.spend(ctx, req.WorkspaceID, req.Quota, billable) {
		a.Release(ctx, claimedIDs(req.EventIDs, claimed))
		return gate.Result{Status: gate.QuotaExceeded}, nil
	}
	return gate.Result{Status: gate.Admitted, Claimed: claimed}, nil
}

func claimedIDs(ids []string, claimed []bool) []string {
	var out []string
	for i, ok := range claimed {
		if ok {
			out = append(out, ids[i])
		}
	}
	return out
}

// spend takes n units from the workspace's local balance, withdrawing a chunk from Redis when it
// runs short. If Redis is unreachable the events are admitted uncharged and counted: the monthly
// usage-metering job reconciles from ClickHouse, which is cheaper than refusing customer data.
func (a *Admitter) spend(ctx context.Context, ws string, quotaMax, n int) bool {
	a.qmu.Lock()
	if a.balance[ws] >= n {
		a.balance[ws] -= n
		a.qmu.Unlock()
		return true
	}
	a.qmu.Unlock()
	got, err := chunkScript.Run(ctx, a.rdb, []string{quota.PeriodKey(ws)},
		quotaMax, n, a.fleetSize(), a.cfg.QuotaChunkMax, 40*24*3600).Int()
	if err != nil {
		metrics.Default.RedisErrors.WithLabelValues("quota").Inc()
		return true
	}
	if got < n {
		return false
	}
	a.qmu.Lock()
	a.balance[ws] += got - n
	a.qmu.Unlock()
	return true
}

// allowIP is the sliding-window counter: estimate = previous window x unelapsed fraction + current.
func (a *Admitter) allowIP(ip string, limit float64, now time.Time) bool {
	w := a.cfg.Window.Milliseconds()
	ms := now.UnixMilli()
	idx := ms / w
	a.ipmu.Lock()
	defer a.ipmu.Unlock()
	e := a.ips[ip]
	if e == nil {
		if len(a.ips) >= 200_000 { // bounded memory under address spraying; counters restart
			clear(a.ips)
		}
		e = &ipEntry{idx: idx}
		a.ips[ip] = e
	}
	if e.idx != idx {
		e.prev = 0
		if e.idx == idx-1 {
			e.prev = e.curr
		}
		e.curr, e.idx = 0, idx
	}
	if e.prev*(1-float64(ms%w)/float64(w))+e.curr+1 > limit {
		return false
	}
	e.curr++
	return true
}

// Drain returns every workspace's unspent quota to Redis. Without it each restart would strand
// up to one chunk per workspace per edge, and because usage metering only ever raises the Redis
// counter (max(redis, clickhouse)), stranded units would count against customers until month end.
// A crash still strands them; see docs/INGESTION_SCALE_ARCHITECTURE.md section 13.
func (a *Admitter) Drain(ctx context.Context) error {
	a.qmu.Lock()
	owed := a.balance
	a.balance = map[string]int{}
	a.qmu.Unlock()
	pipe := a.rdb.Pipeline()
	for ws, n := range owed {
		if n > 0 {
			pipe.DecrBy(ctx, quota.PeriodKey(ws), int64(n))
		}
		pipe.HDel(ctx, ledgerKey(ws), a.cfg.EdgeID)
	}
	pipe.ZRem(ctx, EdgesKey, a.cfg.EdgeID)
	_, err := pipe.Exec(ctx)
	return err
}

func (a *Admitter) fp(id string) uint64 {
	h := maphash.String(a.seed, id)
	if h == 0 || h == tombstone {
		h = 1
	}
	return h
}

func (a *Admitter) find(set []uint64, fp uint64) (int, bool) {
	mask := uint64(len(set) - 1)
	for i := fp & mask; ; i = (i + 1) & mask {
		switch set[i] {
		case fp:
			return int(i), true
		case 0:
			return int(i), false
		}
	}
}

// claim marks ids as seen; claimed[i] is false for an id already seen in the last one to two
// generations. One lock for the whole request.
func (a *Admitter) claim(ids []string, claimed []bool, now time.Time) {
	a.fpmu.Lock()
	defer a.fpmu.Unlock()
	if now.Sub(a.since) > a.cfg.DedupeTTL || a.n+len(ids) > len(a.cur)*7/10 {
		a.old, a.cur = a.cur, a.old
		clear(a.cur)
		a.n, a.since = 0, now
	}
	for i, id := range ids {
		f := a.fp(id)
		if _, dup := a.find(a.old, f); dup {
			continue
		}
		slot, dup := a.find(a.cur, f)
		if dup {
			continue
		}
		a.cur[slot] = f
		a.n++
		claimed[i] = true
	}
}

// Release forgets ids whose batch was refused, so the client's retry is not mistaken for a duplicate.
func (a *Admitter) Release(_ context.Context, ids []string) error {
	a.fpmu.Lock()
	defer a.fpmu.Unlock()
	for _, id := range ids {
		f := a.fp(id)
		for _, set := range [][]uint64{a.cur, a.old} {
			if i, ok := a.find(set, f); ok {
				set[i] = tombstone
			}
		}
	}
	return nil
}

// Claim and Confirm exist so the Admitter can stand in for the Redis deduper: claims are made in
// Admit, and there is nothing to confirm because a local set has no pending state.
func (a *Admitter) Claim(_ context.Context, ids []string) ([]bool, error) {
	out := make([]bool, len(ids))
	a.claim(ids, out, a.now())
	return out, nil
}
func (a *Admitter) Confirm(context.Context, []string) error { return nil }

func (a *Admitter) run(ctx context.Context) {
	t := time.NewTicker(a.cfg.Tick)
	defer t.Stop()
	var lastWarn time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if err := a.renew(ctx); err != nil {
			metrics.Default.RedisErrors.WithLabelValues("lease").Inc()
			if time.Since(lastWarn) > 10*time.Second {
				lastWarn = time.Now()
				log.Printf("lease renewal failed, sites fall back to the safe rate when grants expire: %v", err)
			}
		}
	}
}

// renew reports demand for every active site and installs the returned rates: one pipelined call.
func (a *Admitter) renew(ctx context.Context) error {
	type item struct {
		b      *bucket
		demand float64
		id     string
	}
	var items []item
	a.sites.Range(func(k, v any) bool {
		b := v.(*bucket)
		off := float64(b.offered.Swap(0))
		b.demand += (off/a.cfg.Tick.Seconds() - b.demand) * 0.5
		if off == 0 && b.demand < 0.5 {
			if b.idle++; b.idle > 30 { // about a minute with no traffic: forget the site
				a.sites.Delete(k)
				return true
			}
		} else {
			b.idle = 0
		}
		items = append(items, item{b, b.demand, k.(string)})
		return true
	})
	nowMs := a.now().UnixMilli()
	ttl := a.cfg.LeaseTTL.Milliseconds()
	pipe := a.rdb.Pipeline()
	// Heartbeat, drop edges silent for six leases (60 s: long enough that a GC pause or a slow Redis
	// call does not look like death, because the janitor gives a dead edge's quota back), count who is left.
	pipe.ZAdd(ctx, EdgesKey, redis.Z{Score: float64(nowMs), Member: a.cfg.EdgeID})
	pipe.ZRemRangeByScore(ctx, EdgesKey, "-inf", strconv.FormatInt(nowMs-6*ttl, 10))
	live := pipe.ZCard(ctx, EdgesKey)
	a.reportLedger(ctx, pipe)
	cmds := make([]*redis.Cmd, len(items))
	for i, it := range items {
		cmds[i] = grantScript.EvalSha(ctx, pipe, []string{"lease:s:" + it.id}, a.cfg.EdgeID, strconv.FormatFloat(it.demand, 'f', 2, 64), nowMs, ttl, a.cfg.SiteRate)
	}
	_, err := pipe.Exec(ctx)
	if n := live.Val(); n > 0 {
		a.fleet.Store(n)
	}
	if err != nil && strings.Contains(err.Error(), "NOSCRIPT") {
		// Redis restarted and lost the script. Reload it; this tick's grants are skipped, which
		// costs nothing because a grant stays valid for several ticks.
		_ = grantScript.Load(ctx, a.rdb).Err()
	}
	for i, cmd := range cmds {
		text, ok := cmd.Val().(string)
		if cmd.Err() != nil || !ok {
			continue
		}
		rate, perr := strconv.ParseFloat(text, 64)
		if perr != nil {
			continue
		}
		b := items[i].b
		b.mu.Lock()
		b.rate, b.expires = rate, a.now().Add(a.cfg.LeaseTTL)
		b.mu.Unlock()
	}
	return err
}

// reportLedger queues the unspent-quota balances that changed since the last report. Only changes
// are sent, so an idle edge adds no Redis traffic. A balance that fell to zero is reported once
// and then forgotten.
func (a *Admitter) reportLedger(ctx context.Context, pipe redis.Pipeliner) {
	a.qmu.Lock()
	held := make(map[string]int, len(a.balance))
	for ws, n := range a.balance {
		held[ws] = n
		if n == 0 {
			delete(a.balance, ws)
		}
	}
	a.qmu.Unlock()
	for ws, n := range held {
		prev, known := a.reported[ws]
		if known && prev == n || !known && n == 0 {
			continue
		}
		pipe.HSet(ctx, ledgerKey(ws), a.cfg.EdgeID, n)
		pipe.Expire(ctx, ledgerKey(ws), 7*24*time.Hour)
		pipe.SAdd(ctx, LedgerIndex, ws)
		if n == 0 {
			delete(a.reported, ws)
		} else {
			a.reported[ws] = n
		}
	}
}
