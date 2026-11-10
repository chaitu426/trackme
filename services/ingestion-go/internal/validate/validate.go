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
	ReasonRelease    = "release"
	ReasonError      = "error"
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
	maxRelease     = 64
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
	releaseRe  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+@/-]*$`)
	// Mirrors EVENT_TYPES and ENVIRONMENTS in packages/contracts/src/events.ts.
	eventTypes = map[string]bool{
		"pageview": true, "custom": true, "web_vital": true, "identify": true, "engagement": true,
		"error": true, "api_call": true, "payment": true, "flag_exposure": true, "feedback": true,
		"heartbeat": true, "deploy": true,
	}
	environments = map[string]bool{"production": true, "staging": true, "development": true}
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

	if ev.Release != "" && (len(ev.Release) > maxRelease || !releaseRe.MatchString(ev.Release)) {
		return ev, false, ReasonRelease
	}
	if ev.Environment != "" && !environments[ev.Environment] {
		return ev, false, ReasonRelease
	}

	for _, v := range ev.Campaign {
		if runes(v) > maxCampaignVal {
			return ev, false, ReasonCampaign
		}
	}

	if ev.Type == "web_vital" && !validWebVital(ev.WebVital) {
		return ev, false, ReasonWebVital
	}
	// An error event carries an error payload, and no other kind does.
	if (ev.Type == "error") != (ev.Error != nil) || (ev.Error != nil && !validError(ev.Error)) {
		return ev, false, ReasonError
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

// Caps for the error payload; they mirror ERROR_LIMITS in packages/contracts/src/events.ts.
const (
	maxErrType       = 128
	maxErrMessage    = 1024
	maxErrFingerprnt = 128
	maxFrames        = 50
	maxFrameFn       = 200
	maxFrameFile     = 512
	maxBreadcrumbs   = 20
	maxCrumbText     = 200
	maxErrTags       = 10
	maxTagKey        = 32
	maxTagValue      = 200
)

var (
	errLevels      = map[string]bool{"fatal": true, "error": true, "warning": true, "info": true}
	breadcrumbKind = map[string]bool{"navigation": true, "click": true, "fetch": true, "log": true}
)

// validError checks an error payload's shape and sizes. It never inspects the stack: the edge stays O(size of event).
func validError(m map[string]interface{}) bool {
	if t, ok := m["type"].(string); !ok || runes(t) == 0 || runes(t) > maxErrType {
		return false
	}
	if msg, ok := m["message"].(string); !ok || runes(msg) > maxErrMessage {
		return false
	}
	if v, present := m["level"]; present {
		if s, ok := v.(string); !ok || !errLevels[s] {
			return false
		}
	}
	if v, present := m["fingerprint"]; present {
		if s, ok := v.(string); !ok || runes(s) == 0 || runes(s) > maxErrFingerprnt {
			return false
		}
	}
	if v, present := m["frames"]; present {
		frames, ok := v.([]interface{})
		if !ok || len(frames) > maxFrames {
			return false
		}
		for _, f := range frames {
			if !validFrame(f) {
				return false
			}
		}
	}
	if v, present := m["breadcrumbs"]; present {
		crumbs, ok := v.([]interface{})
		if !ok || len(crumbs) > maxBreadcrumbs {
			return false
		}
		for _, c := range crumbs {
			if !validBreadcrumb(c) {
				return false
			}
		}
	}
	if v, present := m["tags"]; present {
		tags, ok := v.(map[string]interface{})
		if !ok || len(tags) > maxErrTags {
			return false
		}
		for k, tv := range tags {
			s, ok := tv.(string)
			if !ok || runes(k) == 0 || runes(k) > maxTagKey || !propKeyRe.MatchString(k) || runes(s) > maxTagValue {
				return false
			}
		}
	}
	return true
}

func nonNegativeInt(v interface{}) bool {
	n, ok := v.(float64)
	return ok && n >= 0 && n == math.Trunc(n) && !math.IsInf(n, 0)
}

func validFrame(v interface{}) bool {
	f, ok := v.(map[string]interface{})
	if !ok {
		return false
	}
	if file, ok := f["file"].(string); !ok || runes(file) == 0 || runes(file) > maxFrameFile {
		return false
	}
	if fn, present := f["fn"]; present {
		if s, ok := fn.(string); !ok || runes(s) > maxFrameFn {
			return false
		}
	}
	for _, key := range []string{"line", "col"} {
		if n, present := f[key]; present && !nonNegativeInt(n) {
			return false
		}
	}
	if in, present := f["inApp"]; present {
		if _, ok := in.(bool); !ok {
			return false
		}
	}
	return true
}

func validBreadcrumb(v interface{}) bool {
	c, ok := v.(map[string]interface{})
	if !ok || !nonNegativeInt(c["ts"]) {
		return false
	}
	if k, ok := c["k"].(string); !ok || !breadcrumbKind[k] {
		return false
	}
	m, ok := c["m"].(string)
	return ok && runes(m) <= maxCrumbText
}
