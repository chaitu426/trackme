package httpapi

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/trackme/ingestion-go/internal/dedupe"
	"github.com/trackme/ingestion-go/internal/gate"
	"github.com/trackme/ingestion-go/internal/quota"
	"github.com/trackme/ingestion-go/internal/ratelimit"
	"github.com/trackme/ingestion-go/internal/site"
)

// gateRig runs the handler with the real gate, claims and quota on an in-memory
// Redis, so the atomic script and the handler's rollback paths are tested together.
type gateRig struct {
	*rig
	mr    *miniredis.Miniredis
	trips *atomic.Int64 // client round trips to Redis
}

type tripCounter struct{ n *atomic.Int64 }

func (tripCounter) DialHook(next redis.DialHook) redis.DialHook { return next }
func (c tripCounter) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		c.n.Add(1)
		return next(ctx, cmd)
	}
}
func (c tripCounter) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		c.n.Add(1)
		return next(ctx, cmds)
	}
}

func newGateRig(t *testing.T, quotaLimit, siteLimit int) *gateRig {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	trips := &atomic.Int64{}
	rdb.AddHook(tripCounter{n: trips})

	pub := &fakePublisher{}
	srv := &Server{
		Sites: fakeSites{site: &site.ResolvedSite{
			ID: "site-1", WorkspaceID: "ws-1", Domain: "example.com",
			Settings: site.DefaultSettings(), MonthlyEventQuota: quotaLimit,
		}},
		Publisher:        pub,
		Limiter:          ratelimit.New(rdb, 1000, 60_000),
		Quota:            quota.New(rdb),
		Deduper:          dedupe.New(rdb),
		EdgeDedupe:       true,
		Gate:             gate.New(rdb, siteLimit, 60_000),
		MaxBody:          32768,
		TrustedProxyHops: 1,
		QuotaFailOpen:    true,
	}
	return &gateRig{rig: &rig{srv: srv, pub: pub, handler: srv.Handler()}, mr: mr, trips: trips}
}

func (g *gateRig) usage() string {
	v, _ := g.mr.Get(quota.PeriodKey("ws-1"))
	return v
}

func TestGateDropsRetriesWithoutChargingOrRepublishing(t *testing.T) {
	g := newGateRig(t, 100, 100)
	body := batch(withID(1, nil), withID(2, nil))

	first := post(g.handler, "/v1/batch", body, nil)
	second := post(g.handler, "/v1/batch", body, nil)

	if first.Code != http.StatusAccepted || second.Code != http.StatusAccepted {
		t.Fatalf("statuses = %d, %d; want both 202", first.Code, second.Code)
	}
	if len(g.pub.published) != 1 {
		t.Fatalf("publish calls = %d, want 1", len(g.pub.published))
	}
	if g.usage() != "2" {
		t.Fatalf("usage = %q, want 2 (the retry must not be charged)", g.usage())
	}
	resp := decode(t, second)
	if resp["processed"] != float64(2) || resp["duplicates"] != float64(2) {
		t.Fatalf("retry response = %v, want processed=2 duplicates=2", resp)
	}
	if ttl := g.mr.TTL(dedupe.EventKey(withID(1, nil)["eventId"].(string))); ttl < 24*3600 {
		t.Fatalf("confirmed claim ttl = %v, want the 25 h retry window", ttl)
	}
}

func TestGatePublishFailureRollsBackQuotaAndClaimsSoRetrySucceeds(t *testing.T) {
	g := newGateRig(t, 100, 100)
	g.pub.err = errors.New("kafka unavailable")
	body := batch(withID(1, nil))

	if w := post(g.handler, "/v1/batch", body, nil); w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	if got := g.usage(); got != "0" {
		t.Fatalf("usage = %q, want 0 after the failed publish", got)
	}

	g.pub.err = nil
	retry := post(g.handler, "/v1/batch", body, nil)
	if retry.Code != http.StatusAccepted || len(publishedEvents(g.rig)) != 1 {
		t.Fatalf("retry status = %d, published = %d; want 202 and one event", retry.Code, len(publishedEvents(g.rig)))
	}
}

func TestGateQuotaExceededIs402AndLeavesNothingBehind(t *testing.T) {
	g := newGateRig(t, 1, 100)
	w := post(g.handler, "/v1/batch", batch(withID(1, nil), withID(2, nil)), nil)
	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", w.Code)
	}
	if len(g.pub.published) != 0 {
		t.Fatal("nothing may be published when over quota")
	}
	if g.mr.Exists(dedupe.EventKey(withID(1, nil)["eventId"].(string))) {
		t.Fatal("a rejected batch must not leave claims, or the SDK retry is dropped as a duplicate")
	}
}

func TestGateSiteLimitIs429(t *testing.T) {
	g := newGateRig(t, 100, 1)
	if w := post(g.handler, "/v1/batch", batch(withID(1, nil)), nil); w.Code != http.StatusAccepted {
		t.Fatalf("first status = %d", w.Code)
	}
	if w := post(g.handler, "/v1/batch", batch(withID(2, nil)), nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want 429", w.Code)
	}
}

func TestGateRedisOutageFailsOpen(t *testing.T) {
	g := newGateRig(t, 100, 100)
	g.mr.Close()
	w := post(g.handler, "/v1/batch", batch(withID(1, nil)), nil)
	if w.Code != http.StatusAccepted || len(publishedEvents(g.rig)) != 1 {
		t.Fatalf("status = %d, published = %d; want accepted despite Redis being down", w.Code, len(publishedEvents(g.rig)))
	}
}

func TestGateRedisOutageCanFailClosed(t *testing.T) {
	g := newGateRig(t, 100, 100)
	g.srv.QuotaFailOpen = false
	g.mr.Close()
	if w := post(g.handler, "/v1/batch", batch(withID(1, nil)), nil); w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 when fail-open is off", w.Code)
	}
}

func TestGateUsesFewerRedisCommandsThanTheLegacyPath(t *testing.T) {
	g := newGateRig(t, 100, 100)
	post(g.handler, "/v1/batch", batch(withID(1, nil)), nil) // warm the script cache

	before := g.trips.Load()
	post(g.handler, "/v1/batch", batch(withID(2, nil), withID(3, nil), withID(4, nil)), nil)
	gateCalls := g.trips.Load() - before

	// IP limit + the gate + confirm. The legacy path adds a site-limit call, a
	// claim call and a quota call per request.
	if gateCalls > 3 {
		t.Fatalf("redis round trips per request = %d, want <= 3", gateCalls)
	}
}
