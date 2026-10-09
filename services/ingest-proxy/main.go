package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// First-party signing proxy.
//
//	Browser -> /v1/batch -> adds X-GI-Signature -> INGEST_URL/v1/batch
//
// The signing secret never reaches the page. Because the proxy signs whatever
// it is given, it is only as strong as the checks in front of the signature:
// requests must come from an allowed origin and fit the edge's size limit.
//
// Env:
//
//	SIGNING_SECRET    required, the site's signing secret (gis_...)
//	ALLOWED_ORIGINS   required, comma separated, e.g. https://example.com,https://www.example.com
//	                  "*" allows any origin and is meant for local development only
//	INGEST_URL        default http://localhost:3001
//	LISTEN_ADDR       default :3080
//	MAX_BODY_BYTES    default 32768, matching the edge's MAX_EVENT_PAYLOAD_BYTES
//	UPSTREAM_TIMEOUT  default 10s
func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	if cfg.AllowAnyOrigin {
		log.Printf("WARNING: ALLOWED_ORIGINS=* lets any website use this proxy to sign requests; do not run this in production")
	}

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           newHandler(cfg, &http.Client{Timeout: cfg.UpstreamTimeout}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      cfg.UpstreamTimeout + 5*time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("first-party ingest proxy on %s -> %s (origins: %s)", cfg.ListenAddr, cfg.IngestURL, strings.Join(cfg.originList(), ", "))
	log.Fatal(srv.ListenAndServe())
}

func env(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int64) int64 {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return d
}
