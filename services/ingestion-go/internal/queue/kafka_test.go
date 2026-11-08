package queue

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/trackme/ingestion-go/internal/enrich"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
)

func TestSuccessfulWriteIndicesIdentifiesPartialKafkaWrite(t *testing.T) {
	writeErr := kafka.WriteErrors{nil, errors.New("broker rejected message"), nil}

	got, known := successfulWriteIndices(writeErr, 3)
	if !known {
		t.Fatal("expected Kafka WriteErrors to report per-message results")
	}
	if len(got) != 2 || got[0] != 0 || got[1] != 2 {
		t.Fatalf("successful indices = %v, want [0 2]", got)
	}
}

func TestSuccessfulWriteIndicesTreatsAmbiguousErrorsAsUnknown(t *testing.T) {
	got, known := successfulWriteIndices(errors.New("context canceled"), 2)
	if known || len(got) != 0 {
		t.Fatalf("indices = %v, known = %v; ambiguous errors must be treated as unknown", got, known)
	}
}

func TestParseCompression(t *testing.T) {
	for in, want := range map[string]kafka.Compression{"": kafka.Zstd, "ZSTD": kafka.Zstd, "snappy": kafka.Snappy, "gzip": kafka.Gzip, "none": 0} {
		got, err := ParseCompression(in)
		if err != nil || got != want {
			t.Fatalf("ParseCompression(%q) = %v, %v; want %v", in, got, err, want)
		}
	}
	if _, err := ParseCompression("brotli"); err == nil {
		t.Fatal("unknown codec must be rejected at startup")
	}
}

func TestWriterSettings(t *testing.T) {
	w := newWriter([]string{"localhost:9092"}, "t", kafka.Zstd)
	if w.BatchTimeout != 10*time.Millisecond || w.Compression != kafka.Zstd || w.RequiredAcks != kafka.RequireAll || w.Async {
		t.Fatalf("unexpected writer settings: %+v", w)
	}
	if w.BatchSize != 5000 || w.MaxAttempts != 5 {
		t.Fatalf("batch/attempt settings = %d/%d, want 5000/5", w.BatchSize, w.MaxAttempts)
	}
}

func TestMarshalEventMatchesJSONMarshalAndDoesNotAlias(t *testing.T) {
	a := enrich.EnrichedEvent{TrackerEvent: enrich.TrackerEvent{EventID: "a", Title: "<x&y>"}, SiteID: "s"}
	b := enrich.EnrichedEvent{TrackerEvent: enrich.TrackerEvent{EventID: "b"}, SiteID: "s"}
	want, _ := json.Marshal(a)
	got, err := marshalEvent(a)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("marshalEvent = %s (%v), want %s", got, err, want)
	}
	if _, err := marshalEvent(b); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("a later marshal overwrote an earlier payload (pooled buffer aliased)")
	}
}
