package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type config struct {
	IngestURL       string
	SigningSecret   string
	ListenAddr      string
	MaxBodyBytes    int64
	UpstreamTimeout time.Duration
	AllowAnyOrigin  bool
	AllowedOrigins  map[string]bool
}

func loadConfig() (config, error) {
	cfg := config{
		IngestURL:       strings.TrimRight(env("INGEST_URL", "http://localhost:3001"), "/"),
		SigningSecret:   os.Getenv("SIGNING_SECRET"),
		ListenAddr:      env("LISTEN_ADDR", ":3080"),
		MaxBodyBytes:    envInt("MAX_BODY_BYTES", 32768),
		UpstreamTimeout: 10 * time.Second,
		AllowedOrigins:  map[string]bool{},
	}
	if d, err := time.ParseDuration(env("UPSTREAM_TIMEOUT", "10s")); err == nil && d > 0 {
		cfg.UpstreamTimeout = d
	}
	if cfg.SigningSecret == "" {
		return cfg, errors.New("SIGNING_SECRET is required")
	}
	if _, err := url.Parse(cfg.IngestURL); err != nil {
		return cfg, fmt.Errorf("INGEST_URL is not a valid URL: %w", err)
	}
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		return cfg, errors.New("ALLOWED_ORIGINS is required (comma separated origins, or * for local development)")
	}
	for _, o := range strings.Split(raw, ",") {
		o = normalizeOrigin(o)
		switch o {
		case "":
		case "*":
			cfg.AllowAnyOrigin = true
		default:
			cfg.AllowedOrigins[o] = true
		}
	}
	if !cfg.AllowAnyOrigin && len(cfg.AllowedOrigins) == 0 {
		return cfg, errors.New("ALLOWED_ORIGINS contained no usable origin")
	}
	return cfg, nil
}

func (c config) originList() []string {
	if c.AllowAnyOrigin {
		return []string{"*"}
	}
	out := make([]string, 0, len(c.AllowedOrigins))
	for o := range c.AllowedOrigins {
		out = append(out, o)
	}
	return out
}

func normalizeOrigin(o string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(o), "/"))
}

func (c config) originAllowed(origin string) bool {
	if c.AllowAnyOrigin {
		return true
	}
	return origin != "" && c.AllowedOrigins[normalizeOrigin(origin)]
}

// Headers that describe a single connection and must not be copied across it.
var hopByHop = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-authenticate": true,
	"proxy-authorization": true, "te": true, "trailer": true,
	"transfer-encoding": true, "upgrade": true, "content-length": true,
}

func newHandler(cfg config, client *http.Client) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"ingest-proxy"}`))
	})

	mux.HandleFunc("OPTIONS /v1/batch", func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !cfg.originAllowed(origin) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		setCORS(w, origin)
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		// X-GI-Signature is deliberately absent: the proxy adds it, a browser must not.
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, DNT, X-GI-Consent")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("POST /v1/batch", func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !cfg.originAllowed(origin) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		setCORS(w, origin)

		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, cfg.MaxBodyBytes))
		_ = r.Body.Close()
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}

		mac := hmac.New(sha256.New, []byte(cfg.SigningSecret))
		_, _ = mac.Write(body)

		out, err := http.NewRequestWithContext(r.Context(), http.MethodPost, cfg.IngestURL+"/v1/batch", bytes.NewReader(body))
		if err != nil {
			http.Error(w, "proxy error", http.StatusBadGateway)
			return
		}
		// The SDK sends text/plain to avoid a CORS preflight; the edge expects JSON.
		out.Header.Set("Content-Type", "application/json")
		out.Header.Set("X-GI-Signature", hex.EncodeToString(mac.Sum(nil)))
		for _, h := range []string{"X-GI-Consent", "Origin", "Referer", "User-Agent", "DNT"} {
			if v := r.Header.Get(h); v != "" {
				out.Header.Set(h, v)
			}
		}
		out.Header.Set("X-Forwarded-For", appendPeer(r.Header.Values("X-Forwarded-For"), r.RemoteAddr))

		res, err := client.Do(out)
		if err != nil {
			log.Printf("upstream error: %v", err)
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
			return
		}
		defer res.Body.Close()

		for k, vals := range res.Header {
			lk := strings.ToLower(k)
			// The proxy owns CORS; copying the edge's headers would send the browser two of each.
			if hopByHop[lk] || strings.HasPrefix(lk, "access-control-") || lk == "vary" {
				continue
			}
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(res.StatusCode)
		_, _ = io.Copy(w, res.Body)
	})

	return mux
}

func setCORS(w http.ResponseWriter, origin string) {
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	} else {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	}
	w.Header().Set("Vary", "Origin")
}

// appendPeer extends X-Forwarded-For with the address that connected to us.
// Existing entries are kept so the chain still shows every hop; the edge only
// trusts the entries added by its own proxies, counted from the right.
func appendPeer(existing []string, remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	chain := make([]string, 0, len(existing)+1)
	for _, line := range existing {
		if line = strings.TrimSpace(line); line != "" {
			chain = append(chain, line)
		}
	}
	return strings.Join(append(chain, host), ", ")
}
