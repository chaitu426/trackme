package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const secret = "gis_test_secret"

type upstream struct {
	srv   *httptest.Server
	calls atomic.Int32
	last  struct {
		body    string
		headers http.Header
	}
}

func newUpstream(t *testing.T, status int) *upstream {
	t.Helper()
	u := &upstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.calls.Add(1)
		b, _ := io.ReadAll(r.Body)
		u.last.body = string(b)
		u.last.headers = r.Header.Clone()
		// The real edge sets its own CORS headers; the proxy must not pass them on.
		w.Header().Set("Access-Control-Allow-Origin", "https://edge-reflected.example")
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"status":"accepted"}`))
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func testConfig(ingestURL string, origins ...string) config {
	cfg := config{
		IngestURL:       ingestURL,
		SigningSecret:   secret,
		MaxBodyBytes:    1024,
		UpstreamTimeout: 2 * time.Second,
		AllowedOrigins:  map[string]bool{},
	}
	for _, o := range origins {
		if o == "*" {
			cfg.AllowAnyOrigin = true
		} else {
			cfg.AllowedOrigins[normalizeOrigin(o)] = true
		}
	}
	return cfg
}

func post(h http.Handler, origin, body string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/v1/batch", strings.NewReader(body))
	r.RemoteAddr = "203.0.113.9:4444"
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if mutate != nil {
		mutate(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestSignsTheExactBodyAndForwardsIt(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)
	body := `{"events":[{"eventId":"x"}]}`

	w := post(h, "https://example.com", body, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain;charset=UTF-8") })

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", w.Code)
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	want := hex.EncodeToString(mac.Sum(nil))
	if got := up.last.headers.Get("X-GI-Signature"); got != want {
		t.Fatalf("signature = %q, want %q", got, want)
	}
	if up.last.body != body {
		t.Fatalf("upstream body = %q, want %q", up.last.body, body)
	}
	if ct := up.last.headers.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("upstream content type = %q, want application/json", ct)
	}
}

func TestDisallowedOriginIsRefusedWithoutSigning(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)

	for _, origin := range []string{"https://evil.example", "https://example.com.evil.example", "http://example.com", ""} {
		w := post(h, origin, `{"events":[]}`, nil)
		if w.Code != http.StatusForbidden {
			t.Errorf("origin %q: status = %d, want 403", origin, w.Code)
		}
	}
	if n := up.calls.Load(); n != 0 {
		t.Fatalf("upstream was called %d times for refused origins; the proxy signed for them", n)
	}
}

func TestOriginMatchIgnoresCaseAndTrailingSlash(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://Example.com/"), http.DefaultClient)
	if w := post(h, "https://example.com", `{}`, nil); w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", w.Code)
	}
}

func TestWildcardOriginAllowsAnyone(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "*"), http.DefaultClient)
	if w := post(h, "https://anything.example", `{}`, nil); w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", w.Code)
	}
}

func TestOversizedBodyIsRejectedBeforeSigning(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)

	w := post(h, "https://example.com", strings.Repeat("a", 2048), nil)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", w.Code)
	}
	if up.calls.Load() != 0 {
		t.Fatal("an oversized body must not be signed or forwarded")
	}
}

func TestClientSuppliedSignatureCannotReachTheEdge(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)

	post(h, "https://example.com", `{"events":[]}`, func(r *http.Request) { r.Header.Set("X-GI-Signature", "forged") })

	if got := up.last.headers.Get("X-GI-Signature"); got == "forged" || got == "" {
		t.Fatalf("edge saw signature %q; it must be the proxy's own", got)
	}
}

func TestForwardedForKeepsTheChainAndAppendsThePeer(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)

	post(h, "https://example.com", `{}`, func(r *http.Request) { r.Header.Set("X-Forwarded-For", "6.6.6.6, 198.51.100.7") })

	// A forged leading entry survives, but the proxy's own peer is last, which is
	// the entry the edge reads when it trusts one hop.
	if got := up.last.headers.Get("X-Forwarded-For"); got != "6.6.6.6, 198.51.100.7, 203.0.113.9" {
		t.Fatalf("X-Forwarded-For = %q", got)
	}
}

func TestCORSHeadersComeOnlyFromTheProxy(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)

	w := post(h, "https://example.com", `{}`, nil)

	if got := w.Header().Values("Access-Control-Allow-Origin"); len(got) != 1 || got[0] != "https://example.com" {
		t.Fatalf("Access-Control-Allow-Origin = %v, want exactly the request origin", got)
	}
	if got := w.Header().Values("Vary"); len(got) != 1 {
		t.Fatalf("Vary = %v, want a single value", got)
	}
}

func TestPreflight(t *testing.T) {
	up := newUpstream(t, http.StatusAccepted)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)

	allowed := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodOptions, "/v1/batch", nil)
	r.Header.Set("Origin", "https://example.com")
	h.ServeHTTP(allowed, r)
	if allowed.Code != http.StatusNoContent {
		t.Fatalf("allowed preflight status = %d, want 204", allowed.Code)
	}
	if strings.Contains(allowed.Header().Get("Access-Control-Allow-Headers"), "Signature") {
		t.Fatal("browsers must not be allowed to send their own signature")
	}
	if allowed.Header().Get("Access-Control-Max-Age") == "" {
		t.Fatal("preflight responses must be cacheable")
	}

	blocked := httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodOptions, "/v1/batch", nil)
	r.Header.Set("Origin", "https://evil.example")
	h.ServeHTTP(blocked, r)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("blocked preflight status = %d, want 403", blocked.Code)
	}
}

func TestUpstreamFailureAndTimeoutBecomeBadGateway(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := down.URL
	down.Close()
	h := newHandler(testConfig(url, "https://example.com"), http.DefaultClient)
	if w := post(h, "https://example.com", `{}`, nil); w.Code != http.StatusBadGateway {
		t.Fatalf("unreachable upstream: status = %d, want 502", w.Code)
	}

	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	}))
	defer slow.Close()
	h = newHandler(testConfig(slow.URL, "https://example.com"), &http.Client{Timeout: 100 * time.Millisecond})
	start := time.Now()
	w := post(h, "https://example.com", `{}`, nil)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("slow upstream: status = %d, want 502", w.Code)
	}
	if time.Since(start) > time.Second {
		t.Fatal("the proxy waited far longer than its timeout")
	}
}

func TestUpstreamStatusIsPassedThrough(t *testing.T) {
	up := newUpstream(t, http.StatusTooManyRequests)
	h := newHandler(testConfig(up.srv.URL, "https://example.com"), http.DefaultClient)
	if w := post(h, "https://example.com", `{}`, nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want the edge's 429", w.Code)
	}
}

func TestLoadConfigRequiresSecretAndOrigins(t *testing.T) {
	t.Setenv("SIGNING_SECRET", "")
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")
	if _, err := loadConfig(); err == nil {
		t.Fatal("missing SIGNING_SECRET must be an error")
	}

	t.Setenv("SIGNING_SECRET", secret)
	t.Setenv("ALLOWED_ORIGINS", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("missing ALLOWED_ORIGINS must be an error, not an open proxy")
	}

	t.Setenv("ALLOWED_ORIGINS", " , ")
	if _, err := loadConfig(); err == nil {
		t.Fatal("an origin list with no usable entry must be an error")
	}

	t.Setenv("ALLOWED_ORIGINS", "https://a.example, https://B.example/")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.originAllowed("https://b.example") || cfg.originAllowed("https://c.example") {
		t.Fatal("origin allowlist not applied")
	}
}
