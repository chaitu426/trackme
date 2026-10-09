package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/trackme/ingestion-go/internal/clientip"
	"github.com/trackme/ingestion-go/internal/enrich"
	"github.com/trackme/ingestion-go/internal/geo"
	"github.com/trackme/ingestion-go/internal/origin"
	"github.com/trackme/ingestion-go/internal/sign"
	"github.com/trackme/ingestion-go/internal/site"
	"github.com/trackme/ingestion-go/internal/validate"
)

// The dependencies the handler needs, as interfaces so each failure mode (Redis
// down, Postgres slow, Kafka refusing) can be exercised in tests.
type SiteResolver interface {
	Resolve(ctx context.Context, publicKey string) (*site.ResolvedSite, error)
}

type RateLimiter interface {
	Allow(ctx context.Context, key string) (bool, error)
}

type QuotaGate interface {
	TryReserve(ctx context.Context, workspaceID string, quota, delta int) (bool, error)
	Release(ctx context.Context, reserved map[string]int) error
}

type EventPublisher interface {
	Publish(ctx context.Context, events []enrich.EnrichedEvent) error
}

type Server struct {
	Sites     SiteResolver
	Publisher EventPublisher
	Limiter   RateLimiter // per client IP
	// SiteLimiter limits per site. A busy site legitimately sends far more than
	// one visitor's IP, so it needs its own, larger budget. Falls back to Limiter.
	SiteLimiter RateLimiter
	Quota       QuotaGate
	Geo         *geo.Resolver
	MaxBody     int64

	// TrustedProxyHops is how many reverse proxies sit in front of this server;
	// see internal/clientip. Zero means no proxy and X-Forwarded-For is ignored.
	TrustedProxyHops int

	// QuotaFailOpen accepts events when the quota counter in Redis cannot be
	// reached, instead of rejecting them. Usage metering later reconciles the
	// real count from ClickHouse, so the cost is briefly looser enforcement.
	QuotaFailOpen bool

	warnMu   sync.Mutex
	warnLast map[string]time.Time
}

// warn logs at most once per interval per kind, so a Redis outage under load
// produces a few lines instead of one per request.
func (s *Server) warn(kind, format string, args ...any) {
	const every = 10 * time.Second
	s.warnMu.Lock()
	if s.warnLast == nil {
		s.warnLast = map[string]time.Time{}
	}
	last, seen := s.warnLast[kind]
	now := time.Now()
	if seen && now.Sub(last) < every {
		s.warnMu.Unlock()
		return
	}
	s.warnLast[kind] = now
	s.warnMu.Unlock()
	log.Printf(format, args...)
}

type batchRequest struct {
	Events []enrich.TrackerEvent `json:"events"`
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /v1/batch", s.handleBatch)
	mux.HandleFunc("POST /v1/e", s.handleSingle)
	return withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "ingestion-go"})
}

func (s *Server) handleBatch(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r, s.MaxBody)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid or oversized payload"})
		return
	}

	var req batchRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid tracker payload"})
		return
	}
	if len(req.Events) == 0 || len(req.Events) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Batch must contain 1-50 events"})
		return
	}

	if !s.allowIP(r) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded"})
		return
	}

	res, status, message := s.processEvents(r, body, req.Events)
	if status != http.StatusAccepted {
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	writeJSON(w, http.StatusAccepted, res.body())
}

func (s *Server) handleSingle(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(w, r, s.MaxBody)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid or oversized payload"})
		return
	}

	var ev enrich.TrackerEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid tracker event payload"})
		return
	}

	if !s.allowIP(r) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded"})
		return
	}

	// Wrap single event as a synthetic batch for signature over raw body.
	res, status, message := s.processEvents(r, body, []enrich.TrackerEvent{ev})
	if status != http.StatusAccepted {
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	writeJSON(w, http.StatusAccepted, res.body())
}

// allowIP applies the per-client-IP limit. When Redis is unreachable it lets the
// request through: rate limiting protects the service from abuse, and refusing
// every visitor because the counter store is down would be a bigger outage than
// the abuse it guards against.
func (s *Server) allowIP(r *http.Request) bool {
	ok, err := s.Limiter.Allow(r.Context(), "ip:"+s.clientIP(r))
	if err != nil {
		s.warn("ratelimit-ip", "rate limiter unavailable, allowing traffic: %v", err)
		return true
	}
	return ok
}

// ingestResult is what a successful (202) call reports back to the SDK.
type ingestResult struct {
	Processed int // events published to Kafka
	Rejected  int // events dropped for failing the tracker contract
	Clamped   int // accepted events whose timestamp was replaced with server time
}

func (r ingestResult) body() map[string]any {
	return map[string]any{
		"status":    "accepted",
		"processed": r.Processed,
		"rejected":  r.Rejected,
	}
}

func (s *Server) processEvents(r *http.Request, rawBody []byte, events []enrich.TrackerEvent) (res ingestResult, status int, message string) {
	now := time.Now().UTC()

	// Contract check first: a malformed event is dropped on its own so it can
	// neither block the rest of the batch nor reach Kafka, where the worker
	// could not insert it.
	valid := make([]enrich.TrackerEvent, 0, len(events))
	reasons := map[string]int{}
	for _, ev := range events {
		out, clamped, reason := validate.Event(ev, now, validate.DefaultWindow)
		if reason != "" {
			res.Rejected++
			reasons[reason]++
			continue
		}
		if clamped {
			res.Clamped++
		}
		valid = append(valid, out)
	}
	if res.Rejected > 0 || res.Clamped > 0 {
		log.Printf("ingest: batch=%d rejected=%d clamped=%d reasons=%v", len(events), res.Rejected, res.Clamped, reasons)
	}
	if len(valid) == 0 {
		return ingestResult{}, http.StatusBadRequest, "No valid events in batch"
	}
	events = valid

	resolved := map[string]*site.ResolvedSite{}
	for _, ev := range events {
		if _, ok := resolved[ev.SiteKey]; ok {
			continue
		}
		siteRow, err := s.Sites.Resolve(r.Context(), ev.SiteKey)
		if err != nil {
			if errors.Is(err, site.ErrNotFound) {
				return ingestResult{}, http.StatusUnauthorized, "Unknown or invalid site key"
			}
			s.warn("site-resolve", "site resolve error: %v", err)
			return ingestResult{}, http.StatusInternalServerError, "Site lookup failed"
		}
		resolved[ev.SiteKey] = siteRow
	}

	// Per-site rate limit (stops public-key spam far better than IP alone). Like
	// the IP limit, it fails open if Redis is unreachable.
	siteLimiter := s.SiteLimiter
	if siteLimiter == nil {
		siteLimiter = s.Limiter
	}
	for _, siteRow := range resolved {
		ok, err := siteLimiter.Allow(r.Context(), "site:"+siteRow.ID)
		if err != nil {
			s.warn("ratelimit-site", "site rate limiter unavailable, allowing traffic: %v", err)
			continue
		}
		if !ok {
			return ingestResult{}, http.StatusTooManyRequests, "Site rate limit exceeded"
		}
	}

	for _, siteRow := range resolved {
		if siteRow.Settings.RequireOriginMatch {
			if !origin.Allowed(
				r.Header.Get("Origin"),
				r.Header.Get("Referer"),
				siteRow.Domain,
				siteRow.Settings.AllowLocalhostTracking,
			) {
				return ingestResult{}, http.StatusForbidden, "Origin/Referer does not match registered site domain"
			}
		}

		if siteRow.Settings.SigningRequired {
			secret := siteRow.Settings.SigningSecret
			if secret == "" || !sign.Valid(secret, rawBody, r.Header.Get("X-GI-Signature")) {
				return ingestResult{}, http.StatusUnauthorized, "Valid X-GI-Signature required"
			}
		}

		if siteRow.Settings.RequireConsent {
			consent := strings.ToLower(strings.TrimSpace(r.Header.Get("X-GI-Consent")))
			if consent != "granted" && consent != "1" && consent != "true" {
				return ingestResult{}, http.StatusForbidden, "Consent required before tracking"
			}
		}
	}

	headerMap := flattenHeaders(r.Header)
	ua := r.Header.Get("User-Agent")
	classification := enrich.ClassifyUA(ua)
	ip := s.clientIP(r)
	country, city := "", ""
	if s.Geo != nil {
		country, city = s.Geo.Lookup(headerMap, ip)
	} else {
		country, city = enrich.ExtractGeo(headerMap)
	}
	// IP is discarded after geo — never attached to the enriched event.
	_ = ip

	receivedAt := now.Format(time.RFC3339Nano)
	dnt := r.Header.Get("DNT") == "1"

	enriched := make([]enrich.EnrichedEvent, 0, len(events))
	byWorkspace := map[string]int{}

	for _, ev := range events {
		siteRow := resolved[ev.SiteKey]
		if siteRow.Settings.RespectDoNotTrack && dnt {
			continue
		}
		if !siteRow.Settings.AllowLocalhostTracking && enrich.IsLocalOrFileURL(ev.URL) {
			continue
		}
		if ev.Type == "web_vital" && !siteRow.Settings.CollectWebVitals {
			continue
		}
		if !enrich.HostAllowed(ev.URL, siteRow.Domain, siteRow.Settings.AllowLocalhostTracking) {
			continue
		}

		sanitizedURL, sanitizedPath := enrich.SanitizeURL(ev.URL)
		ev.URL = sanitizedURL
		ev.Path = sanitizedPath

		out := enrich.EnrichedEvent{
			TrackerEvent: ev,
			WorkspaceID:  siteRow.WorkspaceID,
			SiteID:       siteRow.ID,
			ReceivedAt:   receivedAt,
			Country:      country,
			City:         city,
			Browser:      classification.Browser,
			OS:           classification.OS,
			Device:       classification.Device,
			IsBot:        classification.IsBot,
			BotStatus:    classification.BotStatus,
		}
		enriched = append(enriched, out)
		byWorkspace[siteRow.WorkspaceID]++
	}

	if len(enriched) == 0 {
		return res, http.StatusAccepted, ""
	}

	// Reserve quota atomically before Kafka publish so concurrent batches
	// cannot race past the monthly limit. Redis is the hard ingest gate.
	reserved := make(map[string]int, len(byWorkspace))
	for workspaceID, delta := range byWorkspace {
		siteRow := firstSiteForWorkspace(resolved, workspaceID)
		allowed, err := s.Quota.TryReserve(r.Context(), workspaceID, siteRow.MonthlyEventQuota, delta)
		if err != nil {
			if s.QuotaFailOpen {
				s.warn("quota", "quota counter unavailable, accepting events without reserving: %v", err)
				continue
			}
			s.warn("quota", "quota reserve error: %v", err)
			_ = s.Quota.Release(r.Context(), reserved)
			return ingestResult{}, http.StatusInternalServerError, "Quota check failed"
		}
		if !allowed {
			_ = s.Quota.Release(r.Context(), reserved)
			return ingestResult{}, http.StatusPaymentRequired, "Monthly event quota exceeded"
		}
		reserved[workspaceID] = delta
	}

	if err := s.Publisher.Publish(r.Context(), enriched); err != nil {
		s.warn("publish", "publish error: %v", err)
		_ = s.Quota.Release(r.Context(), reserved)
		return ingestResult{}, http.StatusInternalServerError, "Failed to enqueue events"
	}

	res.Processed = len(enriched)
	return res, http.StatusAccepted, ""
}

func firstSiteForWorkspace(resolved map[string]*site.ResolvedSite, workspaceID string) *site.ResolvedSite {
	for _, s := range resolved {
		if s.WorkspaceID == workspaceID {
			return s
		}
	}
	return &site.ResolvedSite{}
}

func readBody(w http.ResponseWriter, r *http.Request, max int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	defer r.Body.Close()
	return io.ReadAll(r.Body)
}

func flattenHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for k, vals := range h {
		if len(vals) > 0 {
			out[strings.ToLower(k)] = vals[0]
		}
	}
	return out
}

func (s *Server) clientIP(r *http.Request) string {
	return clientip.FromRequest(r, s.TrustedProxyHops)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, DNT, X-GI-Signature, X-GI-Consent")
		if r.Method == http.MethodOptions {
			// Without this the browser repeats the preflight every few seconds.
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
