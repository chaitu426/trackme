package lease

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/trackme/ingestion-go/internal/gate"
	"github.com/trackme/ingestion-go/internal/quota"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newClock() *clock { return &clock{t: time.Unix(1_800_000_000, 0)} }

// newAdmitter builds an edge against an in-memory Redis. The renewal loop is parked (huge Tick) so tests drive it.
func newAdmitter(t *testing.T, mr *miniredis.Miniredis, c *clock, edge string, mutate func(*Config)) *Admitter {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	cfg := Config{EdgeID: edge, SiteRate: 10, BurstSeconds: 1, Fleet: 1, Window: time.Minute, Tick: time.Hour, QuotaChunkMax: 10_000}
	if mutate != nil {
		mutate(&cfg)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	a := New(ctx, rdb, cfg)
	a.now = c.Now
	a.since = c.Now()
	return a
}

var counter int

func request(site string, n int, billable bool, quotaMax int) gate.Request {
	r := gate.Request{SiteID: site, WorkspaceID: "w1", Quota: quotaMax, Claim: true}
	for i := 0; i < n; i++ {
		counter++
		r.EventIDs = append(r.EventIDs, fmt.Sprintf("%s-%d", site, counter))
		r.Billable = append(r.Billable, billable)
	}
	return r
}

func TestSiteBudgetIsEnforcedLocallyAndRefills(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	a := newAdmitter(t, mr, c, "e1", nil) // 10 events/s, one second of burst
	ctx := context.Background()

	if res, err := a.Admit(ctx, request("s1", 10, false, 0)); err != nil || res.Status != gate.Admitted {
		t.Fatalf("a request within the budget must be admitted: %+v %v", res, err)
	}
	if res, _ := a.Admit(ctx, request("s1", 1, false, 0)); res.Status != gate.SiteLimited {
		t.Fatalf("over budget must be SiteLimited, got %v", res.Status)
	}
	c.Advance(time.Second)
	if res, _ := a.Admit(ctx, request("s1", 10, false, 0)); res.Status != gate.Admitted {
		t.Fatalf("one second later the bucket has refilled, got %v", res.Status)
	}
	if res, _ := a.Admit(ctx, request("other-site", 10, false, 0)); res.Status != gate.Admitted {
		t.Fatal("another site has its own budget")
	}
}

func TestRetriedEventsAreDroppedUntilARefusedBatchReleasesThem(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	a := newAdmitter(t, mr, c, "e1", func(cfg *Config) { cfg.SiteRate = 1000 })
	ctx := context.Background()

	r := gate.Request{SiteID: "s1", WorkspaceID: "w1", EventIDs: []string{"a", "b"}, Billable: []bool{false, false}, Claim: true}
	first, _ := a.Admit(ctx, r)
	if !first.Claimed[0] || !first.Claimed[1] {
		t.Fatalf("first sighting must be claimed: %v", first.Claimed)
	}
	second, _ := a.Admit(ctx, r)
	if second.Claimed[0] || second.Claimed[1] {
		t.Fatalf("a retry of the same ids must be treated as duplicates: %v", second.Claimed)
	}
	_ = a.Release(ctx, []string{"a", "b"}) // the first attempt was refused downstream (for example the queue was full)
	third, _ := a.Admit(ctx, r)
	if !third.Claimed[0] || !third.Claimed[1] {
		t.Fatalf("after release the client's retry must be accepted: %v", third.Claimed)
	}
}

func TestPerAddressLimitUsesASlidingWindow(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	a := newAdmitter(t, mr, c, "e1", func(cfg *Config) { cfg.SiteRate = 100000 })
	ctx := context.Background()
	hit := func() gate.Status {
		r := request("s1", 1, false, 0)
		r.ClientIP, r.IPLimit = "203.0.113.9", 3
		res, _ := a.Admit(ctx, r)
		return res.Status
	}
	for i := 0; i < 3; i++ {
		if got := hit(); got != gate.Admitted {
			t.Fatalf("request %d should pass, got %v", i+1, got)
		}
	}
	if got := hit(); got != gate.IPLimited {
		t.Fatalf("the 4th in the window must be limited, got %v", got)
	}
	c.Advance(2*time.Minute + time.Second) // two whole windows later nothing of the old one remains
	if got := hit(); got != gate.Admitted {
		t.Fatalf("a later window must admit again, got %v", got)
	}
}

func TestQuotaIsWithdrawnInChunksAndEnforcedExactlyAtTheLimit(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	a := newAdmitter(t, mr, c, "e1", func(cfg *Config) { cfg.SiteRate = 100000 })
	ctx := context.Background()
	used := func() string { v, _ := mr.Get(quota.PeriodKey("w1")); return v }

	// quota 100, fleet 1: the first chunk is remaining/4 = 25
	if res, _ := a.Admit(ctx, request("s1", 5, true, 100)); res.Status != gate.Admitted {
		t.Fatalf("got %v", res.Status)
	}
	if used() != "25" {
		t.Fatalf("redis counter = %q, want one chunk of 25", used())
	}
	if res, _ := a.Admit(ctx, request("s1", 5, true, 100)); res.Status != gate.Admitted || used() != "25" {
		t.Fatalf("the next 5 events come from the local balance, with no Redis write; counter = %q", used())
	}
	// 200 events can never fit in what is left (75): refused, and nothing is charged
	big := request("s1", 200, true, 100)
	if res, _ := a.Admit(ctx, big); res.Status != gate.QuotaExceeded {
		t.Fatalf("got %v, want QuotaExceeded", res.Status)
	}
	if used() != "25" {
		t.Fatalf("a refused request must not be charged; counter = %q", used())
	}
	// and its event ids were released, so the client's retry is not mistaken for a duplicate
	retry := gate.Request{SiteID: "s1", WorkspaceID: "w1", Quota: 100, EventIDs: big.EventIDs[:1], Billable: []bool{false}, Claim: true}
	if res, _ := a.Admit(ctx, retry); !res.Claimed[0] {
		t.Fatal("ids of a quota-refused batch must be released")
	}
}

func TestDrainGivesUnspentQuotaBackAndLeavesTheFleet(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	a := newAdmitter(t, mr, c, "e1", func(cfg *Config) { cfg.SiteRate = 100000 })
	ctx := context.Background()
	_, _ = a.Admit(ctx, request("s1", 5, true, 100)) // withdraws 25, spends 5, holds 20
	if err := a.renew(ctx); err != nil {
		t.Fatal(err)
	}
	if got := mr.HGet("lease:q:w1", "e1"); got != "20" {
		t.Fatalf("ledger = %q, want the 20 units this edge holds", got)
	}
	if members, _ := mr.ZMembers(EdgesKey); len(members) != 1 {
		t.Fatalf("the edge should be registered as alive, got %v", members)
	}

	if err := a.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if v, _ := mr.Get(quota.PeriodKey("w1")); v != "5" {
		t.Fatalf("counter after drain = %q, want 5 (only what was actually spent)", v)
	}
	if got := mr.HGet("lease:q:w1", "e1"); got != "" {
		t.Fatalf("the ledger entry must be removed, got %q", got)
	}
	if members, _ := mr.ZMembers(EdgesKey); len(members) != 0 {
		t.Fatalf("the edge must leave the registry, got %v", members)
	}
}

func TestEdgesShareASiteBudgetByDemandAndCountEachOther(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	mk := func(id string) *Admitter {
		return newAdmitter(t, mr, c, id, func(cfg *Config) { cfg.SiteRate = 1000; cfg.Fleet = 1 })
	}
	e1, e2 := mk("e1"), mk("e2")
	ctx := context.Background()
	// both edges see the same heavy demand for the site: 4000 events/s each
	for _, a := range []*Admitter{e1, e2} {
		a.bucketFor("s1")
	}
	for round := 0; round < 3; round++ { // a few rounds so each has seen the other
		for _, a := range []*Admitter{e1, e2} {
			a.bucketFor("s1").offered.Store(int64(4000 * a.cfg.Tick.Seconds()))
			if err := a.renew(ctx); err != nil {
				t.Fatal(err)
			}
		}
	}
	r1, r2 := e1.bucketFor("s1").rate, e2.bucketFor("s1").rate
	if r1 < 400 || r1 > 600 || r2 < 400 || r2 > 600 {
		t.Fatalf("two equally busy edges should split the 1000 events/s budget about evenly, got %.0f and %.0f", r1, r2)
	}
	if r1+r2 > 1000*1.1 {
		t.Fatalf("grants must not exceed the site budget: %.0f", r1+r2)
	}
	if e1.fleetSize() != 2 || e2.fleetSize() != 2 {
		t.Fatalf("fleet = %d/%d, want 2: edges count each other from the registry", e1.fleetSize(), e2.fleetSize())
	}
}

func TestRedisOutageNeitherBlocksNorUnlocksIngestion(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	a := newAdmitter(t, mr, c, "e1", func(cfg *Config) { cfg.SiteRate = 10; cfg.Fleet = 2 }) // safe rate = 5/s, 5 tokens of burst
	ctx := context.Background()
	mr.Close() // Redis disappears

	if err := a.renew(ctx); err == nil {
		t.Fatal("renewal must report the failure")
	}
	res, err := a.Admit(ctx, request("s1", 5, true, 1000))
	if err != nil || res.Status != gate.Admitted {
		t.Fatalf("a Redis outage must not stop ingestion: %+v %v", res, err)
	}
	if res, _ := a.Admit(ctx, request("s1", 1, false, 0)); res.Status != gate.SiteLimited {
		t.Fatalf("and it must not lift the limit either: the safe rate still applies, got %v", res.Status)
	}
}

func TestAnExpiredLeaseFallsBackToTheSafeRate(t *testing.T) {
	mr := miniredis.RunT(t)
	c := newClock()
	a := newAdmitter(t, mr, c, "e1", func(cfg *Config) { cfg.SiteRate = 10; cfg.Fleet = 2; cfg.LeaseTTL = 10 * time.Second })
	b := a.bucketFor("s1")
	b.mu.Lock()
	b.rate, b.expires, b.tokens, b.last = 1000, c.Now().Add(10*time.Second), 1000, c.Now()
	b.mu.Unlock()
	if !b.take(500, c.Now(), a.safeRate(), a.cfg.BurstSeconds) {
		t.Fatal("while the lease is valid its rate applies")
	}
	c.Advance(11 * time.Second) // never renewed
	if b.take(500, c.Now(), a.safeRate(), a.cfg.BurstSeconds) {
		t.Fatal("after expiry only the safe rate (5/s) applies, so 500 events must be refused")
	}
}
