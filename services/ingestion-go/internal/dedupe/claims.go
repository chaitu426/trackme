package dedupe

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

const (
	pendingTTLSeconds   = 120
	confirmedTTLSeconds = 25 * 60 * 60
)

type Claims struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Claims {
	return &Claims{rdb: rdb}
}

var claimScript = redis.NewScript(`
local claimed = {}
for i, key in ipairs(KEYS) do
  local ok = redis.call('SET', key, 'p', 'NX', 'EX', ARGV[1])
  if ok then
    claimed[i] = 1
  else
    claimed[i] = 0
  end
end
return claimed
`)

var confirmScript = redis.NewScript(`
for _, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then
    redis.call('EXPIRE', key, ARGV[1])
  end
end
return 1
`)

var releaseScript = redis.NewScript(`
return redis.call('DEL', unpack(KEYS))
`)

// EventKey is the claim key for an event ID. Exported so the combined admission
// script claims the same keys as Claims.
func EventKey(eventID string) string {
	return eventKey(eventID)
}

func eventKey(eventID string) string {
	return "evt:" + eventID
}

// Claim atomically reserves event IDs for the short publish window. A false
// entry means the ID was already pending or successfully published.
func (c *Claims) Claim(ctx context.Context, eventIDs []string) ([]bool, error) {
	if len(eventIDs) == 0 {
		return nil, nil
	}
	keys := make([]string, len(eventIDs))
	for i, id := range eventIDs {
		keys[i] = eventKey(id)
	}
	result, err := claimScript.Run(ctx, c.rdb, keys, pendingTTLSeconds).Int64Slice()
	if err != nil {
		return nil, fmt.Errorf("claim event IDs: %w", err)
	}
	if len(result) != len(eventIDs) {
		return nil, fmt.Errorf("claim event IDs: got %d results for %d IDs", len(result), len(eventIDs))
	}
	claimed := make([]bool, len(result))
	for i, value := range result {
		claimed[i] = value == 1
	}
	return claimed, nil
}

func (c *Claims) Confirm(ctx context.Context, eventIDs []string) error {
	return c.run(ctx, "confirm event IDs", confirmScript, eventIDs, confirmedTTLSeconds)
}

func (c *Claims) Release(ctx context.Context, eventIDs []string) error {
	return c.run(ctx, "release event IDs", releaseScript, eventIDs)
}

func (c *Claims) run(ctx context.Context, operation string, script *redis.Script, eventIDs []string, args ...any) error {
	if len(eventIDs) == 0 {
		return nil
	}
	keys := make([]string, len(eventIDs))
	for i, id := range eventIDs {
		keys[i] = eventKey(id)
	}
	if err := script.Run(ctx, c.rdb, keys, args...).Err(); err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return nil
}
