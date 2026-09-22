package config

import (
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port              int
	DatabaseURL       string
	RedisURL          string
	KafkaBrokers      []string
	KafkaTopic        string
	RateLimitMax      int
	RateLimitWindowMs int
	MaxBodyBytes      int64
	DefaultRetention  int
	GeoIPMMDBPath     string
}

func Load() Config {
	_ = godotenv.Load()
	_ = godotenv.Load("../../.env")

	topic := envStr("KAFKA_TOPIC", "")
	if topic == "" {
		topic = envStr("QUEUE_NAME", "growth_events")
	}

	return Config{
		Port:              envInt("INGESTION_PORT", 3001),
		DatabaseURL:       envStr("DATABASE_URL", "postgres://growth_admin:growth_secure_pass@localhost:5432/growth_intelligence"),
		RedisURL:          envStr("REDIS_URL", "redis://:redis_dev_secret@localhost:6379"),
		KafkaBrokers:      splitCSV(envStr("KAFKA_BROKERS", "localhost:9092")),
		KafkaTopic:        topic,
		RateLimitMax:      envInt("INGESTION_RATE_LIMIT_MAX", 1000),
		RateLimitWindowMs: envInt("INGESTION_RATE_LIMIT_WINDOW_MS", 60000),
		MaxBodyBytes:      int64(envInt("MAX_EVENT_PAYLOAD_BYTES", 32768)),
		DefaultRetention:  envInt("DEFAULT_RETENTION_MONTHS", 24),
		GeoIPMMDBPath:     envStr("GEOIP_MMDB_PATH", ""),
	}
}

func envStr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
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
