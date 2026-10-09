package validate

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/trackme/ingestion-go/internal/enrich"
)

// The same file is run against the Zod TrackerEventSchema in packages/contracts.
// If the edge and the shared schema disagree about an event, one of the two
// suites fails.
func TestSharedContractFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/contracts/fixtures/tracker-events.json")
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var file struct {
		Cases []struct {
			Name  string              `json:"name"`
			Valid bool                `json:"valid"`
			Event enrich.TrackerEvent `json:"event"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse fixtures: %v", err)
	}
	if len(file.Cases) == 0 {
		t.Fatal("no fixture cases found")
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			_, _, reason := Event(c.Event, now, Window{Past: 100 * 365 * 24 * time.Hour, Future: 100 * 365 * 24 * time.Hour})
			if got := reason == ""; got != c.Valid {
				t.Fatalf("valid = %v (reason %q), want %v", got, reason, c.Valid)
			}
		})
	}
}
