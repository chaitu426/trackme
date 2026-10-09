package ratelimit

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newLimiter(t *testing.T, max int) (*Limiter, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return New(rdb, max, 60_000), mr
}

func TestAllowsUpToTheLimitThenRefuses(t *testing.T) {
	l, _ := newLimiter(t, 3)
	ctx := context.Background()
	for i := 1; i <= 3; i++ {
		ok, err := l.Allow(ctx, "ip:1.2.3.4")
		if err != nil || !ok {
			t.Fatalf("hit %d: ok=%v err=%v, want allowed", i, ok, err)
		}
	}
	if ok, _ := l.Allow(ctx, "ip:1.2.3.4"); ok {
		t.Fatal("fourth hit must be refused")
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l, _ := newLimiter(t, 1)
	ctx := context.Background()
	if ok, _ := l.Allow(ctx, "ip:a"); !ok {
		t.Fatal("first key refused")
	}
	if ok, _ := l.Allow(ctx, "ip:b"); !ok {
		t.Fatal("a different key must have its own budget")
	}
}

func TestCounterAlwaysGetsAnExpiry(t *testing.T) {
	l, mr := newLimiter(t, 10)
	ctx := context.Background()
	_, _ = l.Allow(ctx, "ip:a")
	keys := mr.Keys()
	if len(keys) != 1 {
		t.Fatalf("keys = %v", keys)
	}
	if ttl := mr.TTL(keys[0]); ttl <= 0 {
		t.Fatalf("ttl = %v, want a positive expiry on the first hit", ttl)
	}
}

// A counter left without an expiry by an earlier crash used to block its key
// forever. The next hit now puts an expiry on it.
func TestCounterWithoutExpiryIsRepaired(t *testing.T) {
	l, mr := newLimiter(t, 10)
	ctx := context.Background()
	_, _ = l.Allow(ctx, "ip:a")
	key := mr.Keys()[0]
	raw := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer raw.Close()
	if err := raw.Persist(ctx, key).Err(); err != nil { // simulate the lost PEXPIRE
		t.Fatal(err)
	}
	if mr.TTL(key) != 0 {
		t.Fatal("test setup: expected no expiry")
	}

	_, _ = l.Allow(ctx, "ip:a")

	if ttl := mr.TTL(key); ttl <= 0 {
		t.Fatalf("ttl = %v, want the stuck counter to get an expiry", ttl)
	}
}

func TestRedisDownIsReportedAsAnErrorNotAsAVerdict(t *testing.T) {
	l, mr := newLimiter(t, 10)
	mr.Close()
	ok, err := l.Allow(context.Background(), "ip:a")
	if err == nil {
		t.Fatalf("ok=%v err=nil, want an error when Redis is unreachable", ok)
	}
}
