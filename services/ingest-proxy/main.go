package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

// Tiny first-party signing proxy:
//   Browser → :3080/v1/batch → adds X-GI-Signature → INGEST_URL
//
// Env:
//   INGEST_URL=http://localhost:3001
//   SIGNING_SECRET=gis_...
//   LISTEN_ADDR=:3080
func main() {
	ingest := strings.TrimRight(env("INGEST_URL", "http://localhost:3001"), "/")
	secret := os.Getenv("SIGNING_SECRET")
	if secret == "" {
		log.Fatal("SIGNING_SECRET is required")
	}
	target, err := url.Parse(ingest)
	if err != nil {
		log.Fatal(err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	proxy.Director = func(req *http.Request) {
		original(req)
		req.Host = target.Host
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"ingest-proxy"}`))
	})
	mux.HandleFunc("/v1/batch", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		_ = r.Body.Close()
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write(body)
		sig := hex.EncodeToString(mac.Sum(nil))

		out, err := http.NewRequestWithContext(r.Context(), http.MethodPost, ingest+"/v1/batch", strings.NewReader(string(body)))
		if err != nil {
			http.Error(w, "proxy error", http.StatusBadGateway)
			return
		}
		out.Header.Set("Content-Type", "application/json")
		out.Header.Set("X-GI-Signature", sig)
		if c := r.Header.Get("X-GI-Consent"); c != "" {
			out.Header.Set("X-GI-Consent", c)
		}
		if o := r.Header.Get("Origin"); o != "" {
			out.Header.Set("Origin", o)
		}
		if rf := r.Header.Get("Referer"); rf != "" {
			out.Header.Set("Referer", rf)
		}
		if ua := r.Header.Get("User-Agent"); ua != "" {
			out.Header.Set("User-Agent", ua)
		}
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			out.Header.Set("X-Forwarded-For", xff)
		} else {
			out.Header.Set("X-Forwarded-For", strings.Split(r.RemoteAddr, ":")[0])
		}

		res, err := http.DefaultClient.Do(out)
		if err != nil {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
			return
		}
		defer res.Body.Close()
		for k, vals := range res.Header {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(res.StatusCode)
		_, _ = io.Copy(w, res.Body)
	})

	addr := env("LISTEN_ADDR", ":3080")
	srv := &http.Server{Addr: addr, Handler: withCORS(mux), ReadHeaderTimeout: 5 * time.Second}
	log.Printf("first-party ingest proxy on %s → %s", addr, ingest)
	log.Fatal(srv.ListenAndServe())
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, DNT, X-GI-Consent")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
