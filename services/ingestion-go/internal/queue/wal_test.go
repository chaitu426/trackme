package queue

import (
	"os"
	"testing"
	"time"

	"github.com/trackme/ingestion-go/internal/enrich"
)

// newWAL opens a WAL in a temp dir and closes it when the test ends (an open segment blocks directory cleanup on Windows).
func newWAL(t *testing.T, budget int64) *WAL {
	t.Helper()
	w, err := OpenWAL(t.TempDir(), budget)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	return w
}

func ids(batch []enrich.EnrichedEvent) []string {
	out := make([]string, len(batch))
	for i, e := range batch {
		out[i] = e.EventID
	}
	return out
}

func TestWALRoundTripsFramesInOrder(t *testing.T) {
	w := newWAL(t, 1<<20)
	if err := w.Append(events(3)); err != nil {
		t.Fatal(err)
	}
	if err := w.Append(events(2)); err != nil {
		t.Fatal(err)
	}
	if got := w.Segments(); len(got) != 0 {
		t.Fatalf("the open segment must not be replayable yet, got %v", got)
	}
	w.Roll()
	segs := w.Segments()
	if len(segs) != 1 {
		t.Fatalf("segments = %v", segs)
	}
	frames, err := w.Frames(segs[0])
	if err != nil || len(frames) != 2 || len(frames[0]) != 3 || len(frames[1]) != 2 {
		t.Fatalf("frames = %v err=%v", frames, err)
	}
	if got := ids(frames[0]); got[0] != "e0" || got[2] != "e2" {
		t.Fatalf("events changed in the round trip: %v", got)
	}
}

func TestWALIsBoundedAndFreesSpaceWhenReplayed(t *testing.T) {
	w := newWAL(t, 600)
	var full bool
	for i := 0; i < 50 && !full; i++ {
		if err := w.Append(events(5)); err == ErrWALFull {
			full = true
		}
	}
	if !full {
		t.Fatal("a WAL with a byte budget must eventually refuse, so a long outage cannot fill the disk")
	}
	if w.Bytes() > 600 {
		t.Fatalf("used %d bytes, budget 600", w.Bytes())
	}
	w.Roll()
	for _, s := range w.Segments() {
		w.Remove(s)
	}
	if w.Bytes() != 0 {
		t.Fatalf("bytes after replay = %d, want 0", w.Bytes())
	}
	if err := w.Append(events(1)); err != nil {
		t.Fatalf("space should be available again: %v", err)
	}
}

func TestWALSurvivesACrash(t *testing.T) {
	dir := t.TempDir()
	w, _ := OpenWAL(dir, 1<<20)
	_ = w.Append(events(4))
	// The process dies with the segment open: its handle is released by the OS, nothing is rolled or flushed.
	_ = w.f.Close()
	reopened, err := OpenWAL(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if reopened.Bytes() == 0 {
		t.Fatal("the new process must account for what is already on disk")
	}
	segs := reopened.Segments()
	if len(segs) != 1 {
		t.Fatalf("the leftover segment must be replayable by the next process, got %v", segs)
	}
	frames, _ := reopened.Frames(segs[0])
	if len(frames) != 1 || len(frames[0]) != 4 {
		t.Fatalf("recovered frames = %v", frames)
	}
}

func TestWALIgnoresATornFinalFrame(t *testing.T) {
	w := newWAL(t, 1<<20)
	_ = w.Append(events(2))
	_ = w.Append(events(3))
	w.Roll()
	seg := w.Segments()[0]
	info, _ := os.Stat(seg)
	if err := os.Truncate(seg, info.Size()-5); err != nil { // power loss mid-write of the second frame
		t.Fatal(err)
	}
	frames, err := w.Frames(seg)
	if err != nil || len(frames) != 1 || len(frames[0]) != 2 {
		t.Fatalf("expected only the intact first frame, got %v err=%v", frames, err)
	}
}

func TestEventsKafkaRefusesAreSpilledNotDropped(t *testing.T) {
	w := newWAL(t, 1<<20)
	prod := &fakeProducer{err: os.ErrClosed}
	a := NewAsyncPublisher(prod, AsyncOptions{MinBatch: 1, FlushInterval: time.Millisecond, MaxAttempts: 1, RetryBackoff: time.Millisecond, WAL: w})
	defer a.Close()

	if _, err := a.Publish(nil, events(5)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for w.Bytes() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if w.Bytes() == 0 {
		t.Fatal("events that Kafka refused must land in the WAL instead of being dropped")
	}

	// Kafka recovers: the replay loop publishes what was spilled and clears the disk.
	prod.mu.Lock()
	prod.err = nil
	prod.mu.Unlock()
	for time.Now().Before(deadline.Add(8*time.Second)) && w.Bytes() != 0 {
		time.Sleep(50 * time.Millisecond)
	}
	if w.Bytes() != 0 {
		t.Fatal("the WAL was not drained after Kafka recovered")
	}
}

func TestFullQueueSpillsInsteadOfRejecting(t *testing.T) {
	w := newWAL(t, 1<<20)
	block := make(chan struct{})
	prod := &fakeProducer{block: block, started: make(chan struct{}, 1)}
	a := NewAsyncPublisher(prod, AsyncOptions{MaxEvents: 5, MinBatch: 1, FlushInterval: time.Millisecond, WAL: w})
	defer func() { close(block); a.Close() }()

	if _, err := a.Publish(nil, events(5)); err != nil {
		t.Fatal(err)
	}
	<-prod.started
	if _, err := a.Publish(nil, events(5)); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Publish(nil, events(5)); err != nil {
		t.Fatalf("with a WAL a full queue must absorb the overflow, not answer 429: %v", err)
	}
	if w.Bytes() == 0 {
		t.Fatal("overflow should have been spilled to disk")
	}
}
