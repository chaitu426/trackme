package clientip

import (
	"net/http"
	"testing"
)

func req(remote string, xff ...string) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, "http://edge.test/v1/batch", nil)
	r.RemoteAddr = remote
	for _, v := range xff {
		r.Header.Add("X-Forwarded-For", v)
	}
	return r
}

func TestFromRequest(t *testing.T) {
	tests := []struct {
		name string
		r    *http.Request
		hops int
		want string
	}{
		{"no proxy ignores a forged header", req("203.0.113.9:5000", "1.2.3.4"), 0, "203.0.113.9"},
		{"one proxy takes the entry it appended", req("10.0.0.1:443", "198.51.100.7"), 1, "198.51.100.7"},
		{"client-supplied prefix cannot override the real address", req("10.0.0.1:443", "6.6.6.6, 198.51.100.7"), 1, "198.51.100.7"},
		{"long forged chain still resolves to the real client", req("10.0.0.1:443", "1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.7"), 1, "198.51.100.7"},
		{"two proxies: CDN then load balancer", req("10.0.0.2:443", "198.51.100.7, 172.16.0.5"), 2, "198.51.100.7"},
		{"forged prefix with two proxies", req("10.0.0.2:443", "6.6.6.6, 198.51.100.7, 172.16.0.5"), 2, "198.51.100.7"},
		{"header split across lines is read as one list", req("10.0.0.1:443", "6.6.6.6", "198.51.100.7"), 1, "198.51.100.7"},
		{"fewer entries than hops falls back to the peer", req("203.0.113.9:5000", "198.51.100.7"), 2, "203.0.113.9"},
		{"missing header with a proxy configured uses the peer", req("203.0.113.9:5000"), 1, "203.0.113.9"},
		{"garbage in the trusted slot uses the peer", req("203.0.113.9:5000", "not-an-ip"), 1, "203.0.113.9"},
		{"ipv6 client", req("10.0.0.1:443", "2001:db8::1"), 1, "2001:db8::1"},
		{"ipv6 peer", req("[2001:db8::2]:443"), 0, "2001:db8::2"},
		{"spaces around entries are trimmed", req("10.0.0.1:443", " 6.6.6.6 ,   198.51.100.7 "), 1, "198.51.100.7"},
		{"peer without a port", req("203.0.113.9"), 0, "203.0.113.9"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := FromRequest(tc.r, tc.hops); got != tc.want {
				t.Fatalf("FromRequest = %q, want %q", got, tc.want)
			}
		})
	}
}

// X-Real-IP was trusted by the previous implementation. It is client-controlled
// unless a proxy overwrites it, so it must have no effect.
func TestXRealIPIsIgnored(t *testing.T) {
	r := req("203.0.113.9:5000")
	r.Header.Set("X-Real-IP", "1.2.3.4")
	if got := FromRequest(r, 1); got != "203.0.113.9" {
		t.Fatalf("X-Real-IP influenced the result: %q", got)
	}
}
