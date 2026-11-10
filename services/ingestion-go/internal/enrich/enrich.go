package enrich

import (
	"net/url"
	"regexp"
	"strings"
	"time"
)

type TrackerEvent struct {
	SchemaVersion    int                    `json:"schemaVersion"`
	EventID          string                 `json:"eventId"`
	Type             string                 `json:"type"`
	OccurredAt       string                 `json:"occurredAt"`
	SiteKey          string                 `json:"siteKey"`
	SessionID        string                 `json:"sessionId"`
	VisitorPseudonym string                 `json:"visitorPseudonym"`
	URL              string                 `json:"url"`
	Path             string                 `json:"path"`
	Title            string                 `json:"title,omitempty"`
	Referrer         string                 `json:"referrer,omitempty"`
	UserID           string                 `json:"userId,omitempty"`
	Release          string                 `json:"release,omitempty"`
	Environment      string                 `json:"environment,omitempty"`
	UserTraits       map[string]interface{} `json:"userTraits,omitempty"`
	Properties       map[string]interface{} `json:"properties,omitempty"`
	Campaign         map[string]string      `json:"campaign,omitempty"`
	WebVital         map[string]interface{} `json:"webVital,omitempty"`
	Error            map[string]interface{} `json:"error,omitempty"`
}

type EnrichedEvent struct {
	TrackerEvent
	WorkspaceID string `json:"workspaceId"`
	SiteID      string `json:"siteId"`
	ReceivedAt  string `json:"receivedAt"`
	Country     string `json:"country,omitempty"`
	City        string `json:"city,omitempty"`
	Browser     string `json:"browser,omitempty"`
	OS          string `json:"os,omitempty"`
	Device      string `json:"device"`
	IsBot       bool   `json:"isBot"`
	BotStatus   string `json:"botStatus"`
	// SampleWeight is N when this event stands for N like it: the edge kept 1 in N under load
	// (see Server.Pressure). Absent means 1. Carried so the stream stays auditable.
	SampleWeight int `json:"sampleWeight,omitempty"`
}

type Classification struct {
	IsBot     bool
	BotStatus string
	Device    string
	Browser   string
	OS        string
}

var knownBots = []*regexp.Regexp{
	regexp.MustCompile(`(?i)googlebot`),
	regexp.MustCompile(`(?i)bingbot`),
	regexp.MustCompile(`(?i)yandex`),
	regexp.MustCompile(`(?i)baiduspider`),
	regexp.MustCompile(`(?i)duckduckbot`),
	regexp.MustCompile(`(?i)slurp`),
	regexp.MustCompile(`(?i)facebookexternalhit`),
	regexp.MustCompile(`(?i)twitterbot`),
	regexp.MustCompile(`(?i)linkedinbot`),
	regexp.MustCompile(`(?i)slackbot`),
	regexp.MustCompile(`(?i)semrushbot`),
	regexp.MustCompile(`(?i)ahrefsbot`),
	regexp.MustCompile(`(?i)curl/`),
	regexp.MustCompile(`(?i)python-requests`),
	regexp.MustCompile(`(?i)node-fetch`),
	regexp.MustCompile(`(?i)axios`),
	regexp.MustCompile(`(?i)go-http-client`),
}

func ClassifyUA(ua string) Classification {
	if strings.TrimSpace(ua) == "" {
		return Classification{IsBot: true, BotStatus: "heuristic_bot", Device: "bot", Browser: "unknown", OS: "unknown"}
	}
	for _, re := range knownBots {
		if re.MatchString(ua) {
			return Classification{IsBot: true, BotStatus: "known_bot", Device: "bot", Browser: "bot", OS: "bot"}
		}
	}

	device := "desktop"
	osName := "other"
	browser := "other"

	lower := strings.ToLower(ua)
	if strings.Contains(lower, "mobile") {
		device = "mobile"
	} else if strings.Contains(lower, "tablet") || strings.Contains(lower, "ipad") {
		device = "tablet"
	}

	switch {
	case strings.Contains(lower, "windows"):
		osName = "Windows"
	case strings.Contains(lower, "macintosh") || strings.Contains(lower, "mac os x"):
		osName = "macOS"
	case strings.Contains(lower, "android"):
		osName = "Android"
	case strings.Contains(lower, "iphone") || strings.Contains(lower, "ipad") || strings.Contains(lower, "ipod"):
		osName = "iOS"
	case strings.Contains(lower, "linux"):
		osName = "Linux"
	}

	switch {
	case (strings.Contains(lower, "chrome") || strings.Contains(lower, "crios")) && !strings.Contains(lower, "edg"):
		browser = "Chrome"
	case strings.Contains(lower, "safari") && !strings.Contains(lower, "chrome"):
		browser = "Safari"
	case strings.Contains(lower, "firefox") || strings.Contains(lower, "fxios"):
		browser = "Firefox"
	case strings.Contains(lower, "edg"):
		browser = "Edge"
	}

	return Classification{IsBot: false, BotStatus: "human", Device: device, Browser: browser, OS: osName}
}

func ExtractGeo(headers map[string]string) (country, city string) {
	get := func(k string) string {
		if v, ok := headers[strings.ToLower(k)]; ok {
			return v
		}
		return ""
	}
	if cf := get("cf-ipcountry"); len(cf) == 2 && !strings.EqualFold(cf, "XX") {
		return strings.ToUpper(cf), get("cf-ipcity")
	}
	if cf := get("cloudfront-viewer-country"); len(cf) == 2 {
		return strings.ToUpper(cf), get("cloudfront-viewer-city")
	}
	return "", ""
}

func IsLocalOrFileURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return strings.HasPrefix(strings.ToLower(raw), "file:") ||
			strings.Contains(strings.ToLower(raw), "://localhost") ||
			strings.Contains(raw, "://127.0.0.1")
	}
	if u.Scheme == "file" {
		return true
	}
	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0" || strings.HasSuffix(host, ".localhost")
}

func SanitizeURL(raw string) (sanitizedURL, sanitizedPath string) {
	u, err := url.Parse(raw)
	if err != nil {
		cut := strings.SplitN(raw, "?", 2)[0]
		cut = strings.SplitN(cut, "#", 2)[0]
		return cut, cut
	}

	allowed := []string{"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"}
	q := url.Values{}
	for _, key := range allowed {
		if v := u.Query().Get(key); v != "" {
			q.Set(key, v)
		}
	}

	origin := u.Scheme + "://" + u.Host
	if u.Scheme == "file" || u.Host == "" {
		origin = u.Scheme + "://"
	}
	pathWithQuery := u.Path
	if enc := q.Encode(); enc != "" {
		pathWithQuery += "?" + enc
	}
	return origin + pathWithQuery, pathWithQuery
}

// NormalizeDomain reduces a registered site domain to the bare host that traffic is
// matched against: lower case, no scheme, path, port or leading "www.". Sites are often
// saved as "www.example.com" or "localhost:3000" while the browser reports "example.com"
// and "localhost" as the hostname.
func NormalizeDomain(raw string) string {
	d := strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(d, "://"); i >= 0 {
		d = d[i+3:]
	}
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	// A single colon is host:port; more than one is an IPv6 literal.
	if strings.Count(d, ":") == 1 {
		d = d[:strings.Index(d, ":")]
	}
	return strings.TrimPrefix(d, "www.")
}

// SameSiteHost reports whether host is the registered domain or one of its subdomains,
// treating "www." as the same site.
func SameSiteHost(host, siteDomain string) bool {
	h := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(host)), "www.")
	d := NormalizeDomain(siteDomain)
	if d == "" {
		return true
	}
	return h == d || strings.HasSuffix(h, "."+d)
}

func HostAllowed(eventURL, siteDomain string, allowLocalhost bool) bool {
	if allowLocalhost && IsLocalOrFileURL(eventURL) {
		return true
	}
	u, err := url.Parse(eventURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if SameSiteHost(host, siteDomain) {
		return true
	}
	// Development convenience: registered domain "localhost" accepts loopback.
	if NormalizeDomain(siteDomain) == "localhost" && (host == "localhost" || host == "127.0.0.1") {
		return true
	}
	return false
}

func NowUTC() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

// StripSelfReferrer returns "" when the referrer is the site itself (or one of its
// subdomains). A visitor moving between your own pages is not a traffic source, and older
// trackers sent the previous page as the referrer on every client-side navigation.
func StripSelfReferrer(referrer, siteDomain string) string {
	if referrer == "" {
		return ""
	}
	u, err := url.Parse(referrer)
	if err != nil {
		return referrer
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	domain := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(siteDomain)), "www.")
	if host == "" || domain == "" {
		return referrer
	}
	if host == domain || strings.HasSuffix(host, "."+domain) {
		return ""
	}
	return referrer
}
