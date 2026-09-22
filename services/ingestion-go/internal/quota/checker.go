package quota

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Tracks monthly event usage in Redis for fast ingest-time checks.
// Redis is the hard gate; Postgres usage_counters are billing/display truth
// reconciled from ClickHouse by the scheduled metering job.
type Checker struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Checker {
	return &Checker{rdb: rdb}
}

func periodKey(workspaceID string) string {
	period := time.Now().UTC().Format("2006-01")
	return fmt.Sprintf("usage:%s:%s", workspaceID, period)
}

// tryReserveScript atomically checks quota and increments on success.
// Returns {allowed (0|1), current_after}.
var tryReserveScript = redis.NewScript(`
local key = KEYS[1]
local quota = tonumber(ARGV[1])
local delta = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local current = tonumber(redis.call('GET', key) or '0')
if quota > 0 and (current + delta) > quota then
  return {0, current}
end
local n = redis.call('INCRBY', key, delta)
redis.call('EXPIRE', key, ttl)
return {1, n}
`)

// TryReserve atomically reserves `delta` events against the monthly quota.
// When quota <= 0, quota is treated as unlimited.
func (c *Checker) TryReserve(ctx context.Context, workspaceID string, quota, delta int) (allowed bool, err error) {
	if delta <= 0 {
		return true, nil
	}
	key := periodKey(workspaceID)
	ttl := int((40 * 24 * time.Hour).Seconds())
	res, err := tryReserveScript.Run(ctx, c.rdb, []string{key}, quota, delta, ttl).Int64Slice()
	if err != nil {
		return false, err
	}
	if len(res) < 1 {
		return false, fmt.Errorf("quota script: unexpected reply")
	}
	return res[0] == 1, nil
}

// Release rolls back a prior TryReserve when Kafka publish fails.
func (c *Checker) Release(ctx context.Context, reserved map[string]int) error {
	if len(reserved) == 0 {
		return nil
	}
	pipe := c.rdb.Pipeline()
	for workspaceID, delta := range reserved {
		if delta <= 0 {
			continue
		}
		pipe.DecrBy(ctx, periodKey(workspaceID), int64(delta))
	}
	_, err := pipe.Exec(ctx)
	return err
}

// WouldExceed is kept for diagnostics; prefer TryReserve at ingest.
func (c *Checker) WouldExceed(ctx context.Context, workspaceID string, quota, delta int) (bool, error) {
	if quota <= 0 {
		return false, nil
	}
	n, err := c.rdb.Get(ctx, periodKey(workspaceID)).Int()
	if err == redis.Nil {
		return delta > quota, nil
	}
	if err != nil {
		return false, err
	}
	return n+delta > quota, nil
}

func (c *Checker) Incr(ctx context.Context, workspaceID string, delta int) error {
	key := periodKey(workspaceID)
	pipe := c.rdb.Pipeline()
	pipe.IncrBy(ctx, key, int64(delta))
	pipe.Expire(ctx, key, 40*24*time.Hour)
	_, err := pipe.Exec(ctx)
	return err
}
