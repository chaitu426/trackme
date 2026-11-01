package validate

import (
	"strings"
	"testing"
)

func TestNormalizeLongQueryDoesNotCostTheEvent(t *testing.T) {
	ev := good()
	ev.URL = "https://example.com/callback?utm_source=x&token=" + strings.Repeat("a", 3000)
	ev.Path = "/callback?token=" + strings.Repeat("a", 3000)
	out, _, _ := Normalize(ev)
	if _, _, reason := Event(out, now, DefaultWindow); reason != "" {
		t.Fatalf("reason = %q, want accepted", reason)
	}
	if strings.Contains(out.URL, "token=") || out.Path != "/callback?utm_source=x" {
		t.Fatalf("url=%q path=%q", out.URL, out.Path)
	}
}

func TestNormalizeRootWithoutSlash(t *testing.T) {
	ev := good()
	ev.URL = "https://example.com"
	out, _, _ := Normalize(ev)
	if out.Path != "/" {
		t.Fatalf("path = %q, want /", out.Path)
	}
}

func TestNormalizeShortensText(t *testing.T) {
	ev := good()
	ev.Title = strings.Repeat("é", 600)
	ev.Referrer = "https://r.com/" + strings.Repeat("a", 3000)
	ev.Campaign = map[string]string{"source": strings.Repeat("c", 200)}
	out, cut, _ := Normalize(ev)
	if cut != 3 {
		t.Fatalf("cut = %d, want 3", cut)
	}
	if _, _, reason := Event(out, now, DefaultWindow); reason != "" {
		t.Fatalf("reason = %q, want accepted", reason)
	}
}

func TestNormalizeDropsOnlyBadProperties(t *testing.T) {
	ev := good()
	ev.Properties = map[string]interface{}{
		"plan":      "pro",
		"seats":     5.0,
		"coupon":    nil,
		"items":     []interface{}{1.0},
		"nested":    map[string]interface{}{"a": 1.0},
		"has space": "x",
		"note":      strings.Repeat("v", 300),
	}
	out, _, dropped := Normalize(ev)
	if dropped != 4 {
		t.Fatalf("dropped = %d, want 4", dropped)
	}
	if out.Properties["plan"] != "pro" || out.Properties["seats"] != 5.0 || len(out.Properties) != 3 {
		t.Fatalf("properties = %v", out.Properties)
	}
	if _, _, reason := Event(out, now, DefaultWindow); reason != "" {
		t.Fatalf("reason = %q, want accepted", reason)
	}
}

func TestNormalizeCapsPropertyCount(t *testing.T) {
	ev := good()
	ev.Properties = map[string]interface{}{}
	for i := 0; i < 60; i++ {
		ev.Properties["k"+strings.Repeat("x", i)] = "v"
	}
	out, _, dropped := Normalize(ev)
	if len(out.Properties) != maxProps || dropped != 10 {
		t.Fatalf("kept %d dropped %d", len(out.Properties), dropped)
	}
}
