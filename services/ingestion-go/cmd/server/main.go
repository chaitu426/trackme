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
	"github.com/trackme/ingestion-go/internal/geo"
	"github.com/trackme/ingestion-go/internal/httpapi"
	"github.com/trackme/ingestion-go/internal/queue"
	"github.com/trackme/ingestion-go/internal/quota"
	"github.com/trackme/ingestion-go/internal/ratelimit"
	"github.com/trackme/ingestion-go/internal/site"
)

func main() {
	cfg := config.Load()

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
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
	rdb := redis.NewClient(opt)
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis ping failed: %v", err)
	}

	publisher := queue.NewPublisher(cfg.KafkaBrokers, cfg.KafkaTopic)
	defer publisher.Close()

	geoResolver := geo.New(cfg.GeoIPMMDBPath)
	defer geoResolver.Close()

	sitesResolver := site.NewResolver(pool)
	site.WatchInvalidations(ctx, rdb, sitesResolver)

	srv := &httpapi.Server{
		Sites:     sitesResolver,
		Publisher: publisher,
		Limiter:   ratelimit.New(rdb, cfg.RateLimitMax, cfg.RateLimitWindowMs),
		Quota:     quota.New(rdb),
		Geo:       geoResolver,
		MaxBody:   cfg.MaxBodyBytes,
	}

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
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
