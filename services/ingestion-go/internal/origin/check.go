package origin

import (
	"net/url"
	"strings"
)

// RequestHost extracts a hostname from Origin or Referer (Origin preferred).
func RequestHost(originHeader, refererHeader string) string {
	for _, raw := range []string{originHeader, refererHeader} {
		raw = strings.TrimSpace(raw)
		if raw == "" || raw == "null" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Hostname() == "" {
			continue
		}
		return strings.ToLower(u.Hostname())
	}
	return ""
}

// Allowed reports whether the browser Origin/Referer host matches the registered site domain.
func Allowed(originHeader, refererHeader, siteDomain string, allowLocalhost bool) bool {
	host := RequestHost(originHeader, refererHeader)
	domain := strings.ToLower(strings.TrimSpace(siteDomain))

	if host == "" {
		// No Origin/Referer — common for some non-browser clients; reject when match is required.
		return false
	}

	if allowLocalhost && (host == "localhost" || host == "127.0.0.1" || host == "::1") {
		return true
	}

	if domain == "" {
		return true
	}

	if host == domain || strings.HasSuffix(host, "."+domain) {
		return true
	}

	if domain == "localhost" && (host == "localhost" || host == "127.0.0.1") {
		return true
	}

	return false
}
