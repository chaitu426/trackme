package gate

import (
	"context"
	"strconv"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/trackme/ingestion-go/internal/dedupe"
	"github.com/trackme/ingestion-go/internal/quota"
)

func newGate(t *testing.T, siteLimit int) (*Gate, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return New(rdb, siteLimit, 60_000), mr
}

func req(ids ...string) Request {
	b := make([]bool, len(ids))
	for i := range b {
		b[i] = true
	}
	return Request{SiteID: "s1", WorkspaceID: "w1", Quota: 100, EventIDs: ids, Billable: b, Claim: true}
}

func usage(mr *miniredis.Miniredis) string {
	v, _ := mr.Get(quota.PeriodKey("w1"))
	return v
}

func TestAdmitClaimsAndReservesInOneCall(t *testing.T) {
	g, mr := newGate(t, 10)
	res, err := g.Admit(context.Background(), req("a", "b"))
	if err != nil || res.Status != Admitted || res.Reserved != 2 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if !res.Claimed[0] || !res.Claimed[1] {
		t.Fatalf("claimed=%v", res.Claimed)
	}
	if usage(mr) != "2" {
		t.Fatalf("usage=%q, want 2", usage(mr))
	}
	if !mr.Exists(dedupe.EventKey("a")) {
		t.Fatal("claim key missing")
	}
}

func TestDuplicatesAreDroppedAndNotCharged(t *testing.T) {
	g, mr := newGate(t, 10)
	ctx := context.Background()
	if _, err := g.Admit(ctx, req("a", "b")); err != nil {
		t.Fatal(err)
	}
	res, err := g.Admit(ctx, req("a", "c", "c"))
	if err != nil || res.Status != Admitted {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	want := []bool{false, true, false}
	for i := range want {
		if res.Claimed[i] != want[i] {
			t.Fatalf("claimed=%v want %v", res.Claimed, want)
		}
	}
	if res.Reserved != 1 || usage(mr) != "3" {
		t.Fatalf("reserved=%d usage=%s, want 1 and 3", res.Reserved, usage(mr))
	}
}

func TestOnlyBillableEventsAreCharged(t *testing.T) {
	g, mr := newGate(t, 10)
	r := req("a", "b", "c")
	r.Billable = []bool{true, false, false} // two heuristic bots
	res, err := g.Admit(context.Background(), r)
	if err != nil || res.Reserved != 1 || usage(mr) != "1" {
		t.Fatalf("res=%+v err=%v usage=%s", res, err, usage(mr))
	}
}

func TestQuotaExceededLeavesNoClaimsOrUsage(t *testing.T) {
	g, mr := newGate(t, 10)
	r := req("a", "b", "c")
	r.Quota = 2
	res, err := g.Admit(context.Background(), r)
	if err != nil || res.Status != QuotaExceeded {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	for _, id := range []string{"a", "b", "c"} {
		if mr.Exists(dedupe.EventKey(id)) {
			t.Fatalf("claim for %s left behind after quota rejection, so the retry would be dropped as a duplicate", id)
		}
	}
	if usage(mr) != "" {
		t.Fatalf("usage=%q, want none", usage(mr))
	}
}

func TestQuotaRejectionKeepsClaimsOfPriorRequests(t *testing.T) {
	g, mr := newGate(t, 10)
	ctx := context.Background()
	if _, err := g.Admit(ctx, req("keep")); err != nil {
		t.Fatal(err)
	}
	r := req("keep", "new")
	r.Quota = 1 // already at the limit
	res, _ := g.Admit(ctx, r)
	if res.Status != QuotaExceeded {
		t.Fatalf("status=%v", res.Status)
	}
	if !mr.Exists(dedupe.EventKey("keep")) {
		t.Fatal("must not delete a claim this request did not make")
	}
}

func TestSiteLimitCountsRequestsAndRefusesBeyondIt(t *testing.T) {
	g, mr := newGate(t, 2)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if res, _ := g.Admit(ctx, req("e"+strconv.Itoa(i))); res.Status != Admitted {
			t.Fatalf("request %d: %v", i, res.Status)
		}
	}
	res, err := g.Admit(ctx, req("zz"))
	if err != nil || res.Status != SiteLimited {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if mr.Exists(dedupe.EventKey("zz")) {
		t.Fatal("a rate-limited request must not claim ids")
	}
}

func TestClaimDisabledAdmitsEverythingAndStillCharges(t *testing.T) {
	g, mr := newGate(t, 10)
	r := req("a", "a")
	r.Claim = false
	res, err := g.Admit(context.Background(), r)
	if err != nil || !res.Claimed[0] || !res.Claimed[1] || res.Reserved != 2 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if mr.Exists(dedupe.EventKey("a")) {
		t.Fatal("no claim keys when dedupe is off")
	}
}

func TestUnlimitedQuota(t *testing.T) {
	g, _ := newGate(t, 10)
	r := req("a")
	r.Quota = 0
	if res, err := g.Admit(context.Background(), r); err != nil || res.Status != Admitted {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestIPLimitIsFusedIntoTheSameCall(t *testing.T) {
	g, mr := newGate(t, 100)
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		r := req("ip-" + strconv.Itoa(i))
		r.ClientIP = "198.51.100.7"
		r.IPLimit = 2
		res, err := g.Admit(ctx, r)
		if err != nil || res.Status != Admitted {
			t.Fatalf("request %d: res=%+v err=%v", i, res, err)
		}
	}

	r := req("ip-over")
	r.ClientIP = "198.51.100.7"
	r.IPLimit = 2
	res, err := g.Admit(ctx, r)
	if err != nil || res.Status != IPLimited {
		t.Fatalf("res=%+v err=%v, want IPLimited", res, err)
	}
	if mr.Exists(dedupe.EventKey("ip-over")) {
		t.Fatal("an IP-limited request must not claim ids")
	}
}

func TestRedisDownIsAnError(t *testing.T) {
	g, mr := newGate(t, 10)
	mr.Close()
	if _, err := g.Admit(context.Background(), req("a")); err == nil {
		t.Fatal("want an error so the caller can apply its fail-open policy")
	}
}

func TestMismatchedBillableLengthIsRejected(t *testing.T) {
	g, _ := newGate(t, 10)
	r := req("a", "b")
	r.Billable = []bool{true}
	if _, err := g.Admit(context.Background(), r); err == nil {
		t.Fatal("want error")
	}
}
