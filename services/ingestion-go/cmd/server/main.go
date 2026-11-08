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
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/trackme/ingestion-go/internal/config"
	"github.com/trackme/ingestion-go/internal/dedupe"
	"github.com/trackme/ingestion-go/internal/gate"
	"github.com/trackme/ingestion-go/internal/geo"
	"github.com/trackme/ingestion-go/internal/httpapi"
	"github.com/trackme/ingestion-go/internal/lease"
	"github.com/trackme/ingestion-go/internal/limit"
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
	redisTimeout := time.Duration(cfg.RedisTimeoutMs) * time.Millisecond
	if redisTimeout <= 0 {
		redisTimeout = 2 * time.Second
	}
	// A slow counter store must fail the admission call quickly; queueing
	// requests behind it is what turned a remote Redis into a 4 s request path.
	opt.DialTimeout = redisTimeout
	opt.ReadTimeout = redisTimeout
	opt.WriteTimeout = redisTimeout
	opt.MaxRetries = 1
	if cfg.RedisPoolSize > 0 {
		opt.PoolSize = cfg.RedisPoolSize
	}
	if opt.MinIdleConns < 4 {
		opt.MinIdleConns = 4 // pre-dialed, so a burst never waits on connection setup
	}
	if opt.MinIdleConns > opt.PoolSize {
		opt.MinIdleConns = opt.PoolSize
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
		WithShuffle(cfg.KafkaShuffleK).
		WithTimeout(time.Duration(cfg.KafkaPublishTimeoutMs) * time.Millisecond)
	defer publisher.Close()

	var eventPublisher httpapi.EventPublisher = publisher
	var pressure func() float64
	if cfg.AsyncProduce {
		var wal *queue.WAL
		if cfg.WALDir != "" {
			if wal, err = queue.OpenWAL(cfg.WALDir, cfg.WALMaxBytes); err != nil {
				log.Fatalf("wal: %v", err)
			}
			defer wal.Close() // deferred before the publisher's Close, so the publisher drains into it first
			log.Printf("produce: wal spill enabled dir=%s max=%dMB resume=%dKB", cfg.WALDir, cfg.WALMaxBytes>>20, wal.Bytes()>>10)
		}
		asyncPublisher := queue.NewAsyncPublisher(publisher, queue.AsyncOptions{
			WAL:            wal,
			MaxEvents:      cfg.QueueMaxEvents,
			MinBatch:       cfg.ProduceBatchMin,
			MaxBatch:       cfg.ProduceBatchMax,
			FlushInterval:  time.Duration(cfg.ProduceFlushMs) * time.Millisecond,
			MaxAttempts:    cfg.ProduceMaxAttempts,
			RetryBackoff:   time.Duration(cfg.ProduceRetryBackoffMs) * time.Millisecond,
			PublishTimeout: time.Duration(cfg.KafkaPublishTimeoutMs) * time.Millisecond,
		})
		eventPublisher = asyncPublisher
		pressure = asyncPublisher.Pressure
		defer asyncPublisher.Close()
		log.Printf("produce: async queue enabled max=%d batch=%d-%d flush=%dms", cfg.QueueMaxEvents, cfg.ProduceBatchMin, cfg.ProduceBatchMax, cfg.ProduceFlushMs)
	}

	geoResolver := geo.New(cfg.GeoIPMMDBPath).WithLoopbackIP(cfg.GeoLoopbackIP)
	defer geoResolver.Close()

	sitesResolver := site.NewResolver(pool)
	site.WatchInvalidations(ctx, rdb, sitesResolver)

	srv := &httpapi.Server{
		Sites:       sitesResolver,
		Publisher:   eventPublisher,
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

		TrustedProxyHops:    cfg.TrustedProxyHops,
		QuotaFailOpen:       cfg.QuotaFailOpen,
		AdmissionFailClosed: cfg.AdmissionFailClosed,
		IPRateLimitMax:      cfg.RateLimitMax,
		AsyncConfirm:        cfg.AsyncConfirm,

		RequireSignedTimestamp: cfg.SigningRequireTimestamp,
	}
	if cfg.Shed {
		srv.Pressure = pressure
	}
	if cfg.AdaptiveLimit {
		srv.Concurrency = limit.New(cfg.LimitInitial, cfg.LimitMin, cfg.LimitMax)
		metrics.Default.Registry.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "edge_concurrency_limit",
			Help: "Current adaptive cap on in-flight ingest requests.",
		}, srv.Concurrency.Limit))
	}
	var drainLeases func(context.Context) error
	if cfg.EdgeLeases {
		host, _ := os.Hostname()
		la := lease.New(ctx, rdb, lease.Config{
			EdgeID:   fmt.Sprintf("%s-%d-%d", host, os.Getpid(), time.Now().UnixNano()%1_000_000),
			SiteRate: cfg.SiteEventsPerSec,
			Fleet:    cfg.EdgeFleetSize,
			Window:   time.Duration(cfg.RateLimitWindowMs) * time.Millisecond,
		})
		srv.Gate, srv.Deduper = la, la
		drainLeases = la.Drain
		log.Printf("admission: leases enabled (site budget %.0f events/s over %d edge(s)); no per-request Redis calls", cfg.SiteEventsPerSec, cfg.EdgeFleetSize)
	} else if cfg.EdgeGateScript {
		srv.Gate = gate.New(rdb, cfg.SiteRateLimitMax, cfg.RateLimitWindowMs)
		log.Printf("admission: single-script gate enabled (IP + site limit + dedupe claims + quota in one Redis call)")
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
		if !cfg.AdmissionFailClosed {
			log.Printf("warning: ADMISSION_FAIL_CLOSED is off; a Redis outage will bypass rate limit, dedupe and quota")
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
	if drainLeases != nil {
		if err := drainLeases(shutdownCtx); err != nil {
			log.Printf("lease drain failed, unspent quota stays charged until the month rolls over: %v", err)
		}
	}
	log.Println("ingestion-go shut down cleanly")
}
