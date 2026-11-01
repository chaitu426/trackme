package origin

import "testing"

func TestAllowedMatchesWwwAndApex(t *testing.T) {
	cases := []struct {
		origin, domain string
		want           bool
	}{
		{"https://example.com", "www.example.com", true},
		{"https://www.example.com", "example.com", true},
		{"https://shop.example.com", "example.com", true},
		{"http://localhost:3000", "localhost:3000", true},
		{"https://example.org", "example.com", false},
		{"", "example.com", false},
	}
	for _, c := range cases {
		if got := Allowed(c.origin, "", c.domain, false); got != c.want {
			t.Errorf("Allowed(%q, %q) = %v, want %v", c.origin, c.domain, got, c.want)
		}
	}
}
