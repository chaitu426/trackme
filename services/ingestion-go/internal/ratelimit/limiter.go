package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Fixed-window counter shared across ingestion instances.
type Limiter struct {
	rdb      *redis.Client
	max      int
	windowMs int
}

func New(rdb *redis.Client, max, windowMs int) *Limiter {
	if max <= 0 {
		max = 1000
	}
	if windowMs <= 0 {
		windowMs = 60_000
	}
	return &Limiter{rdb: rdb, max: max, windowMs: windowMs}
}

// Counting and expiry happen in one script, in one round trip. Done as two
// calls, a process dying between INCR and PEXPIRE would leave a counter that
// never expires and blocks that key for good. The PTTL check also repairs any
// counter already in that state.
var hitScript = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`)

// WindowKey is the counter key for a rate-limit key in the window containing now.
// Exported so the combined admission script shares counters with Limiter.
func WindowKey(key string, windowMs int, now time.Time) string {
	return fmt.Sprintf("rl:ingest:%s:%d", key, now.UnixMilli()/int64(windowMs))
}

// Allow records one hit for key and reports whether it is within the limit.
// The error is Redis being unreachable; callers decide whether that means
// "allow" or "refuse".
func (l *Limiter) Allow(ctx context.Context, key string) (bool, error) {
	redisKey := WindowKey(key, l.windowMs, time.Now())

	n, err := hitScript.Run(ctx, l.rdb, []string{redisKey}, l.windowMs).Int64()
	if err != nil {
		return false, err
	}
	return n <= int64(l.max), nil
}
