package httpapi

import (
	"context"
	"log"
	"net/http"

	"github.com/trackme/ingestion-go/internal/enrich"
	"github.com/trackme/ingestion-go/internal/gate"
	"github.com/trackme/ingestion-go/internal/metrics"
)

// admitWithGate runs the one-round-trip admission (site limit + event claims +
// quota) once per site in the batch. A batch normally has one site, so this is
// one Redis call per request.
//
// On success it returns the events to publish, the claimed IDs (to confirm or
// release after publishing) and the quota reserved per workspace. A non-zero
// status means the batch is refused; everything this call claimed or reserved
// has been rolled back first, so the SDK retry is not dropped as a duplicate.
//
// Redis failure follows the existing policy: with QuotaFailOpen the events are
// accepted without claims or reservation (the worker/storage backstop and usage
// metering bound the damage); otherwise the batch is refused.
func (s *Server) admitWithGate(
	ctx context.Context,
	enriched []enrich.EnrichedEvent,
	quotaByWorkspace map[string]int,
	res *ingestResult,
) (claimedIDs []string, claimed []enrich.EnrichedEvent, reserved map[string]int, status int, message string) {
	reserved = map[string]int{}
	claimed = make([]enrich.EnrichedEvent, 0, len(enriched))

	var order []string
	bySite := map[string][]enrich.EnrichedEvent{}
	for _, ev := range enriched {
		if _, seen := bySite[ev.SiteID]; !seen {
			order = append(order, ev.SiteID)
		}
		bySite[ev.SiteID] = append(bySite[ev.SiteID], ev)
	}

	rollback := func() {
		if len(reserved) > 0 && s.Quota != nil {
			if err := s.Quota.Release(ctx, reserved); err != nil {
				s.warn("quota-release", "failed to roll back quota after gate rejection: %v", err)
			}
		}
		if err := s.releaseClaims(ctx, claimedIDs); err != nil {
			s.warn("dedupe-release", "failed to release event claims after gate rejection: %v", err)
		}
	}

	for _, siteID := range order {
		events := bySite[siteID]
		workspaceID := events[0].WorkspaceID
		req := gate.Request{
			SiteID:      siteID,
			WorkspaceID: workspaceID,
			Quota:       quotaByWorkspace[workspaceID],
			EventIDs:    make([]string, len(events)),
			Billable:    make([]bool, len(events)),
			Claim:       s.EdgeDedupe,
		}
		for i, ev := range events {
			req.EventIDs[i] = ev.EventID
			req.Billable[i] = ev.BotStatus == "human"
		}

		result, err := s.Gate.Admit(ctx, req)
		if err != nil {
			metrics.Default.RedisErrors.WithLabelValues("gate").Inc()
			if s.QuotaFailOpen {
				s.warn("gate", "admission gate unavailable, accepting without claims or quota: %v", err)
				claimed = append(claimed, events...)
				continue
			}
			s.warn("gate", "admission gate error: %v", err)
			rollback()
			return nil, nil, nil, http.StatusInternalServerError, "Quota check failed"
		}

		switch result.Status {
		case gate.SiteLimited:
			rollback()
			return nil, nil, nil, http.StatusTooManyRequests, "Site rate limit exceeded"
		case gate.QuotaExceeded:
			rollback()
			return nil, nil, nil, http.StatusPaymentRequired, "Monthly event quota exceeded"
		}

		if result.Reserved > 0 {
			reserved[workspaceID] += result.Reserved
		}
		for i, ev := range events {
			if !result.Claimed[i] {
				res.Duplicates++
				metrics.Default.EdgeEvents.WithLabelValues("duplicate").Inc()
				continue
			}
			claimed = append(claimed, ev)
			if s.EdgeDedupe {
				claimedIDs = append(claimedIDs, ev.EventID)
			}
		}
	}

	if res.Duplicates > 0 {
		log.Printf("ingest: batch=%d duplicates=%d", len(enriched), res.Duplicates)
	}
	return claimedIDs, claimed, reserved, 0, ""
}
