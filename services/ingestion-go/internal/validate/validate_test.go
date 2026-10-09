package validate

import (
	"strings"
	"testing"
	"time"

	"github.com/trackme/ingestion-go/internal/enrich"
)

var now = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

func good() enrich.TrackerEvent {
	return enrich.TrackerEvent{
		SchemaVersion:    1,
		EventID:          "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42",
		Type:             "pageview",
		OccurredAt:       now.Add(-time.Second).Format(time.RFC3339Nano),
		SiteKey:          "site_key_12345",
		SessionID:        "session-1234",
		VisitorPseudonym: "visitor-1234",
		URL:              "https://example.com/pricing?utm_source=x",
		Path:             "/pricing",
	}
}

func TestEvent(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*enrich.TrackerEvent)
		reason string
	}{
		{"valid pageview", func(e *enrich.TrackerEvent) {}, ""},
		{"wrong schema version", func(e *enrich.TrackerEvent) { e.SchemaVersion = 2 }, ReasonSchema},
		{"unknown type", func(e *enrich.TrackerEvent) { e.Type = "click" }, ReasonType},
		{"event id not a uuid", func(e *enrich.TrackerEvent) { e.EventID = "not-a-uuid" }, ReasonEventID},
		{"event id wrong separators", func(e *enrich.TrackerEvent) { e.EventID = "3f2b8c1e_5a47_4d9e_8b21_0c6f7a1d9e42" }, ReasonEventID},
		{"event id non-hex", func(e *enrich.TrackerEvent) { e.EventID = "zf2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42" }, ReasonEventID},
		{"unparseable timestamp", func(e *enrich.TrackerEvent) { e.OccurredAt = "yesterday" }, ReasonTimestamp},
		{"empty timestamp", func(e *enrich.TrackerEvent) { e.OccurredAt = "" }, ReasonTimestamp},
		{"short site key", func(e *enrich.TrackerEvent) { e.SiteKey = "short" }, ReasonIdentity},
		{"long session id", func(e *enrich.TrackerEvent) { e.SessionID = strings.Repeat("a", 65) }, ReasonIdentity},
		{"relative url", func(e *enrich.TrackerEvent) { e.URL = "/pricing" }, ReasonURL},
		{"javascript url", func(e *enrich.TrackerEvent) { e.URL = "javascript:alert(1)" }, ReasonURL},
		{"file url allowed", func(e *enrich.TrackerEvent) { e.URL = "file:///tmp/x.html" }, ""},
		{"url too long", func(e *enrich.TrackerEvent) { e.URL = "https://e.com/" + strings.Repeat("a", 2100) }, ReasonURL},
		{"empty path", func(e *enrich.TrackerEvent) { e.Path = "" }, ReasonText},
		{"title too long", func(e *enrich.TrackerEvent) { e.Title = strings.Repeat("t", 513) }, ReasonText},
		{"nested property", func(e *enrich.TrackerEvent) {
			e.Properties = map[string]interface{}{"a": map[string]interface{}{"b": 1.0}}
		}, ReasonProperties},
		{"null property", func(e *enrich.TrackerEvent) { e.Properties = map[string]interface{}{"a": nil} }, ReasonProperties},
		{"bad property key", func(e *enrich.TrackerEvent) { e.Properties = map[string]interface{}{"has space": "x"} }, ReasonProperties},
		{"long property value", func(e *enrich.TrackerEvent) {
			e.Properties = map[string]interface{}{"a": strings.Repeat("v", 257)}
		}, ReasonProperties},
		{"scalar properties", func(e *enrich.TrackerEvent) {
			e.Properties = map[string]interface{}{"plan": "pro", "seats": 5.0, "trial": true}
		}, ""},
		{"too many properties", func(e *enrich.TrackerEvent) {
			m := map[string]interface{}{}
			for i := 0; i < 51; i++ {
				m["k"+strings.Repeat("x", i%5)+string(rune('a'+i%26))+strings.Repeat("y", i/26)] = "v"
			}
			e.Properties = m
		}, ReasonProperties},
		{"long campaign value", func(e *enrich.TrackerEvent) {
			e.Campaign = map[string]string{"source": strings.Repeat("c", 129)}
		}, ReasonCampaign},
		{"identify without user id", func(e *enrich.TrackerEvent) { e.Type = "identify" }, ReasonUser},
		{"identify with user id", func(e *enrich.TrackerEvent) {
			e.Type = "identify"
			e.UserID = "user-42"
			e.UserTraits = map[string]interface{}{"plan": "pro"}
		}, ""},
		{"user id too long", func(e *enrich.TrackerEvent) { e.UserID = strings.Repeat("u", 257) }, ReasonUser},
		{"web vital missing payload", func(e *enrich.TrackerEvent) { e.Type = "web_vital" }, ReasonWebVital},
		{"web vital unknown metric", func(e *enrich.TrackerEvent) {
			e.Type = "web_vital"
			e.WebVital = map[string]interface{}{"name": "XYZ", "value": 1.0, "rating": "good"}
		}, ReasonWebVital},
		{"web vital negative value", func(e *enrich.TrackerEvent) {
			e.Type = "web_vital"
			e.WebVital = map[string]interface{}{"name": "LCP", "value": -1.0, "rating": "good"}
		}, ReasonWebVital},
		{"web vital ok", func(e *enrich.TrackerEvent) {
			e.Type = "web_vital"
			e.WebVital = map[string]interface{}{"name": "LCP", "value": 1800.0, "rating": "good", "navigationType": "navigate"}
		}, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ev := good()
			tc.mutate(&ev)
			_, _, reason := Event(ev, now, DefaultWindow)
			if reason != tc.reason {
				t.Fatalf("reason = %q, want %q", reason, tc.reason)
			}
		})
	}
}

func TestTimestampClamp(t *testing.T) {
	tests := []struct {
		name    string
		offset  time.Duration
		clamped bool
	}{
		{"just now", -time.Second, false},
		{"23h old retry replay", -23 * time.Hour, false},
		{"slightly ahead of server clock", 2 * time.Minute, false},
		{"older than window", -25 * time.Hour, true},
		{"far past", -50 * 365 * 24 * time.Hour, true},
		{"far future", 80 * 365 * 24 * time.Hour, true},
		{"just past future bound", 6 * time.Minute, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ev := good()
			ev.OccurredAt = now.Add(tc.offset).Format(time.RFC3339Nano)
			out, clamped, reason := Event(ev, now, DefaultWindow)
			if reason != "" {
				t.Fatalf("unexpected rejection: %s", reason)
			}
			if clamped != tc.clamped {
				t.Fatalf("clamped = %v, want %v", clamped, tc.clamped)
			}
			got, err := time.Parse(time.RFC3339Nano, out.OccurredAt)
			if err != nil {
				t.Fatalf("output timestamp not parseable: %v", err)
			}
			if tc.clamped && !got.Equal(now) {
				t.Fatalf("clamped timestamp = %v, want server time %v", got, now)
			}
			if !tc.clamped && !got.Equal(now.Add(tc.offset)) {
				t.Fatalf("timestamp changed unexpectedly: %v", got)
			}
		})
	}
}

func TestTimestampNormalizedToUTC(t *testing.T) {
	ev := good()
	ev.OccurredAt = now.Add(-time.Minute).In(time.FixedZone("IST", 5*3600+1800)).Format(time.RFC3339Nano)
	out, _, reason := Event(ev, now, DefaultWindow)
	if reason != "" {
		t.Fatalf("unexpected rejection: %s", reason)
	}
	if !strings.HasSuffix(out.OccurredAt, "Z") {
		t.Fatalf("timestamp %q is not UTC with a Z suffix", out.OccurredAt)
	}
}

func TestIsUUID(t *testing.T) {
	for _, s := range []string{"3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42", "3F2B8C1E-5A47-4D9E-8B21-0C6F7A1D9E42"} {
		if !IsUUID(s) {
			t.Errorf("IsUUID(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"", "x", "3f2b8c1e5a474d9e8b210c6f7a1d9e42", "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e4", "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e4g"} {
		if IsUUID(s) {
			t.Errorf("IsUUID(%q) = true, want false", s)
		}
	}
}
