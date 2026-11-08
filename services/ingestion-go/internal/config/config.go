package config

import (
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Development fallbacks. They are public (they live in this repository), so a
// production process must never run on them; see Config.ProductionProblems.
const (
	DefaultDatabaseURL   = "postgres://growth_admin:growth_secure_pass@localhost:5432/growth_intelligence"
	DefaultRedisURL      = "redis://:redis_dev_secret@localhost:6379"
	DefaultSiteSecretKey = "dev-site-signing-secret-key-min-32-chars"
)

type Config struct {
	Port                int
	DatabaseURL         string
	RedisURL            string
	RedisRateLimitURL   string
	RedisCacheURL       string
	RedisStateURL       string
	RedisCoordURL       string
	KafkaBrokers        []string
	KafkaTopic          string
	KafkaCompression    string
	KafkaSSL            bool
	KafkaSASLMech       string
	KafkaSASLUser       string
	KafkaSASLPassword   string
	KafkaCACertPath     string
	RateLimitMax        int
	RateLimitWindowMs   int
	SiteRateLimitMax    int
	QuotaFailOpen       bool
	AdmissionFailClosed bool
	AsyncConfirm        bool
	EdgeDedupe          bool
	EdgeGateScript      bool
	// AsyncProduce moves the Kafka write off the request path into a bounded
	// in-process queue drained by a batched background producer.
	AsyncProduce          bool
	QueueMaxEvents        int
	ProduceBatchMin       int
	ProduceBatchMax       int
	ProduceFlushMs        int
	ProduceMaxAttempts    int
	ProduceRetryBackoffMs int
	// WALDir enables the disk spill for events Kafka cannot take (empty = off, shed/drop as before).
	WALDir      string
	WALMaxBytes int64
	// EdgeLeases replaces the per-request Redis admission script with leased rates and quota
	// chunks (internal/lease). SiteEventsPerSec is the fleet-wide budget of one site; EdgeFleetSize
	// is how many edge instances share it (sizes the safe rate and the quota chunks).
	EdgeLeases       bool
	SiteEventsPerSec float64
	EdgeFleetSize    int
	// KafkaShuffleK confines each site to this many partitions (0 = spread over all).
	KafkaShuffleK int
	// SigningRequireTimestamp refuses signed ingestion requests without X-GI-Timestamp (replay protection).
	SigningRequireTimestamp bool
	// Shed enables load-dependent sampling of web-vital events and SDK back-off hints.
	Shed bool
	// AdaptiveLimit caps in-flight requests by observed latency; the bounds are in requests.
	AdaptiveLimit bool
	LimitInitial  int
	LimitMin      int
	LimitMax      int
	// RedisTimeoutMs bounds one Redis call so admission fails fast instead of
	// queueing requests behind a slow remote counter store.
	RedisTimeoutMs int
	RedisPoolSize  int
	// MetricsPort, when set, serves /metrics on its own listener and removes it from the public port.
	MetricsPort int
	// KafkaPublishTimeoutMs bounds one publish so a stalled broker cannot hold requests past the HTTP write timeout.
	KafkaPublishTimeoutMs int
	MaxBodyBytes          int64
	DefaultRetention      int
	GeoIPMMDBPath         string
	GeoLoopbackIP         string
	TrustedProxyHops      int
	// TrustedProxyHopsSet is true when TRUSTED_PROXY_HOPS was provided. Production requires it: the default (1)
	// is only right behind exactly one proxy, and wrong in a way that lets clients forge their address when the
	// service is exposed directly.
	TrustedProxyHopsSet bool
	// AllowPublicMetrics accepts serving /metrics on the public port. Otherwise production must set METRICS_PORT.
	AllowPublicMetrics bool
	SiteSecretKey      string
}

func Load() Config {
	_ = godotenv.Load()
	_ = godotenv.Load("../../.env")

	topic := envStr("KAFKA_TOPIC", "growth_events")

	return Config{
		Port:                    envInt("INGESTION_PORT", 3001),
		DatabaseURL:             envStr("DATABASE_URL", DefaultDatabaseURL),
		RedisURL:                envStr("REDIS_URL", DefaultRedisURL),
		RedisRateLimitURL:       envStr("REDIS_RATELIMIT_URL", envStr("REDIS_URL", DefaultRedisURL)),
		RedisCacheURL:           envStr("REDIS_CACHE_URL", envStr("REDIS_URL", DefaultRedisURL)),
		RedisStateURL:           envStr("REDIS_STATE_URL", envStr("REDIS_URL", DefaultRedisURL)),
		RedisCoordURL:           envStr("REDIS_COORD_URL", envStr("REDIS_URL", DefaultRedisURL)),
		KafkaBrokers:            splitCSV(envStr("KAFKA_BROKERS", "localhost:9092")),
		KafkaTopic:              topic,
		KafkaCompression:        envStr("KAFKA_COMPRESSION", "zstd"),
		KafkaSSL:                envBool("KAFKA_SSL", false),
		KafkaSASLMech:           envStr("KAFKA_SASL_MECHANISM", ""),
		KafkaSASLUser:           envStr("KAFKA_SASL_USERNAME", ""),
		KafkaSASLPassword:       envStr("KAFKA_SASL_PASSWORD", ""),
		KafkaCACertPath:         envStr("KAFKA_CA_CERT_PATH", ""),
		RateLimitMax:            envInt("INGESTION_RATE_LIMIT_MAX", 1000),
		RateLimitWindowMs:       envInt("INGESTION_RATE_LIMIT_WINDOW_MS", 60000),
		SiteRateLimitMax:        envInt("SITE_RATE_LIMIT_MAX", 10000),
		QuotaFailOpen:           envBool("QUOTA_FAIL_OPEN", false),
		AdmissionFailClosed:     envBool("ADMISSION_FAIL_CLOSED", true),
		AsyncConfirm:            envBool("EDGE_ASYNC_CONFIRM", true),
		EdgeDedupe:              envBool("EDGE_DEDUPE", true),
		EdgeGateScript:          envBool("EDGE_GATE_SCRIPT", true),
		AsyncProduce:            envBool("EDGE_ASYNC_PRODUCE", true),
		QueueMaxEvents:          envInt("EDGE_QUEUE_MAX_EVENTS", 10000),
		ProduceBatchMin:         envInt("EDGE_PRODUCE_BATCH_MIN", 500),
		ProduceBatchMax:         envInt("EDGE_PRODUCE_BATCH_MAX", 5000),
		ProduceFlushMs:          envInt("EDGE_PRODUCE_FLUSH_MS", 50),
		ProduceMaxAttempts:      envInt("EDGE_PRODUCE_MAX_ATTEMPTS", 5),
		ProduceRetryBackoffMs:   envInt("EDGE_PRODUCE_RETRY_BACKOFF_MS", 100),
		WALDir:                  envStr("EDGE_WAL_DIR", ""),
		WALMaxBytes:             int64(envInt("EDGE_WAL_MAX_MB", 4096)) << 20,
		EdgeLeases:              envBool("EDGE_LEASES", false),
		SiteEventsPerSec:        float64(envInt("SITE_EVENTS_PER_SEC", 2000)),
		EdgeFleetSize:           envInt("EDGE_FLEET_SIZE", 1),
		KafkaShuffleK:           envInt("KAFKA_SHUFFLE_K", 0),
		SigningRequireTimestamp: envBool("SIGNING_REQUIRE_TIMESTAMP", false),
		Shed:                    envBool("EDGE_SHED", false),
		AdaptiveLimit:           envBool("EDGE_ADAPTIVE_LIMIT", false),
		LimitInitial:            envInt("EDGE_LIMIT_INITIAL", 1024),
		LimitMin:                envInt("EDGE_LIMIT_MIN", 64),
		LimitMax:                envInt("EDGE_LIMIT_MAX", 20000),
		RedisTimeoutMs:          envInt("REDIS_TIMEOUT_MS", 2000),
		RedisPoolSize:           envInt("REDIS_POOL_SIZE", 50),
		MetricsPort:             envInt("METRICS_PORT", 0),
		KafkaPublishTimeoutMs:   envInt("KAFKA_PUBLISH_TIMEOUT_MS", 10000),
		MaxBodyBytes:            int64(envInt("MAX_EVENT_PAYLOAD_BYTES", 32768)),
		DefaultRetention:        envInt("DEFAULT_RETENTION_MONTHS", 24),
		GeoIPMMDBPath:           envStr("GEOIP_MMDB_PATH", ""),
		GeoLoopbackIP:           envStr("GEO_LOOPBACK_IP", ""),
		TrustedProxyHops:        envInt("TRUSTED_PROXY_HOPS", 1),
		TrustedProxyHopsSet:     strings.TrimSpace(os.Getenv("TRUSTED_PROXY_HOPS")) != "",
		AllowPublicMetrics:      envBool("ALLOW_PUBLIC_METRICS", false),
		SiteSecretKey:           envStr("SITE_SIGNING_SECRET_KEY", DefaultSiteSecretKey),
	}
}

// ProductionProblems lists settings that make the process unsafe to run when
// nodeEnv is "production". It returns nothing in any other environment.
func (c Config) ProductionProblems(nodeEnv string) []string {
	if nodeEnv != "production" {
		return nil
	}
	var problems []string
	if c.GeoLoopbackIP != "" {
		problems = append(problems, "GEO_LOOPBACK_IP is a development setting and would mislocate every private-address client")
	}
	if c.DatabaseURL == DefaultDatabaseURL {
		problems = append(problems, "DATABASE_URL is unset or still the public development default")
	}
	if c.RedisURL == DefaultRedisURL {
		problems = append(problems, "REDIS_URL is unset or still the public development default")
	}
	if c.RedisRateLimitURL == DefaultRedisURL {
		problems = append(problems, "REDIS_RATELIMIT_URL is unset or still the public development default")
	}
	if c.RedisCacheURL == DefaultRedisURL {
		problems = append(problems, "REDIS_CACHE_URL is unset or still the public development default")
	}
	if c.RedisStateURL == DefaultRedisURL {
		problems = append(problems, "REDIS_STATE_URL is unset or still the public development default")
	}
	if c.RedisCoordURL == DefaultRedisURL {
		problems = append(problems, "REDIS_COORD_URL is unset or still the public development default")
	}
	if c.SiteSecretKey == DefaultSiteSecretKey {
		problems = append(problems, "SITE_SIGNING_SECRET_KEY is unset or still the public development default")
	}
	if c.TrustedProxyHops < 0 {
		problems = append(problems, "TRUSTED_PROXY_HOPS must not be negative")
	}
	if !c.TrustedProxyHopsSet {
		problems = append(problems, "TRUSTED_PROXY_HOPS must be set explicitly in production: the number of reverse proxies in front of this service, or 0 if clients connect directly")
	}
	if c.MetricsPort <= 0 && !c.AllowPublicMetrics {
		problems = append(problems, "METRICS_PORT is not set, so /metrics (queue depths, error counts) would be served on the public port; set METRICS_PORT to a private listener, or ALLOW_PUBLIC_METRICS=true to accept that")
	}
	return problems
}

func envStr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
	}
	return fallback
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{"localhost:9092"}
	}
	return out
}
