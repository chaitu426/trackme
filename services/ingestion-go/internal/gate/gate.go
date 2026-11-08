// Package gate admits a batch with ONE Redis round trip: per-IP and per-site
// rate limits, event-ID claims (edge dedupe) and monthly quota reservation run
// in a single atomic script. Separate calls cost separate round trips on every
// request, and a failure between them could leave a claim or a reservation behind.
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
	IPLimited
)

const (
	pendingTTLSeconds = 120
	quotaTTLSeconds   = 40 * 24 * 60 * 60
)

// Request is one site's slice of a batch.
type Request struct {
	SiteID      string
	WorkspaceID string
	// ClientIP and IPLimit fuse the per-IP limit into the same script. Empty
	// ClientIP or non-positive IPLimit skips the IP check.
	ClientIP string
	IPLimit  int
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

// KEYS: [1] IP rate counter, [2] site rate counter, [3] quota counter, [4..] event claim keys
// ARGV: [1] IP limit, [2] site limit, [3] window ms, [4] quota, [5] quota ttl, [6] pending ttl,
//
//	[7] check IP 0|1, [8] claim 0|1, [9..] billable flag per event (0|1)
//
// Reply: {4} IP limited | {2} site limited | {3} quota exceeded (claims undone) | {0, reserved, claimed...}
var admitScript = redis.NewScript(`
if ARGV[7] == '1' then
  local ipn = redis.call('INCR', KEYS[1])
  if ipn == 1 or redis.call('PTTL', KEYS[1]) < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[3])
  end
  if ipn > tonumber(ARGV[1]) then
    return {4}
  end
end

local n = redis.call('INCR', KEYS[2])
if n == 1 or redis.call('PTTL', KEYS[2]) < 0 then
  redis.call('PEXPIRE', KEYS[2], ARGV[3])
end
if n > tonumber(ARGV[2]) then
  return {2}
end

local count = #KEYS - 3
local claim = ARGV[8] == '1'
local claimed = {}
local billable = 0
for i = 1, count do
  local ok = true
  if claim then
    ok = redis.call('SET', KEYS[i + 3], 'p', 'NX', 'EX', ARGV[6])
  end
  if ok then
    claimed[i] = 1
    if ARGV[8 + i] == '1' then billable = billable + 1 end
  else
    claimed[i] = 0
  end
end

if billable > 0 then
  local quota = tonumber(ARGV[4])
  local current = tonumber(redis.call('GET', KEYS[3]) or '0')
  if quota > 0 and (current + billable) > quota then
    if claim then
      for i = 1, count do
        if claimed[i] == 1 then redis.call('DEL', KEYS[i + 3]) end
      end
    end
    return {3}
  end
  redis.call('INCRBY', KEYS[3], billable)
  redis.call('EXPIRE', KEYS[3], ARGV[5])
end

local out = {0, billable}
for i = 1, count do out[i + 2] = claimed[i] end
return out
`)

// Admit applies the IP limit, site limit, claims event IDs and reserves quota
// atomically. The error is Redis being unreachable; the caller decides whether
// to fail closed.
func (g *Gate) Admit(ctx context.Context, req Request) (Result, error) {
	if len(req.Billable) != len(req.EventIDs) {
		return Result{}, fmt.Errorf("gate: %d billable flags for %d events", len(req.Billable), len(req.EventIDs))
	}
	keys := make([]string, 0, len(req.EventIDs)+3)
	now := g.nowFunc()
	checkIP, ipLimit := 0, req.IPLimit
	ipKey := ratelimit.WindowKey("ip:unchecked", g.windowMs, now)
	if req.ClientIP != "" && req.IPLimit > 0 {
		ipKey = ratelimit.WindowKey("ip:"+req.ClientIP, g.windowMs, now)
		checkIP = 1
	} else {
		ipLimit = 0
	}
	keys = append(keys,
		ipKey,
		ratelimit.WindowKey("site:"+req.SiteID, g.windowMs, now),
		quota.PeriodKey(req.WorkspaceID),
	)
	for _, id := range req.EventIDs {
		keys = append(keys, dedupe.EventKey(id))
	}
	claim := 0
	if req.Claim {
		claim = 1
	}
	args := make([]any, 0, 8+len(req.EventIDs))
	args = append(args, ipLimit, g.siteLimit, g.windowMs, req.Quota, g.quotaTTL, g.pendingTTL, checkIP, claim)
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
	case 4:
		return Result{Status: IPLimited}, nil
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
