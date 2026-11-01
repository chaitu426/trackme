package enrich

import "testing"

func TestStripSelfReferrer(t *testing.T) {
	cases := []struct{ referrer, domain, want string }{
		{"", "example.com", ""},
		{"https://example.com/pricing", "example.com", ""},
		{"https://www.example.com/pricing", "example.com", ""},
		{"https://blog.example.com/post", "example.com", ""},
		{"https://example.com/", "www.example.com", ""},
		{"https://google.com/search?q=x", "example.com", "https://google.com/search?q=x"},
		{"https://notexample.com/", "example.com", "https://notexample.com/"},
		{"https://example.com.evil.io/", "example.com", "https://example.com.evil.io/"},
		{"not a url", "example.com", "not a url"},
		{"https://example.com/", "", "https://example.com/"},
	}
	for _, c := range cases {
		if got := StripSelfReferrer(c.referrer, c.domain); got != c.want {
			t.Errorf("StripSelfReferrer(%q, %q) = %q, want %q", c.referrer, c.domain, got, c.want)
		}
	}
}
