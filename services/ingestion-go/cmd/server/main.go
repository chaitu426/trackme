package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/trackme/ingestion-go/internal/config"
	"github.com/trackme/ingestion-go/internal/dedupe"
	"github.com/trackme/ingestion-go/internal/gate"
	"github.com/trackme/ingestion-go/internal/geo"
	"github.com/trackme/ingestion-go/internal/httpapi"
	"github.com/trackme/ingestion-go/internal/metrics"
	"github.com/trackme/ingestion-go/internal/queue"
	"github.com/trackme/ingestion-go/internal/quota"
	"github.com/trackme/ingestion-go/internal/ratelimit"
	"github.com/trackme/ingestion-go/internal/site"
)

func main() {
	cfg := config.Load()
	if problems := cfg.ProductionProblems(os.Getenv("NODE_ENV")); len(problems) > 0 {
		for _, p := range problems {
			log.Printf("unsafe production configuration: %s", p)
		}
		log.Fatal("refusing to start; fix the settings above")
	}

	ctx := context.Background()
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("postgres url parse failed: %v", err)
	}
	// Keep a few connections open so the first lookup after startup or an idle period
	// does not pay a TCP+auth handshake (seconds on a cold dev database).
	if poolCfg.MinConns < 2 {
		poolCfg.MinConns = 2
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		log.Fatalf("postgres connect failed: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("postgres ping failed: %v", err)
	}

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis url parse failed: %v", err)
	}
	if opt.MinIdleConns < 4 {
		opt.MinIdleConns = 4 // pre-dialed, so a burst never waits on connection setup
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis ping failed: %v", err)
	}

	compression, err := queue.ParseCompression(cfg.KafkaCompression)
	if err != nil {
		log.Fatalf("%v", err)
	}
	kafkaTransport, err := queue.Security{
		SSL:           cfg.KafkaSSL,
		SASLMechanism: cfg.KafkaSASLMech,
		Username:      cfg.KafkaSASLUser,
		Password:      cfg.KafkaSASLPassword,
		CACertPath:    cfg.KafkaCACertPath,
	}.Transport()
	if err != nil {
		log.Fatalf("kafka security: %v", err)
	}
	publisher := queue.NewPublisher(cfg.KafkaBrokers, cfg.KafkaTopic, compression).
		WithTransport(kafkaTransport).
		WithTimeout(time.Duration(cfg.KafkaPublishTimeoutMs) * time.Millisecond)
	defer publisher.Close()

	geoResolver := geo.New(cfg.GeoIPMMDBPath).WithLoopbackIP(cfg.GeoLoopbackIP)
	defer geoResolver.Close()

	sitesResolver := site.NewResolver(pool)
	site.WatchInvalidations(ctx, rdb, sitesResolver)

	srv := &httpapi.Server{
		Sites:       sitesResolver,
		Publisher:   publisher,
		Limiter:     ratelimit.New(rdb, cfg.RateLimitMax, cfg.RateLimitWindowMs),
		SiteLimiter: ratelimit.New(rdb, cfg.SiteRateLimitMax, cfg.RateLimitWindowMs),
		Quota:       quota.New(rdb),
		Deduper:     dedupe.New(rdb),
		EdgeDedupe:  cfg.EdgeDedupe,
		Geo:         geoResolver,
		MaxBody:     cfg.MaxBodyBytes,

		HideMetrics: cfg.MetricsPort > 0,
		ReadyChecks: []httpapi.ReadyCheck{
			{Name: "postgres", Check: pool.Ping},
			{Name: "redis", Check: func(ctx context.Context) error { return rdb.Ping(ctx).Err() }},
			{Name: "kafka", Check: publisher.Ping},
		},

		TrustedProxyHops: cfg.TrustedProxyHops,
		QuotaFailOpen:    cfg.QuotaFailOpen,
		AsyncConfirm:     cfg.AsyncConfirm,
	}
	if cfg.EdgeGateScript {
		srv.Gate = gate.New(rdb, cfg.SiteRateLimitMax, cfg.RateLimitWindowMs)
		log.Printf("admission: single-script gate enabled (site limit + dedupe claims + quota in one Redis call)")
	}

	if cfg.TrustedProxyHops <= 0 {
		log.Printf("client IP: TRUSTED_PROXY_HOPS=0, using the TCP peer address (correct only when nothing sits in front of this service)")
	} else {
		log.Printf("client IP: trusting %d proxy hop(s) in X-Forwarded-For (set TRUSTED_PROXY_HOPS=0 if this service is exposed directly)", cfg.TrustedProxyHops)
	}

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	if cfg.MetricsPort > 0 {
		metricsMux := http.NewServeMux()
		metricsMux.Handle("GET /metrics", metrics.Handler())
		go func() {
			log.Printf("metrics on :%d (private port)", cfg.MetricsPort)
			metricsServer := &http.Server{Addr: fmt.Sprintf(":%d", cfg.MetricsPort), Handler: metricsMux, ReadHeaderTimeout: 5 * time.Second}
			if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("metrics server error: %v", err)
			}
		}()
	} else if os.Getenv("NODE_ENV") == "production" {
		log.Printf("warning: /metrics is served on the public port; set METRICS_PORT to move it to a private listener")
	}
	if os.Getenv("NODE_ENV") == "production" {
		if !cfg.EdgeDedupe {
			log.Printf("warning: EDGE_DEDUPE is off, so a client retry after a lost response is stored twice until ClickHouse merges the duplicates")
		}
		if cfg.QuotaFailOpen {
			log.Printf("warning: QUOTA_FAIL_OPEN is on, so quota and rate limits are not enforced while Redis is unreachable")
		}
	}

	go func() {
		log.Printf("🚀 Go ingestion edge on :%d → kafka://%v topic=%s", cfg.Port, cfg.KafkaBrokers, cfg.KafkaTopic)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	log.Println("ingestion-go shut down cleanly")
}
