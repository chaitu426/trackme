package geo

import "testing"

func TestCDNHeadersWinOverEverything(t *testing.T) {
	r := New("").WithLoopbackIP("8.8.8.8")
	for header, want := range map[string]string{
		"cf-ipcountry":              "DE",
		"cloudfront-viewer-country": "FR",
		"x-vercel-ip-country":       "IN",
		"x-appengine-country":       "JP",
	} {
		if got, _ := r.Lookup(map[string]string{header: want}, "127.0.0.1"); got != want {
			t.Errorf("%s: got %q, want %q", header, got, want)
		}
	}
}

func TestLoopbackWithoutOverrideHasNoLocation(t *testing.T) {
	if c, _ := New("").Lookup(nil, "127.0.0.1"); c != "" {
		t.Fatalf("got %q, want empty", c)
	}
}

func TestInvalidLoopbackOverrideIsIgnored(t *testing.T) {
	r := New("").WithLoopbackIP("not-an-ip")
	if r.loopbackIP != nil {
		t.Fatal("garbage override must not be kept")
	}
}
