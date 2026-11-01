package config

import "testing"

func TestProductionProblems(t *testing.T) {
	good := Config{DatabaseURL: "postgres://app:pw@db.internal/growth", RedisURL: "redis://:pw@cache.internal:6379", TrustedProxyHops: 1}

	tests := []struct {
		name    string
		cfg     Config
		nodeEnv string
		want    int
	}{
		{"development may use the defaults", Config{DatabaseURL: DefaultDatabaseURL, RedisURL: DefaultRedisURL}, "development", 0},
		{"unset environment may use the defaults", Config{DatabaseURL: DefaultDatabaseURL, RedisURL: DefaultRedisURL}, "", 0},
		{"production with real settings is fine", good, "production", 0},
		{"production with the default database", Config{DatabaseURL: DefaultDatabaseURL, RedisURL: good.RedisURL}, "production", 1},
		{"production with the default redis", Config{DatabaseURL: good.DatabaseURL, RedisURL: DefaultRedisURL}, "production", 1},
		{"production with both defaults", Config{DatabaseURL: DefaultDatabaseURL, RedisURL: DefaultRedisURL}, "production", 2},
		{"negative proxy hops", Config{DatabaseURL: good.DatabaseURL, RedisURL: good.RedisURL, TrustedProxyHops: -1}, "production", 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := len(tc.cfg.ProductionProblems(tc.nodeEnv)); got != tc.want {
				t.Fatalf("problems = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestTrustedProxyHopsDefaultsToOne(t *testing.T) {
	t.Setenv("TRUSTED_PROXY_HOPS", "")
	if got := Load().TrustedProxyHops; got != 1 {
		t.Fatalf("TrustedProxyHops = %d, want 1", got)
	}
	t.Setenv("TRUSTED_PROXY_HOPS", "0")
	if got := Load().TrustedProxyHops; got != 0 {
		t.Fatalf("TrustedProxyHops = %d, want 0 when explicitly set", got)
	}
}

func TestEdgeDedupeIsOptIn(t *testing.T) {
	t.Setenv("EDGE_DEDUPE", "")
	if got := Load().EdgeDedupe; got {
		t.Fatal("EdgeDedupe = true by default, want false for staged rollout")
	}
	t.Setenv("EDGE_DEDUPE", "true")
	if got := Load().EdgeDedupe; !got {
		t.Fatal("EdgeDedupe = false, want true when enabled")
	}
}

func TestOpsDefaults(t *testing.T) {
	t.Setenv("METRICS_PORT", "")
	t.Setenv("KAFKA_PUBLISH_TIMEOUT_MS", "")
	c := Load()
	if c.MetricsPort != 0 {
		t.Fatalf("MetricsPort = %d, want 0 (served on the main port unless configured)", c.MetricsPort)
	}
	if c.KafkaPublishTimeoutMs != 4000 {
		t.Fatalf("KafkaPublishTimeoutMs = %d, want 4000, under the 10 s HTTP write timeout", c.KafkaPublishTimeoutMs)
	}
	t.Setenv("METRICS_PORT", "9091")
	if got := Load().MetricsPort; got != 9091 {
		t.Fatalf("MetricsPort = %d, want 9091", got)
	}
}
