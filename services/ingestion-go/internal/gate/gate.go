// Package gate admits a batch with ONE Redis round trip: per-site rate limit,
// event-ID claims (edge dedupe) and monthly quota reservation run in a single
// atomic script. Three separate calls cost three round trips on every request,
// and a failure between them could leave a claim or a reservation behind.
package gate

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/trackme/ingestion-go/internal/dedupe"
	"github.com/trackme/ingestion-go/internal/quota"
	"github.com/trackme/ingestion-go/internal/ratelimit"
)

type Status int

const (
	Admitted Status = iota
	SiteLimited
	QuotaExceeded
)

const (
	pendingTTLSeconds = 120
	quotaTTLSeconds   = 40 * 24 * 60 * 60
)

// Request is one site's slice of a batch.
type Request struct {
	SiteID      string
	WorkspaceID string
	// Quota is the workspace monthly quota; <= 0 means unlimited.
	Quota    int
	EventIDs []string
	// Billable[i] is true for events that count against quota (human traffic).
	Billable []bool
	// Claim enables event-ID dedupe. When false every event is reported as claimed.
	Claim bool
}

type Result struct {
	Status Status
	// Claimed[i] is false when event i was a duplicate and must be dropped.
	Claimed []bool
	// Reserved is the quota units reserved (billable events that were claimed).
	Reserved int
}

type Gate struct {
	rdb        *redis.Client
	siteLimit  int
	windowMs   int
	pendingTTL int
	quotaTTL   int
	nowFunc    func() time.Time
}

func New(rdb *redis.Client, siteLimit, windowMs int) *Gate {
	if siteLimit <= 0 {
		siteLimit = 10000
	}
	if windowMs <= 0 {
		windowMs = 60_000
	}
	return &Gate{
		rdb:        rdb,
		siteLimit:  siteLimit,
		windowMs:   windowMs,
		pendingTTL: pendingTTLSeconds,
		quotaTTL:   quotaTTLSeconds,
		nowFunc:    time.Now,
	}
}

// KEYS: [1] site rate counter, [2] quota counter, [3..] event claim keys
// ARGV: [1] site limit, [2] window ms, [3] quota, [4] quota ttl, [5] pending ttl,
//
//	[6] claim 0|1, [7..] billable flag per event (0|1)
//
// Reply: {2} site limited | {3} quota exceeded (claims undone) | {0, reserved, claimed...}
var admitScript = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
if n > tonumber(ARGV[1]) then
  return {2}
end

local count = #KEYS - 2
local claim = ARGV[6] == '1'
local claimed = {}
local billable = 0
for i = 1, count do
  local ok = true
  if claim then
    ok = redis.call('SET', KEYS[i + 2], 'p', 'NX', 'EX', ARGV[5])
  end
  if ok then
    claimed[i] = 1
    if ARGV[6 + i] == '1' then billable = billable + 1 end
  else
    claimed[i] = 0
  end
end

if billable > 0 then
  local quota = tonumber(ARGV[3])
  local current = tonumber(redis.call('GET', KEYS[2]) or '0')
  if quota > 0 and (current + billable) > quota then
    if claim then
      for i = 1, count do
        if claimed[i] == 1 then redis.call('DEL', KEYS[i + 2]) end
      end
    end
    return {3}
  end
  redis.call('INCRBY', KEYS[2], billable)
  redis.call('EXPIRE', KEYS[2], ARGV[4])
end

local out = {0, billable}
for i = 1, count do out[i + 2] = claimed[i] end
return out
`)

// Admit applies the site limit, claims event IDs and reserves quota atomically.
// The error is Redis being unreachable; the caller decides whether to fail open.
func (g *Gate) Admit(ctx context.Context, req Request) (Result, error) {
	if len(req.Billable) != len(req.EventIDs) {
		return Result{}, fmt.Errorf("gate: %d billable flags for %d events", len(req.Billable), len(req.EventIDs))
	}
	keys := make([]string, 0, len(req.EventIDs)+2)
	keys = append(keys,
		ratelimit.WindowKey("site:"+req.SiteID, g.windowMs, g.nowFunc()),
		quota.PeriodKey(req.WorkspaceID),
	)
	for _, id := range req.EventIDs {
		keys = append(keys, dedupe.EventKey(id))
	}
	claim := 0
	if req.Claim {
		claim = 1
	}
	args := make([]any, 0, 6+len(req.EventIDs))
	args = append(args, g.siteLimit, g.windowMs, req.Quota, g.quotaTTL, g.pendingTTL, claim)
	for _, b := range req.Billable {
		if b {
			args = append(args, 1)
		} else {
			args = append(args, 0)
		}
	}

	reply, err := admitScript.Run(ctx, g.rdb, keys, args...).Int64Slice()
	if err != nil {
		return Result{}, fmt.Errorf("admit: %w", err)
	}
	if len(reply) == 0 {
		return Result{}, fmt.Errorf("admit: empty reply")
	}
	switch reply[0] {
	case 2:
		return Result{Status: SiteLimited}, nil
	case 3:
		return Result{Status: QuotaExceeded}, nil
	case 0:
		if len(reply) != 2+len(req.EventIDs) {
			return Result{}, fmt.Errorf("admit: got %d values for %d events", len(reply), len(req.EventIDs))
		}
		claimed := make([]bool, len(req.EventIDs))
		for i := range claimed {
			claimed[i] = reply[2+i] == 1
		}
		return Result{Status: Admitted, Claimed: claimed, Reserved: int(reply[1])}, nil
	}
	return Result{}, fmt.Errorf("admit: unexpected status %d", reply[0])
}
