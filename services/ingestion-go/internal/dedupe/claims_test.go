package dedupe

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newClaims(t *testing.T) (*Claims, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return New(client), server
}

func TestClaimDeduplicatesIDsWithinAndAcrossBatches(t *testing.T) {
	claims, _ := newClaims(t)
	ctx := context.Background()
	ids := []string{"event-a", "event-a", "event-b"}

	first, err := claims.Claim(ctx, ids)
	if err != nil {
		t.Fatal(err)
	}
	if want := []bool{true, false, true}; !equal(first, want) {
		t.Fatalf("first claim = %v, want %v", first, want)
	}

	second, err := claims.Claim(ctx, []string{"event-a", "event-b"})
	if err != nil {
		t.Fatal(err)
	}
	if want := []bool{false, false}; !equal(second, want) {
		t.Fatalf("retry claim = %v, want %v", second, want)
	}
}

func TestConfirmExtendsClaimToRetryWindow(t *testing.T) {
	claims, server := newClaims(t)
	ctx := context.Background()
	if _, err := claims.Claim(ctx, []string{"event-a"}); err != nil {
		t.Fatal(err)
	}
	if err := claims.Confirm(ctx, []string{"event-a"}); err != nil {
		t.Fatal(err)
	}
	if ttl := server.TTL(eventKey("event-a")); ttl < 24*time.Hour {
		t.Fatalf("confirmed claim TTL = %s, want at least 24 hours", ttl)
	}
}

func TestReleaseAllowsRetryAfterFailedPublish(t *testing.T) {
	claims, server := newClaims(t)
	ctx := context.Background()
	if _, err := claims.Claim(ctx, []string{"event-a"}); err != nil {
		t.Fatal(err)
	}
	if err := claims.Release(ctx, []string{"event-a"}); err != nil {
		t.Fatal(err)
	}
	if server.Exists(eventKey("event-a")) {
		t.Fatal("released event claim still exists")
	}
	claimed, err := claims.Claim(ctx, []string{"event-a"})
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != 1 || !claimed[0] {
		t.Fatalf("retry claim = %v, want true", claimed)
	}
}

func TestClaimReportsRedisFailure(t *testing.T) {
	claims, server := newClaims(t)
	server.Close()
	if _, err := claims.Claim(context.Background(), []string{"event-a"}); err == nil {
		t.Fatal("Claim succeeded while Redis was unavailable")
	}
}

func equal(a, b []bool) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
