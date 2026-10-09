// Package clientip finds the real client address behind a known number of
// trusted reverse proxies.
//
// X-Forwarded-For is a list that each proxy appends to. Only the entries added
// by proxies we operate can be believed; everything to their left was supplied
// by the client and can say anything. So the client is the entry exactly
// `hops` places from the right, never the leftmost.
package clientip

import (
	"net"
	"net/http"
	"strings"
)

// FromRequest returns the client IP for r.
//
// hops is the number of trusted proxies between the client and this server
// (a CDN plus a load balancer is 2). With hops <= 0, X-Forwarded-For is
// ignored and the TCP peer address is used. If the header holds fewer entries
// than hops, the request did not travel the expected path and the peer address
// is returned instead of guessing.
func FromRequest(r *http.Request, hops int) string {
	peer := peerIP(r.RemoteAddr)
	if hops <= 0 {
		return peer
	}

	var entries []string
	for _, line := range r.Header.Values("X-Forwarded-For") {
		for _, part := range strings.Split(line, ",") {
			if part = strings.TrimSpace(part); part != "" {
				entries = append(entries, part)
			}
		}
	}
	if len(entries) < hops {
		return peer
	}

	candidate := entries[len(entries)-hops]
	if ip := net.ParseIP(candidate); ip != nil {
		return ip.String()
	}
	return peer
}

func peerIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}
