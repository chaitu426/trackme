package enrich

import "testing"

func TestNormalizeDomain(t *testing.T) {
	cases := map[string]string{
		"example.com":              "example.com",
		"www.example.com":          "example.com",
		"WWW.Example.COM":          "example.com",
		"https://www.example.com/": "example.com",
		"localhost:3000":           "localhost",
		"example.com:8443/path":    "example.com",
		"[::1]:3000":               "[::1]:3000", // IPv6 literal is left alone
	}
	for in, want := range cases {
		if got := NormalizeDomain(in); got != want {
			t.Errorf("NormalizeDomain(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHostAllowedTreatsWwwAndPortAsTheSameSite(t *testing.T) {
	cases := []struct {
		url, domain string
		want        bool
	}{
		{"https://example.com/a", "www.example.com", true},
		{"https://www.example.com/a", "example.com", true},
		{"https://m.example.com/a", "www.example.com", true},
		{"http://localhost:3000/a", "localhost:3000", true},
		{"https://evilexample.com/a", "example.com", false},
		{"https://example.com.evil.io/a", "example.com", false},
	}
	for _, c := range cases {
		if got := HostAllowed(c.url, c.domain, false); got != c.want {
			t.Errorf("HostAllowed(%q, %q) = %v, want %v", c.url, c.domain, got, c.want)
		}
	}
}
