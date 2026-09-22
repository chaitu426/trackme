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

func (l *Limiter) Allow(ctx context.Context, key string) (bool, error) {
	bucket := time.Now().UnixMilli() / int64(l.windowMs)
	redisKey := fmt.Sprintf("rl:ingest:%s:%d", key, bucket)

	n, err := l.rdb.Incr(ctx, redisKey).Result()
	if err != nil {
		return false, err
	}
	if n == 1 {
		_ = l.rdb.PExpire(ctx, redisKey, time.Duration(l.windowMs)*time.Millisecond).Err()
	}
	return n <= int64(l.max), nil
}
