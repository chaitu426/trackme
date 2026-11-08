package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	mrand "math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/trackme/ingestion-go/internal/clientip"
	"github.com/trackme/ingestion-go/internal/enrich"
	"github.com/trackme/ingestion-go/internal/gate"
	"github.com/trackme/ingestion-go/internal/geo"
	"github.com/trackme/ingestion-go/internal/limit"
	"github.com/trackme/ingestion-go/internal/metrics"
	"github.com/trackme/ingestion-go/internal/origin"
	"github.com/trackme/ingestion-go/internal/queue"
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
	Publish(ctx context.Context, events []enrich.EnrichedEvent) (publishedIndices []int, err error)
}

type EventDeduper interface {
	Claim(ctx context.Context, eventIDs []string) ([]bool, error)
	Confirm(ctx context.Context, eventIDs []string) error
	Release(ctx context.Context, eventIDs []string) error
}

// Admitter applies the site limit, event claims and quota in one Redis round trip.
type Admitter interface {
	Admit(ctx context.Context, req gate.Request) (gate.Result, error)
}

type Server struct {
	Sites     SiteResolver
	Publisher EventPublisher
	Limiter   RateLimiter // per client IP
	// SiteLimiter limits per site. A busy site legitimately sends far more than
	// one visitor's IP, so it needs its own, larger budget. Falls back to Limiter.
	SiteLimiter RateLimiter
	Quota       QuotaGate
	Deduper     EventDeduper
	EdgeDedupe  bool
	// Gate, when set, replaces SiteLimiter + Deduper.Claim + Quota.TryReserve with
	// one atomic script (EDGE_GATE_SCRIPT). Deduper and Quota are still used to
	// confirm and release after publishing.
	Gate    Admitter
	Geo     *geo.Resolver
	MaxBody int64

	// TrustedProxyHops is how many reverse proxies sit in front of this server;
	// see internal/clientip. Zero means no proxy and X-Forwarded-For is ignored.
	TrustedProxyHops int

	// QuotaFailOpen accepts events when the quota counter in Redis cannot be
	// reached, instead of rejecting them. Usage metering later reconciles the
	// real count from ClickHouse, so the cost is briefly looser enforcement.
	QuotaFailOpen bool

	// AdmissionFailClosed refuses the batch (503) when the gate or quota counter
	// cannot be reached. It takes precedence over QuotaFailOpen and is the
	// production policy: silently bypassing rate limit, dedupe and quota is the
	// failure mode that produced the load-test incident.
	AdmissionFailClosed bool

	// IPRateLimitMax is the per-client-IP budget applied inside the fused gate
	// script. Zero keeps the separate Limiter call.
	IPRateLimitMax int

	// AsyncConfirm confirms event claims after the 202 is sent instead of before it.
	// The confirm only extends a dedupe marker's lifetime (a failure is already just
	// logged), so the client need not wait a Redis round trip for it.
	AsyncConfirm bool

	// ReadyChecks back GET /ready. Empty means always ready.
	ReadyChecks []ReadyCheck
	ready       readyState

	// HideMetrics removes /metrics from this listener because it is served on a private port.
	HideMetrics bool

	// Concurrency, when set, caps requests in flight adaptively and refuses the excess at once
	// (503 + jittered Retry-After) before any body is read or Redis is touched.
	Concurrency *limit.Limiter

	// RequireSignedTimestamp refuses signed requests that do not carry X-GI-Timestamp, closing the replay window
	// of the legacy body-only signature. Turn it on once every SDK and proxy sends the timestamp.
	RequireSignedTimestamp bool

	// Pressure, when set, reports 0-1 how close the edge is to refusing work. Above 0.5 the edge
	// keeps only 1 in N web-vital events (N grows to about 11 at 1.0), stamps the kept ones with
	// sampleWeight=N, and tells SDKs to slow down (X-GI-Backoff). Pageviews, conversions and
	// custom events are never sampled. Uniform sampling keeps quantiles and rating shares
	// unbiased; only absolute web-vital counts under-report.
	Pressure func() float64

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

type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	r.status = statusCode
	r.ResponseWriter.WriteHeader(statusCode)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

func withRequestTracing(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		reqID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if reqID == "" {
			buf := make([]byte, 12)
			if _, err := rand.Read(buf); err == nil {
				reqID = base64.RawURLEncoding.EncodeToString(buf)
			} else {
				reqID = fmt.Sprintf("req-%d", time.Now().UnixNano())
			}
		}
		w.Header().Set("X-Request-ID", reqID)
		metrics.Default.HTTPRequestsInFlight.Inc()
		defer metrics.Default.HTTPRequestsInFlight.Dec()
		statusWriter := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(statusWriter, r)
		duration := time.Since(start)
		statusCode := statusWriter.status
		metrics.Default.HTTPRequests.WithLabelValues(routeLabel(r.Method, r.URL.Path), fmt.Sprintf("%dxx", statusCode/100)).Observe(duration.Seconds())
		log.Printf("%s %s request_id=%s status=%d latency_ms=%d", r.Method, r.URL.Path, reqID, statusCode, duration.Milliseconds())
	})
}

func routeLabel(method, path string) string {
	switch method + " " + path {
	case "GET /health", "GET /ready", "GET /metrics", "POST /v1/batch", "POST /v1/e":
		return method + " " + path
	default:
		return "other"
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /ready", s.handleReady)
	if !s.HideMetrics {
		mux.HandleFunc("GET /metrics", s.handleMetrics)
	}
	mux.HandleFunc("POST /v1/batch", s.limited(s.handleBatch))
	mux.HandleFunc("POST /v1/e", s.limited(s.handleSingle))
	return withCORS(withRequestTracing(mux))
}

func (s *Server) limited(next http.HandlerFunc) http.HandlerFunc {
	if s.Concurrency == nil {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		done, ok := s.Concurrency.Acquire()
		if !ok {
			metrics.Default.Shed.WithLabelValues("concurrency").Inc()
			setRetryAfter(w)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Overloaded, retry shortly"})
			return
		}
		defer done()
		next(w, r)
	}
}

// signatureOK verifies X-GI-Signature. With X-GI-Timestamp the signature covers the timestamp and stale requests
// are refused (replay protection); without it the legacy body-only signature is accepted unless
// RequireSignedTimestamp says otherwise.
func (s *Server) signatureOK(secret string, body []byte, r *http.Request) bool {
	if secret == "" {
		return false
	}
	signature := r.Header.Get("X-GI-Signature")
	if ts := r.Header.Get("X-GI-Timestamp"); ts != "" {
		return sign.ValidTimestamped(secret, body, ts, signature, time.Now(), sign.MaxSkew)
	}
	return !s.RequireSignedTimestamp && sign.Valid(secret, body, signature)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "ingestion-go"})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	metrics.Handler().ServeHTTP(w, r)
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

	// The fused gate applies the per-IP limit inside its single script; only the
	// legacy path needs this separate round trip.
	if s.Gate == nil && !s.allowIP(r) {
		setRetryAfter(w)
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded"})
		return
	}

	res, status, message := s.processEvents(r, body, req.Events)
	if status != http.StatusAccepted {
		if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
			setRetryAfter(w)
		}
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	s.hint(w)
	writeJSON(w, http.StatusAccepted, res.body())
}

// hint asks SDKs to space out their next flush while the edge is under pressure: up to 5 s at full.
func (s *Server) hint(w http.ResponseWriter) {
	if s.Pressure == nil {
		return
	}
	if p := s.Pressure(); p > 0.5 {
		w.Header().Set("X-GI-Backoff", strconv.Itoa(int((p-0.5)*10_000)))
	}
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

	if s.Gate == nil && !s.allowIP(r) {
		setRetryAfter(w)
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded"})
		return
	}

	// Wrap single event as a synthetic batch for signature over raw body.
	res, status, message := s.processEvents(r, body, []enrich.TrackerEvent{ev})
	if status != http.StatusAccepted {
		if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
			setRetryAfter(w)
		}
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	s.hint(w)
	writeJSON(w, http.StatusAccepted, res.body())
}

// allowIP applies the per-client-IP limit. When Redis is unreachable it lets the
// request through: rate limiting protects the service from abuse, and refusing
// every visitor because the counter store is down would be a bigger outage than
// the abuse it guards against.
func (s *Server) allowIP(r *http.Request) bool {
	ok, err := s.Limiter.Allow(r.Context(), "ip:"+s.clientIP(r))
	if err != nil {
		metrics.Default.RedisErrors.WithLabelValues("ip").Inc()
		s.warn("ratelimit-ip", "rate limiter unavailable, allowing traffic: %v", err)
		return true
	}
	return ok
}

// ingestResult is what a successful (202) call reports back to the SDK.
type ingestResult struct {
	Processed   int // events published to Kafka
	Rejected    int // events dropped for failing the tracker contract
	Duplicates  int // already accepted event IDs dropped by edge dedupe
	Clamped     int // accepted events whose timestamp was replaced with server time
	DroppedBots int // known crawlers dropped at the edge (not billed)
}

func (r ingestResult) body() map[string]any {
	return map[string]any{
		"status":      "accepted",
		"processed":   r.Processed,
		"rejected":    r.Rejected,
		"duplicates":  r.Duplicates,
		"droppedBots": r.DroppedBots,
	}
}

func (s *Server) processEvents(r *http.Request, rawBody []byte, events []enrich.TrackerEvent) (res ingestResult, status int, message string) {
	now := time.Now().UTC()
	stages := stageTimer{start: time.Now()}

	// Contract check first: a malformed event is dropped on its own so it can
	// neither block the rest of the batch nor reach Kafka, where the worker
	// could not insert it.
	valid := make([]enrich.TrackerEvent, 0, len(events))
	reasons := map[string]int{}
	normalized := 0
	for _, ev := range events {
		ev, cut, dropped := validate.Normalize(ev)
		if cut > 0 || dropped > 0 {
			normalized++
			metrics.Default.EdgeEvents.WithLabelValues("normalized").Inc()
		}
		out, clamped, reason := validate.Event(ev, now, validate.DefaultWindow)
		if reason != "" {
			res.Rejected++
			metrics.Default.EdgeEvents.WithLabelValues("rejected").Inc()
			reasons[reason]++
			continue
		}
		if clamped {
			res.Clamped++
			metrics.Default.EdgeEvents.WithLabelValues("clamped").Inc()
		}
		valid = append(valid, out)
	}
	if res.Rejected > 0 || res.Clamped > 0 || normalized > 0 {
		log.Printf("ingest: batch=%d rejected=%d clamped=%d normalized=%d reasons=%v", len(events), res.Rejected, res.Clamped, normalized, reasons)
	}
	if len(valid) == 0 {
		return ingestResult{}, http.StatusBadRequest, "No valid events in batch"
	}
	events = valid
	stages.mark("validate")
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

	stages.mark("resolve")

	// Per-site rate limit (stops public-key spam far better than IP alone). Like
	// the IP limit, it fails open if Redis is unreachable.
	siteLimiter := s.SiteLimiter
	if siteLimiter == nil {
		siteLimiter = s.Limiter
	}
	for _, siteRow := range resolved {
		if s.Gate != nil {
			break // the gate applies the site limit together with claims and quota
		}
		ok, err := siteLimiter.Allow(r.Context(), "site:"+siteRow.ID)
		if err != nil {
			metrics.Default.RedisErrors.WithLabelValues("gate").Inc()
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
			if !s.signatureOK(secret, rawBody, r) {
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
	vitalKeep := 1
	if s.Pressure != nil {
		if p := s.Pressure(); p > 0.5 {
			vitalKeep = 1 + int((p-0.5)*20)
		}
	}

	enriched := make([]enrich.EnrichedEvent, 0, len(events))
	quotaByWorkspace := map[string]int{}

	for _, ev := range events {
		siteRow := resolved[ev.SiteKey]
		if classification.BotStatus == "known_bot" {
			res.DroppedBots++
			metrics.Default.EdgeEvents.WithLabelValues("dropped_bot").Inc()
			continue
		}
		if siteRow.Settings.RespectDoNotTrack && dnt {
			metrics.Default.EdgeEvents.WithLabelValues("skipped_dnt").Inc()
			continue
		}
		if !siteRow.Settings.AllowLocalhostTracking && enrich.IsLocalOrFileURL(ev.URL) {
			metrics.Default.EdgeEvents.WithLabelValues("skipped_local").Inc()
			continue
		}
		if ev.Type == "web_vital" && !siteRow.Settings.CollectWebVitals {
			metrics.Default.EdgeEvents.WithLabelValues("skipped_vitals_disabled").Inc()
			continue
		}
		if !enrich.HostAllowed(ev.URL, siteRow.Domain, siteRow.Settings.AllowLocalhostTracking) {
			metrics.Default.EdgeEvents.WithLabelValues("skipped_host_mismatch").Inc()
			s.warn("host-mismatch", "dropped event: host of %q does not match registered domain %q (site %s)", ev.URL, siteRow.Domain, siteRow.ID)
			continue
		}

		weight := 0
		if ev.Type == "web_vital" && vitalKeep > 1 {
			if mrand.Intn(vitalKeep) != 0 {
				metrics.Default.Shed.WithLabelValues("sampled_web_vital").Inc()
				continue
			}
			weight = vitalKeep
		}

		// URL and path were reduced to the allowed query parameters by validate.Normalize.
		ev.Referrer = enrich.StripSelfReferrer(ev.Referrer, siteRow.Domain)

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
			SampleWeight: weight,
		}
		enriched = append(enriched, out)
		quotaByWorkspace[siteRow.WorkspaceID] = siteRow.MonthlyEventQuota
	}

	if len(enriched) == 0 {
		return res, http.StatusAccepted, ""
	}
	stages.mark("enrich")
	var (
		claimedIDs    []string
		claimedEvents []enrich.EnrichedEvent
		reserved      map[string]int
	)
	if s.Gate != nil {
		var (
			rejection int
			message   string
		)
		claimedIDs, claimedEvents, reserved, rejection, message = s.admitWithGate(r.Context(), enriched, quotaByWorkspace, ip, &res)
		if rejection != 0 {
			return ingestResult{}, rejection, message
		}
		if len(claimedEvents) == 0 {
			res.Processed = res.Duplicates
			return res, http.StatusAccepted, ""
		}
	} else {
		if s.EdgeDedupe && s.Deduper == nil {
			s.warn("dedupe-config", "EDGE_DEDUPE is enabled but no deduper is configured")
			return ingestResult{}, http.StatusServiceUnavailable, "Event dedupe is unavailable"
		}

		claimedIDs = make([]string, 0, len(enriched))
		claimedEvents = enriched
		if s.EdgeDedupe && s.Deduper != nil {
			ids := make([]string, len(enriched))
			for i, event := range enriched {
				ids[i] = event.EventID
			}
			claimed, err := s.Deduper.Claim(r.Context(), ids)
			if err != nil {
				metrics.Default.RedisErrors.WithLabelValues("dedupe").Inc()
				s.warn("dedupe", "event dedupe unavailable, accepting without claims: %v", err)
			} else {
				claimedEvents = make([]enrich.EnrichedEvent, 0, len(enriched))
				for i, event := range enriched {
					if claimed[i] {
						claimedIDs = append(claimedIDs, event.EventID)
						claimedEvents = append(claimedEvents, event)
					} else {
						res.Duplicates++
						metrics.Default.EdgeEvents.WithLabelValues("duplicate").Inc()
					}
				}
				if res.Duplicates > 0 {
					log.Printf("ingest: batch=%d duplicates=%d", len(enriched), res.Duplicates)
				}
				if len(claimedEvents) == 0 {
					res.Processed = res.Duplicates
					return res, http.StatusAccepted, ""
				}
			}
		}

		billableByWorkspace := make(map[string]int)
		for _, event := range claimedEvents {
			if event.BotStatus == "human" {
				billableByWorkspace[event.WorkspaceID]++
			}
		}

		// Reserve quota atomically before Kafka publish so concurrent batches
		// cannot race past the monthly limit. Redis is the hard ingest gate.
		// Known bots never reach here. Heuristic bots are stored but not billed.
		reserved = make(map[string]int, len(billableByWorkspace))
		for workspaceID, delta := range billableByWorkspace {
			allowed, err := s.Quota.TryReserve(r.Context(), workspaceID, quotaByWorkspace[workspaceID], delta)
			if err != nil {
				metrics.Default.RedisErrors.WithLabelValues("gate").Inc()
				if s.QuotaFailOpen && !s.AdmissionFailClosed {
					s.warn("quota", "quota counter unavailable, accepting events without reserving: %v", err)
					continue
				}
				s.warn("quota", "quota reserve error: %v", err)
				metrics.Default.AdmissionFailClosed.WithLabelValues("quota").Inc()
				if len(reserved) > 0 {
					if releaseErr := s.Quota.Release(r.Context(), reserved); releaseErr != nil {
						s.warn("quota-release", "failed to roll back quota after reserve error: %v", releaseErr)
					}
				}
				if err := s.releaseClaims(r.Context(), claimedIDs); err != nil {
					s.warn("dedupe-release", "failed to release event claims after quota error: %v", err)
				}
				return ingestResult{}, http.StatusServiceUnavailable, "Admission unavailable"
			}
			if !allowed {
				if len(reserved) > 0 {
					if releaseErr := s.Quota.Release(r.Context(), reserved); releaseErr != nil {
						s.warn("quota-release", "failed to roll back quota after quota rejection: %v", releaseErr)
					}
				}
				if err := s.releaseClaims(r.Context(), claimedIDs); err != nil {
					s.warn("dedupe-release", "failed to release event claims after quota rejection: %v", err)
				}
				return ingestResult{}, http.StatusPaymentRequired, "Monthly event quota exceeded"
			}
			reserved[workspaceID] = delta
		}

	}

	stages.mark("admit")
	publishedIndices, publishErr := s.Publisher.Publish(r.Context(), claimedEvents)
	stages.mark("publish")
	publishedSet := make(map[int]struct{}, len(publishedIndices))
	for _, i := range publishedIndices {
		if i >= 0 && i < len(claimedEvents) {
			publishedSet[i] = struct{}{}
		}
	}
	publishedIDs := make([]string, 0, len(publishedSet))
	failedIDs := make([]string, 0, len(claimedEvents)-len(publishedSet))
	failedBillable := make(map[string]int)
	for i, event := range claimedEvents {
		if _, ok := publishedSet[i]; ok {
			publishedIDs = append(publishedIDs, event.EventID)
		} else {
			failedIDs = append(failedIDs, event.EventID)
			if event.BotStatus == "human" {
				failedBillable[event.WorkspaceID]++
			}
		}
	}
	if len(publishedSet) > 0 {
		metrics.Default.EdgeEvents.WithLabelValues("accepted").Add(float64(len(publishedSet)))
	}

	if publishErr != nil {
		s.warn("publish", "publish error: %v", publishErr)
		releaseQuota := make(map[string]int, len(failedBillable))
		for workspaceID, failed := range failedBillable {
			if alreadyReserved := reserved[workspaceID]; alreadyReserved > 0 {
				if failed > alreadyReserved {
					failed = alreadyReserved
				}
				releaseQuota[workspaceID] = failed
			}
		}
		if len(releaseQuota) > 0 {
			if err := s.Quota.Release(r.Context(), releaseQuota); err != nil {
				s.warn("quota-release", "failed to release quota for unpublished events: %v", err)
			}
		}
		if err := s.releaseClaims(r.Context(), failedIDs); err != nil {
			s.warn("dedupe-release", "failed to release claims for unpublished events: %v", err)
		}
		if err := s.confirmClaims(r.Context(), publishedIDs); err != nil {
			metrics.Default.RedisErrors.WithLabelValues("dedupe").Inc()
			s.warn("dedupe-confirm", "failed to confirm claims for published events: %v", err)
		}
		if errors.Is(publishErr, queue.ErrFull) {
			return ingestResult{}, http.StatusTooManyRequests, "Ingest queue is full, retry shortly"
		}
		if errors.Is(publishErr, queue.ErrClosed) {
			return ingestResult{}, http.StatusServiceUnavailable, "Ingest is shutting down"
		}
		return ingestResult{}, http.StatusInternalServerError, "Failed to enqueue events"
	}

	if s.AsyncConfirm {
		ids := claimedIDs
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := s.confirmClaims(ctx, ids); err != nil {
				metrics.Default.RedisErrors.WithLabelValues("dedupe").Inc()
				s.warn("dedupe-confirm", "failed to confirm published event claims: %v", err)
			}
		}()
	} else if err := s.confirmClaims(r.Context(), claimedIDs); err != nil {
		metrics.Default.RedisErrors.WithLabelValues("dedupe").Inc()
		s.warn("dedupe-confirm", "failed to confirm published event claims: %v", err)
	}
	stages.mark("confirm")
	s.logIfSlow(&stages)
	res.Processed = len(claimedEvents) + res.Duplicates
	return res, http.StatusAccepted, ""
}

// stageTimer records how long each phase of processEvents took, so a slow request
// can say where the time went instead of just that it was slow.
type stageTimer struct {
	start time.Time
	last  time.Time
	names []string
	durs  []time.Duration
}

func (t *stageTimer) mark(name string) {
	now := time.Now()
	if t.last.IsZero() {
		t.last = t.start
	}
	d := now.Sub(t.last)
	t.names = append(t.names, name)
	t.durs = append(t.durs, d)
	metrics.Default.EdgeStage.WithLabelValues(name).Observe(d.Seconds())
	t.last = now
}

const slowIngest = 150 * time.Millisecond

// logIfSlow reports the per-stage breakdown of requests slower than slowIngest
// (rate-limited like the other warnings).
func (s *Server) logIfSlow(t *stageTimer) {
	total := time.Since(t.start)
	if total < slowIngest {
		return
	}
	var b strings.Builder
	for i, name := range t.names {
		fmt.Fprintf(&b, " %s=%dms", name, t.durs[i].Milliseconds())
	}
	s.warn("slow-ingest", "slow ingest total=%dms stages:%s", total.Milliseconds(), b.String())
}

func (s *Server) confirmClaims(ctx context.Context, ids []string) error {
	if !s.EdgeDedupe || s.Deduper == nil || len(ids) == 0 {
		return nil
	}
	return s.Deduper.Confirm(ctx, ids)
}

func (s *Server) releaseClaims(ctx context.Context, ids []string) error {
	if !s.EdgeDedupe || s.Deduper == nil || len(ids) == 0 {
		return nil
	}
	return s.Deduper.Release(ctx, ids)
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

// setRetryAfter tells the SDK to back off instead of hammering a shedding edge. The value is
// jittered per response (1-3 s): a constant would bring every rejected client back in the same second.
func setRetryAfter(w http.ResponseWriter) {
	w.Header().Set("Retry-After", strconv.Itoa(1+mrand.Intn(3)))
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, DNT, X-GI-Signature, X-GI-Timestamp, X-GI-Consent")
		// Without this the browser hides the back-off hints from the tracker's fetch().
		w.Header().Set("Access-Control-Expose-Headers", "Retry-After, X-GI-Backoff")
		if r.Method == http.MethodOptions {
			// Without this the browser repeats the preflight every few seconds.
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
