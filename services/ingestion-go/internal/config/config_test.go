package config

import "testing"

func TestProductionProblems(t *testing.T) {
	good := Config{
		DatabaseURL: "postgres://app:pw@db.internal/growth", RedisURL: "redis://:pw@cache.internal:6379",
		TrustedProxyHops: 1, TrustedProxyHopsSet: true, MetricsPort: 9090,
	}
	with := func(change func(*Config)) Config {
		c := good
		change(&c)
		return c
	}

	tests := []struct {
		name    string
		cfg     Config
		nodeEnv string
		want    int
	}{
		{"development may use the defaults", Config{DatabaseURL: DefaultDatabaseURL, RedisURL: DefaultRedisURL}, "development", 0},
		{"unset environment may use the defaults", Config{DatabaseURL: DefaultDatabaseURL, RedisURL: DefaultRedisURL}, "", 0},
		{"production with real settings is fine", good, "production", 0},
		{"production with the default database", with(func(c *Config) { c.DatabaseURL = DefaultDatabaseURL }), "production", 1},
		{"production with the default redis", with(func(c *Config) { c.RedisURL = DefaultRedisURL }), "production", 1},
		{"production with both defaults", with(func(c *Config) { c.DatabaseURL, c.RedisURL = DefaultDatabaseURL, DefaultRedisURL }), "production", 2},
		{"negative proxy hops", with(func(c *Config) { c.TrustedProxyHops = -1 }), "production", 1},
		{"production must choose its proxy count on purpose", with(func(c *Config) { c.TrustedProxyHopsSet = false }), "production", 1},
		{"production exposed directly may say so with 0", with(func(c *Config) { c.TrustedProxyHops = 0 }), "production", 0},
		{"production must not serve /metrics publicly by accident", with(func(c *Config) { c.MetricsPort = 0 }), "production", 1},
		{"production may accept public metrics explicitly", with(func(c *Config) { c.MetricsPort, c.AllowPublicMetrics = 0, true }), "production", 0},
		{"development is not held to these", Config{DatabaseURL: DefaultDatabaseURL, RedisURL: DefaultRedisURL}, "development", 0},
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

func TestEdgeDedupeDefaultsOn(t *testing.T) {
	t.Setenv("EDGE_DEDUPE", "")
	if got := Load().EdgeDedupe; !got {
		t.Fatal("EdgeDedupe = false by default, want true: a retry after a lost response must not be stored twice")
	}
	t.Setenv("EDGE_DEDUPE", "false")
	if got := Load().EdgeDedupe; got {
		t.Fatal("EdgeDedupe = true, want false when explicitly disabled")
	}
}

func TestAsyncProduceAndAdmissionDefaults(t *testing.T) {
	for _, key := range []string{
		"EDGE_ASYNC_PRODUCE", "ADMISSION_FAIL_CLOSED", "EDGE_GATE_SCRIPT", "QUOTA_FAIL_OPEN",
		"EDGE_QUEUE_MAX_EVENTS", "EDGE_PRODUCE_BATCH_MIN", "EDGE_PRODUCE_BATCH_MAX",
	} {
		t.Setenv(key, "")
	}
	c := Load()
	if !c.AsyncProduce {
		t.Fatal("AsyncProduce = false by default, want true: Kafka must be off the request path")
	}
	if !c.AdmissionFailClosed {
		t.Fatal("AdmissionFailClosed = false by default, want true")
	}
	if c.QuotaFailOpen {
		t.Fatal("QuotaFailOpen = true by default, want false")
	}
	if !c.EdgeGateScript {
		t.Fatal("EdgeGateScript = false by default, want true (fused admission)")
	}
	if c.QueueMaxEvents != 10000 || c.ProduceBatchMin != 500 || c.ProduceBatchMax != 5000 {
		t.Fatalf("queue sizing = %d/%d/%d, want 10000/500/5000", c.QueueMaxEvents, c.ProduceBatchMin, c.ProduceBatchMax)
	}
}

func TestOpsDefaults(t *testing.T) {
	t.Setenv("METRICS_PORT", "")
	t.Setenv("KAFKA_PUBLISH_TIMEOUT_MS", "")
	c := Load()
	if c.MetricsPort != 0 {
		t.Fatalf("MetricsPort = %d, want 0 (served on the main port unless configured)", c.MetricsPort)
	}
	if c.KafkaPublishTimeoutMs != 10000 {
		t.Fatalf("KafkaPublishTimeoutMs = %d, want 10000; the async producer bounds an attempt, not the HTTP request", c.KafkaPublishTimeoutMs)
	}
	t.Setenv("METRICS_PORT", "9091")
	if got := Load().MetricsPort; got != 9091 {
		t.Fatalf("MetricsPort = %d, want 9091", got)
	}
}
