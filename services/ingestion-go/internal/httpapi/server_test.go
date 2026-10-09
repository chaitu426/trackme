package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/trackme/ingestion-go/internal/enrich"
	"github.com/trackme/ingestion-go/internal/site"
)

// ---- fakes ------------------------------------------------------------------

type fakeSites struct {
	site *site.ResolvedSite
	err  error
}

func (f fakeSites) Resolve(context.Context, string) (*site.ResolvedSite, error) {
	if f.err != nil {
		return nil, f.err
	}
	s := *f.site
	return &s, nil
}

type fakeLimiter struct {
	mu    sync.Mutex
	keys  []string
	allow bool
	err   error
}

func (f *fakeLimiter) Allow(_ context.Context, key string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keys = append(f.keys, key)
	if f.err != nil {
		return false, f.err
	}
	return f.allow, nil
}

type fakeQuota struct {
	err      error
	deny     bool
	reserved []int
	released []map[string]int
}

func (f *fakeQuota) TryReserve(_ context.Context, _ string, _, delta int) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	if f.deny {
		return false, nil
	}
	f.reserved = append(f.reserved, delta)
	return true, nil
}

func (f *fakeQuota) Release(_ context.Context, reserved map[string]int) error {
	f.released = append(f.released, reserved)
	return nil
}

type fakePublisher struct {
	err       error
	published [][]enrich.EnrichedEvent
}

func (f *fakePublisher) Publish(_ context.Context, events []enrich.EnrichedEvent) error {
	if f.err != nil {
		return f.err
	}
	f.published = append(f.published, events)
	return nil
}

type rig struct {
	srv     *Server
	ip      *fakeLimiter
	site    *fakeLimiter
	quota   *fakeQuota
	pub     *fakePublisher
	handler http.Handler
}

func newRig(t *testing.T) *rig {
	t.Helper()
	resolved := &site.ResolvedSite{
		ID:          "site-1",
		WorkspaceID: "ws-1",
		Domain:      "example.com",
		Settings:    site.DefaultSettings(),
	}
	r := &rig{
		ip:    &fakeLimiter{allow: true},
		site:  &fakeLimiter{allow: true},
		quota: &fakeQuota{},
		pub:   &fakePublisher{},
	}
	r.srv = &Server{
		Sites:            fakeSites{site: resolved},
		Publisher:        r.pub,
		Limiter:          r.ip,
		SiteLimiter:      r.site,
		Quota:            r.quota,
		MaxBody:          32768,
		TrustedProxyHops: 1,
		QuotaFailOpen:    true,
	}
	r.handler = r.srv.Handler()
	return r
}

// ---- helpers ----------------------------------------------------------------

func goodEvent(overrides map[string]any) map[string]any {
	ev := map[string]any{
		"schemaVersion":    1,
		"eventId":          "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42",
		"type":             "pageview",
		"occurredAt":       time.Now().UTC().Format(time.RFC3339Nano),
		"siteKey":          "site_key_12345",
		"sessionId":        "session-1234",
		"visitorPseudonym": "visitor-1234",
		"url":              "https://example.com/pricing?utm_source=x&secret=1",
		"path":             "/pricing",
	}
	for k, v := range overrides {
		ev[k] = v
	}
	return ev
}

func withID(n int, overrides map[string]any) map[string]any {
	ev := goodEvent(overrides)
	ev["eventId"] = "3f2b8c1e-5a47-4d9e-8b21-" + strings.Repeat("0", 11) + string(rune('a'+n))
	return ev
}

func post(h http.Handler, path string, body any, mutate func(*http.Request)) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(string(raw)))
	r.RemoteAddr = "10.0.0.1:443"
	r.Header.Set("Origin", "https://example.com")
	r.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/120")
	r.Header.Set("X-Forwarded-For", "198.51.100.7")
	if mutate != nil {
		mutate(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func batch(events ...map[string]any) map[string]any { return map[string]any{"events": events} }

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not JSON: %q", w.Body.String())
	}
	return out
}

func publishedEvents(r *rig) []enrich.EnrichedEvent {
	var all []enrich.EnrichedEvent
	for _, b := range r.pub.published {
		all = append(all, b...)
	}
	return all
}

// ---- accepting and rejecting events ------------------------------------------

func TestValidBatchIsPublished(t *testing.T) {
	r := newRig(t)
	w := post(r.handler, "/v1/batch", batch(withID(1, nil), withID(2, nil)), nil)

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	body := decode(t, w)
	if body["processed"] != float64(2) || body["rejected"] != float64(0) {
		t.Fatalf("body = %v", body)
	}
	events := publishedEvents(r)
	if len(events) != 2 || events[0].WorkspaceID != "ws-1" || events[0].SiteID != "site-1" {
		t.Fatalf("published = %+v", events)
	}
	if strings.Contains(events[0].URL, "secret") {
		t.Fatalf("query secrets must be stripped before publishing: %s", events[0].URL)
	}
}

func TestOneBadEventDoesNotBlockTheRestOfTheBatch(t *testing.T) {
	r := newRig(t)
	bad := goodEvent(map[string]any{"eventId": "not-a-uuid"})
	w := post(r.handler, "/v1/batch", batch(withID(1, nil), bad, withID(3, nil)), nil)

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", w.Code)
	}
	body := decode(t, w)
	if body["processed"] != float64(2) || body["rejected"] != float64(1) {
		t.Fatalf("body = %v, want processed 2 rejected 1", body)
	}
	for _, ev := range publishedEvents(r) {
		if ev.EventID == "not-a-uuid" {
			t.Fatal("the invalid event reached Kafka")
		}
	}
}

func TestBatchWithNoValidEventsIsRejected(t *testing.T) {
	r := newRig(t)
	w := post(r.handler, "/v1/batch", batch(withID(1, map[string]any{"occurredAt": "yesterday"})), nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if len(r.pub.published) != 0 {
		t.Fatal("nothing should be published")
	}
}

func TestIdentifyEventIsAcceptedAndKeepsItsUser(t *testing.T) {
	r := newRig(t)
	ev := withID(1, map[string]any{"type": "identify", "userId": "user-42", "userTraits": map[string]any{"plan": "pro"}})
	w := post(r.handler, "/v1/batch", batch(ev), nil)

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	got := publishedEvents(r)
	if len(got) != 1 || got[0].UserID != "user-42" || got[0].UserTraits["plan"] != "pro" {
		t.Fatalf("published = %+v", got)
	}
}

func TestOutOfWindowTimestampIsReplacedWithServerTime(t *testing.T) {
	r := newRig(t)
	old := time.Now().Add(-90 * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
	w := post(r.handler, "/v1/batch", batch(withID(1, map[string]any{"occurredAt": old})), nil)

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d", w.Code)
	}
	got, err := time.Parse(time.RFC3339Nano, publishedEvents(r)[0].OccurredAt)
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(got) > time.Minute {
		t.Fatalf("occurredAt = %v, want roughly now", got)
	}
}

func TestEmptyAndOversizedBatchesAreRefused(t *testing.T) {
	r := newRig(t)
	if w := post(r.handler, "/v1/batch", map[string]any{"events": []any{}}, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("empty batch status = %d", w.Code)
	}
	many := make([]map[string]any, 51)
	for i := range many {
		many[i] = goodEvent(nil)
	}
	if w := post(r.handler, "/v1/batch", map[string]any{"events": many}, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("51-event batch status = %d", w.Code)
	}
}

func TestUnknownSiteKeyIs401(t *testing.T) {
	r := newRig(t)
	r.srv.Sites = fakeSites{err: site.ErrNotFound}
	if w := post(r.handler, "/v1/batch", batch(withID(1, nil)), nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestOriginMismatchIs403(t *testing.T) {
	r := newRig(t)
	w := post(r.handler, "/v1/batch", batch(withID(1, nil)), func(req *http.Request) { req.Header.Set("Origin", "https://evil.example") })
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

// ---- rate limiting -----------------------------------------------------------

func TestRateLimitedIPGets429(t *testing.T) {
	r := newRig(t)
	r.ip.allow = false
	if w := post(r.handler, "/v1/batch", batch(withID(1, nil)), nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
}

func TestRateLimitedSiteGets429(t *testing.T) {
	r := newRig(t)
	r.site.allow = false
	if w := post(r.handler, "/v1/batch", batch(withID(1, nil)), nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
}

func TestRedisOutageDoesNotTurnIntoAnIngestionOutage(t *testing.T) {
	r := newRig(t)
	r.ip.err = errors.New("redis: connection refused")
	r.site.err = errors.New("redis: connection refused")

	w := post(r.handler, "/v1/batch", batch(withID(1, nil)), nil)

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (rate limits fail open)", w.Code)
	}
	if len(publishedEvents(r)) != 1 {
		t.Fatal("the event must still be published")
	}
}

func TestIPLimitUsesTheTrustedForwardedAddress(t *testing.T) {
	r := newRig(t)
	post(r.handler, "/v1/batch", batch(withID(1, nil)), func(req *http.Request) {
		req.Header.Set("X-Forwarded-For", "6.6.6.6, 198.51.100.7")
	})
	if len(r.ip.keys) == 0 || r.ip.keys[0] != "ip:198.51.100.7" {
		t.Fatalf("limiter keys = %v, want the trusted address, not the forged one", r.ip.keys)
	}
}

func TestSiteLimitIsKeyedBySiteNotByIP(t *testing.T) {
	r := newRig(t)
	post(r.handler, "/v1/batch", batch(withID(1, nil)), nil)
	if len(r.site.keys) != 1 || r.site.keys[0] != "site:site-1" {
		t.Fatalf("site limiter keys = %v", r.site.keys)
	}
}

// ---- quota and publishing ----------------------------------------------------

func TestQuotaExceededIs402AndNothingIsPublished(t *testing.T) {
	r := newRig(t)
	r.quota.deny = true
	w := post(r.handler, "/v1/batch", batch(withID(1, nil)), nil)
	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", w.Code)
	}
	if len(r.pub.published) != 0 {
		t.Fatal("over-quota events must not be published")
	}
}

func TestQuotaStoreDownFailsOpenByDefault(t *testing.T) {
	r := newRig(t)
	r.quota.err = errors.New("redis: connection refused")
	w := post(r.handler, "/v1/batch", batch(withID(1, nil)), nil)
	if w.Code != http.StatusAccepted || len(publishedEvents(r)) != 1 {
		t.Fatalf("status = %d published = %d, want events accepted while the counter is unreachable", w.Code, len(publishedEvents(r)))
	}
}

func TestQuotaStoreDownCanFailClosed(t *testing.T) {
	r := newRig(t)
	r.srv.QuotaFailOpen = false
	r.quota.err = errors.New("redis: connection refused")
	w := post(r.handler, "/v1/batch", batch(withID(1, nil)), nil)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	if len(r.pub.published) != 0 {
		t.Fatal("nothing should be published when quota cannot be verified and fail-open is off")
	}
}

func TestPublishFailureGives500AndReleasesTheReservedQuota(t *testing.T) {
	r := newRig(t)
	r.pub.err = errors.New("kafka: leader not available")
	w := post(r.handler, "/v1/batch", batch(withID(1, nil), withID(2, nil)), nil)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 so the SDK retries", w.Code)
	}
	if len(r.quota.released) != 1 || r.quota.released[0]["ws-1"] != 2 {
		t.Fatalf("released = %v, want the 2 reserved events given back", r.quota.released)
	}
}

// ---- misc --------------------------------------------------------------------

func TestPreflightIsCacheable(t *testing.T) {
	r := newRig(t)
	req := httptest.NewRequest(http.MethodOptions, "/v1/batch", nil)
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()
	r.handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d", w.Code)
	}
	if w.Header().Get("Access-Control-Max-Age") == "" {
		t.Fatal("preflight responses must carry Access-Control-Max-Age")
	}
}

func TestTextPlainBodyIsAccepted(t *testing.T) {
	// The SDK sends text/plain to avoid a preflight; the body is still JSON.
	r := newRig(t)
	w := post(r.handler, "/v1/batch", batch(withID(1, nil)), func(req *http.Request) { req.Header.Set("Content-Type", "text/plain;charset=UTF-8") })
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", w.Code)
	}
}

func TestHealth(t *testing.T) {
	r := newRig(t)
	w := httptest.NewRecorder()
	r.handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}
