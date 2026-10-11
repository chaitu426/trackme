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
	DefaultDatabaseURL = "postgres://growth_admin:growth_secure_pass@localhost:5432/growth_intelligence"
	DefaultRedisURL      = "redis://:redis_dev_secret@localhost:6379"
	DefaultSiteSecretKey = "dev-site-signing-secret-key-min-32-chars"
)

type Config struct {
	Port              int
	DatabaseURL       string
	RedisURL          string
	RedisRateLimitURL string
	RedisCacheURL     string
	RedisStateURL     string
	RedisCoordURL     string
	KafkaBrokers      []string
	KafkaTopic        string
	RateLimitMax      int
	RateLimitWindowMs int
	SiteRateLimitMax  int
	QuotaFailOpen     bool
	MaxBodyBytes      int64
	DefaultRetention  int
	GeoIPMMDBPath     string
	TrustedProxyHops  int
	SiteSecretKey     string
}

func Load() Config {
	_ = godotenv.Load()
	_ = godotenv.Load("../../.env")

	topic := envStr("KAFKA_TOPIC", "growth_events")

	return Config{
		Port:              envInt("INGESTION_PORT", 3001),
		DatabaseURL:       envStr("DATABASE_URL", DefaultDatabaseURL),
		RedisURL:          envStr("REDIS_URL", DefaultRedisURL),
		RedisRateLimitURL: envStr("REDIS_RATELIMIT_URL", envStr("REDIS_URL", DefaultRedisURL)),
		RedisCacheURL:     envStr("REDIS_CACHE_URL", envStr("REDIS_URL", DefaultRedisURL)),
		RedisStateURL:     envStr("REDIS_STATE_URL", envStr("REDIS_URL", DefaultRedisURL)),
		RedisCoordURL:     envStr("REDIS_COORD_URL", envStr("REDIS_URL", DefaultRedisURL)),
		KafkaBrokers:      splitCSV(envStr("KAFKA_BROKERS", "localhost:9092")),
		KafkaTopic:        topic,
		RateLimitMax:      envInt("INGESTION_RATE_LIMIT_MAX", 1000),
		RateLimitWindowMs: envInt("INGESTION_RATE_LIMIT_WINDOW_MS", 60000),
		SiteRateLimitMax:  envInt("SITE_RATE_LIMIT_MAX", 10000),
		QuotaFailOpen:     envBool("QUOTA_FAIL_OPEN", true),
		MaxBodyBytes:      int64(envInt("MAX_EVENT_PAYLOAD_BYTES", 32768)),
		DefaultRetention:  envInt("DEFAULT_RETENTION_MONTHS", 24),
		GeoIPMMDBPath:     envStr("GEOIP_MMDB_PATH", ""),
		TrustedProxyHops:  envInt("TRUSTED_PROXY_HOPS", 1),
		SiteSecretKey:     envStr("SITE_SIGNING_SECRET_KEY", DefaultSiteSecretKey),
	}
}

// ProductionProblems lists settings that make the process unsafe to run when
// nodeEnv is "production". It returns nothing in any other environment.
func (c Config) ProductionProblems(nodeEnv string) []string {
	if nodeEnv != "production" {
		return nil
	}
	var problems []string
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
