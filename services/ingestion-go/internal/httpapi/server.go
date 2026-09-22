package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/trackme/ingestion-go/internal/enrich"
	"github.com/trackme/ingestion-go/internal/geo"
	"github.com/trackme/ingestion-go/internal/origin"
	"github.com/trackme/ingestion-go/internal/queue"
	"github.com/trackme/ingestion-go/internal/quota"
	"github.com/trackme/ingestion-go/internal/ratelimit"
	"github.com/trackme/ingestion-go/internal/sign"
	"github.com/trackme/ingestion-go/internal/site"
)

type Server struct {
	Sites     *site.Resolver
	Publisher *queue.Publisher
	Limiter   *ratelimit.Limiter
	Quota     *quota.Checker
	Geo       *geo.Resolver
	MaxBody   int64
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

	processed, status, message := s.processEvents(r, body, req.Events)
	if status != http.StatusAccepted {
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "accepted", "processed": processed})
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
	processed, status, message := s.processEvents(r, body, []enrich.TrackerEvent{ev})
	if status != http.StatusAccepted {
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "accepted", "processed": processed})
}

func (s *Server) allowIP(r *http.Request) bool {
	ok, err := s.Limiter.Allow(r.Context(), "ip:"+clientIP(r))
	if err != nil {
		log.Printf("rate limit error: %v", err)
		return false
	}
	return ok
}

func (s *Server) processEvents(r *http.Request, rawBody []byte, events []enrich.TrackerEvent) (processed int, status int, message string) {
	resolved := map[string]*site.ResolvedSite{}
	for _, ev := range events {
		if !validEvent(ev) {
			return 0, http.StatusBadRequest, "Invalid tracker event fields"
		}
		if _, ok := resolved[ev.SiteKey]; ok {
			continue
		}
		siteRow, err := s.Sites.Resolve(r.Context(), ev.SiteKey)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, http.StatusUnauthorized, "Unknown or invalid site key"
			}
			log.Printf("site resolve error: %v", err)
			return 0, http.StatusInternalServerError, "Site lookup failed"
		}
		resolved[ev.SiteKey] = siteRow
	}

	// Per-site-key rate limit (stops public-key spam far better than IP alone).
	for siteKey, siteRow := range resolved {
		ok, err := s.Limiter.Allow(r.Context(), "site:"+siteRow.ID)
		if err != nil {
			return 0, http.StatusInternalServerError, "Rate limiter unavailable"
		}
		if !ok {
			return 0, http.StatusTooManyRequests, "Site rate limit exceeded"
		}
		_ = siteKey
	}

	for _, siteRow := range resolved {
		if siteRow.Settings.RequireOriginMatch {
			if !origin.Allowed(
				r.Header.Get("Origin"),
				r.Header.Get("Referer"),
				siteRow.Domain,
				siteRow.Settings.AllowLocalhostTracking,
			) {
				return 0, http.StatusForbidden, "Origin/Referer does not match registered site domain"
			}
		}

		if siteRow.Settings.SigningRequired {
			secret := siteRow.Settings.SigningSecret
			if secret == "" || !sign.Valid(secret, rawBody, r.Header.Get("X-GI-Signature")) {
				return 0, http.StatusUnauthorized, "Valid X-GI-Signature required"
			}
		}

		if siteRow.Settings.RequireConsent {
			consent := strings.ToLower(strings.TrimSpace(r.Header.Get("X-GI-Consent")))
			if consent != "granted" && consent != "1" && consent != "true" {
				return 0, http.StatusForbidden, "Consent required before tracking"
			}
		}
	}

	headerMap := flattenHeaders(r.Header)
	ua := r.Header.Get("User-Agent")
	classification := enrich.ClassifyUA(ua)
	ip := clientIP(r)
	country, city := "", ""
	if s.Geo != nil {
		country, city = s.Geo.Lookup(headerMap, ip)
	} else {
		country, city = enrich.ExtractGeo(headerMap)
	}
	// IP is discarded after geo — never attached to the enriched event.
	_ = ip

	receivedAt := time.Now().UTC().Format(time.RFC3339Nano)
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
		return 0, http.StatusAccepted, ""
	}

	// Reserve quota atomically before Kafka publish so concurrent batches
	// cannot race past the monthly limit. Redis is the hard ingest gate.
	reserved := make(map[string]int, len(byWorkspace))
	for workspaceID, delta := range byWorkspace {
		siteRow := firstSiteForWorkspace(resolved, workspaceID)
		allowed, err := s.Quota.TryReserve(r.Context(), workspaceID, siteRow.MonthlyEventQuota, delta)
		if err != nil {
			log.Printf("quota reserve error: %v", err)
			_ = s.Quota.Release(r.Context(), reserved)
			return 0, http.StatusInternalServerError, "Quota check failed"
		}
		if !allowed {
			_ = s.Quota.Release(r.Context(), reserved)
			return 0, http.StatusPaymentRequired, "Monthly event quota exceeded"
		}
		reserved[workspaceID] = delta
	}

	if err := s.Publisher.Publish(r.Context(), enriched); err != nil {
		log.Printf("publish error: %v", err)
		_ = s.Quota.Release(r.Context(), reserved)
		return 0, http.StatusInternalServerError, "Failed to enqueue events"
	}

	return len(enriched), http.StatusAccepted, ""
}

func firstSiteForWorkspace(resolved map[string]*site.ResolvedSite, workspaceID string) *site.ResolvedSite {
	for _, s := range resolved {
		if s.WorkspaceID == workspaceID {
			return s
		}
	}
	return &site.ResolvedSite{}
}

func validEvent(ev enrich.TrackerEvent) bool {
	if ev.SchemaVersion != 1 {
		return false
	}
	if ev.EventID == "" || ev.SiteKey == "" || ev.SessionID == "" || ev.VisitorPseudonym == "" {
		return false
	}
	if ev.URL == "" || ev.Path == "" || ev.OccurredAt == "" {
		return false
	}
	switch ev.Type {
	case "pageview", "custom", "web_vital":
		return true
	default:
		return false
	}
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

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		return strings.TrimSpace(realIP)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
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
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
