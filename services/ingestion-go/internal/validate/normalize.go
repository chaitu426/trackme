package validate

import (
	"math"
	"net/url"
	"sort"

	"github.com/trackme/ingestion-go/internal/enrich"
)

// Normalize makes an event fit the contract where that can be done without guessing, so
// a long query string, a verbose title or one odd property does not cost the whole event.
// Event stays strict: it is the contract, and runs on Normalize's output.
//
//   - url and path are reduced to the allowed query parameters first, so a page whose
//     address carries a long tracking or OAuth query is judged by what is actually stored;
//   - title, referrer, campaign values and string properties are cut to their limits;
//   - properties and traits lose the entries the contract cannot hold (null, arrays,
//     objects, keys with other characters) and anything past the key limit.
//
// It reports how many fields were shortened and how many property entries were dropped.
func Normalize(ev enrich.TrackerEvent) (out enrich.TrackerEvent, cut, dropped int) {
	// Length is not checked here: the point is to shrink an over-long address first.
	if u, err := url.Parse(ev.URL); err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
		sanitized, path := enrich.SanitizeURL(ev.URL)
		if path == "" {
			path = "/"
		}
		ev.URL, ev.Path = sanitized, path
	}
	if truncate(&ev.URL, maxURL) {
		cut++
	}
	if truncate(&ev.Path, maxPath) {
		cut++
	}
	if truncate(&ev.Title, maxTitle) {
		cut++
	}
	if truncate(&ev.Referrer, maxURL) {
		cut++
	}

	if len(ev.Campaign) > 0 {
		campaign := make(map[string]string, len(ev.Campaign))
		for k, v := range ev.Campaign {
			if truncate(&v, maxCampaignVal) {
				cut++
			}
			campaign[k] = v
		}
		ev.Campaign = campaign
	}

	var d int
	ev.Properties, d = cleanProps(ev.Properties)
	dropped += d
	ev.UserTraits, d = cleanProps(ev.UserTraits)
	dropped += d
	return ev, cut, dropped
}

// truncate shortens *s to max runes and reports whether it did.
func truncate(s *string, max int) bool {
	if runes(*s) <= max {
		return false
	}
	r := []rune(*s)
	*s = string(r[:max])
	return true
}

// cleanProps keeps the entries validProps would accept, in sorted key order so the
// result does not depend on map iteration when the key limit applies.
func cleanProps(in map[string]interface{}) (map[string]interface{}, int) {
	if len(in) == 0 {
		return in, 0
	}
	keys := make([]string, 0, len(in))
	for k := range in {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make(map[string]interface{}, len(in))
	dropped := 0
	for _, k := range keys {
		if len(out) >= maxProps || runes(k) == 0 || runes(k) > maxPropKey || !propKeyRe.MatchString(k) {
			dropped++
			continue
		}
		switch v := in[k].(type) {
		case string:
			truncate(&v, maxPropValue)
			out[k] = v
		case float64:
			if math.IsNaN(v) || math.IsInf(v, 0) {
				dropped++
				continue
			}
			out[k] = v
		case bool:
			out[k] = v
		default:
			dropped++
		}
	}
	return out, dropped
}
