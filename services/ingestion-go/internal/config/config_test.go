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
