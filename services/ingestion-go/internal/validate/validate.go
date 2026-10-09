// Package validate enforces the tracker event contract at the edge.
//
// It mirrors packages/contracts/src/events.ts (TrackerEventSchema). Anything the
// downstream consumers parse strictly (UUID event ids, timestamps, scalar
// properties) must be checked here, because the event-worker cannot make
// progress past a message it cannot insert.
package validate

import (
	"math"
	"net/url"
	"regexp"
	"time"
	"unicode/utf8"

	"github.com/trackme/ingestion-go/internal/enrich"
)

// Reasons returned for a rejected event. Stable strings, safe to log and count.
const (
	ReasonSchema     = "schema_version"
	ReasonType       = "type"
	ReasonEventID    = "event_id"
	ReasonTimestamp  = "occurred_at"
	ReasonIdentity   = "identity_fields"
	ReasonURL        = "url"
	ReasonText       = "text_length"
	ReasonProperties = "properties"
	ReasonCampaign   = "campaign"
	ReasonWebVital   = "web_vital"
	ReasonUser       = "user"
)

const (
	maxProps       = 50
	maxPropKey     = 64
	maxPropValue   = 256
	maxCampaignVal = 128
	maxURL         = 2048
	maxPath        = 512
	maxTitle       = 512
	maxUserID      = 256
	minKey         = 8
	maxKey         = 64
)

// Window bounds how far an event timestamp may sit from server time before it
// is replaced with the server's receive time. The past bound is wide so that
// the SDK's offline retry queue still delivers with its original timestamps.
type Window struct {
	Past   time.Duration
	Future time.Duration
}

var DefaultWindow = Window{Past: 24 * time.Hour, Future: 5 * time.Minute}

var (
	propKeyRe  = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)
	vitalNames = map[string]bool{"CLS": true, "FCP": true, "FID": true, "INP": true, "LCP": true, "TTFB": true}
	vitalRates = map[string]bool{"good": true, "needs-improvement": true, "poor": true}
	eventTypes = map[string]bool{"pageview": true, "custom": true, "web_vital": true, "identify": true}
)

// Event checks one event. On success it returns the event (with its timestamp
// clamped to now if it was outside the window) and clamped=true when that
// happened. On failure it returns a non-empty reason.
func Event(ev enrich.TrackerEvent, now time.Time, w Window) (out enrich.TrackerEvent, clamped bool, reason string) {
	if ev.SchemaVersion != 1 {
		return ev, false, ReasonSchema
	}
	if !eventTypes[ev.Type] {
		return ev, false, ReasonType
	}
	if !IsUUID(ev.EventID) {
		return ev, false, ReasonEventID
	}

	ts, err := time.Parse(time.RFC3339Nano, ev.OccurredAt)
	if err != nil {
		return ev, false, ReasonTimestamp
	}
	if ts.Before(now.Add(-w.Past)) || ts.After(now.Add(w.Future)) {
		ts = now
		clamped = true
	}
	// Always emit UTC with a trailing Z: the shared schema rejects offsets.
	ev.OccurredAt = ts.UTC().Format(time.RFC3339Nano)

	if !lenBetween(ev.SiteKey, minKey, maxKey) ||
		!lenBetween(ev.SessionID, minKey, maxKey) ||
		!lenBetween(ev.VisitorPseudonym, minKey, maxKey) {
		return ev, false, ReasonIdentity
	}

	if !validURL(ev.URL) {
		return ev, false, ReasonURL
	}
	if runes(ev.Path) == 0 || runes(ev.Path) > maxPath ||
		runes(ev.Title) > maxTitle || runes(ev.Referrer) > maxURL {
		return ev, false, ReasonText
	}

	if ev.Properties != nil && !validProps(ev.Properties) {
		return ev, false, ReasonProperties
	}
	if ev.UserTraits != nil && !validProps(ev.UserTraits) {
		return ev, false, ReasonUser
	}
	if runes(ev.UserID) > maxUserID {
		return ev, false, ReasonUser
	}
	if ev.Type == "identify" && ev.UserID == "" {
		return ev, false, ReasonUser
	}

	for _, v := range ev.Campaign {
		if runes(v) > maxCampaignVal {
			return ev, false, ReasonCampaign
		}
	}

	if ev.Type == "web_vital" && !validWebVital(ev.WebVital) {
		return ev, false, ReasonWebVital
	}

	return ev, clamped, ""
}

// IsUUID reports whether s is a canonical 8-4-4-4-12 hex UUID, which is what
// the ClickHouse UUID column accepts.
func IsUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < 36; i++ {
		c := s[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !isHex(c) {
				return false
			}
		}
	}
	return true
}

func isHex(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func runes(s string) int { return utf8.RuneCountInString(s) }

func lenBetween(s string, min, max int) bool {
	n := runes(s)
	return n >= min && n <= max
}

func validURL(raw string) bool {
	if raw == "" || runes(raw) > maxURL {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	switch u.Scheme {
	case "http", "https":
		return u.Host != ""
	case "file":
		return true
	default:
		return false
	}
}

func validProps(m map[string]interface{}) bool {
	if len(m) > maxProps {
		return false
	}
	for k, v := range m {
		if runes(k) == 0 || runes(k) > maxPropKey || !propKeyRe.MatchString(k) {
			return false
		}
		switch val := v.(type) {
		case string:
			if runes(val) > maxPropValue {
				return false
			}
		case float64:
			if math.IsNaN(val) || math.IsInf(val, 0) {
				return false
			}
		case bool:
		default:
			// nil, arrays and nested objects are not part of the contract.
			return false
		}
	}
	return true
}

func validWebVital(m map[string]interface{}) bool {
	if m == nil {
		return false
	}
	name, ok := m["name"].(string)
	if !ok || !vitalNames[name] {
		return false
	}
	value, ok := m["value"].(float64)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return false
	}
	rating, ok := m["rating"].(string)
	if !ok || !vitalRates[rating] {
		return false
	}
	if nav, present := m["navigationType"]; present {
		s, ok := nav.(string)
		if !ok || runes(s) > 64 {
			return false
		}
	}
	return true
}
