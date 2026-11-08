package queue

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/trackme/ingestion-go/internal/enrich"
)

type fakeProducer struct {
	mu      sync.Mutex
	batches [][]enrich.EnrichedEvent
	err     error
	started chan struct{}
	block   chan struct{}
}

func (f *fakeProducer) Publish(_ context.Context, events []enrich.EnrichedEvent) ([]int, error) {
	f.mu.Lock()
	f.batches = append(f.batches, append([]enrich.EnrichedEvent(nil), events...))
	f.mu.Unlock()
	if f.started != nil {
		select {
		case f.started <- struct{}{}:
		default:
		}
	}
	if f.block != nil {
		<-f.block
	}
	if f.err != nil {
		return nil, f.err
	}
	indices := make([]int, len(events))
	for i := range indices {
		indices[i] = i
	}
	return indices, nil
}

func (f *fakeProducer) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, b := range f.batches {
		n += len(b)
	}
	return n
}

func events(n int) []enrich.EnrichedEvent {
	out := make([]enrich.EnrichedEvent, n)
	for i := range out {
		out[i] = enrich.EnrichedEvent{TrackerEvent: enrich.TrackerEvent{EventID: fmt.Sprintf("e%d", i)}}
	}
	return out
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestAsyncPublisherFlushesWhenMinBatchIsReached(t *testing.T) {
	p := &fakeProducer{}
	a := NewAsyncPublisher(p, AsyncOptions{
		MaxEvents:      100,
		MinBatch:       2,
		MaxBatch:       10,
		FlushInterval:  time.Hour,
		MaxAttempts:    1,
		PublishTimeout: time.Second,
	})
	defer a.Close()

	indices, err := a.Publish(context.Background(), events(2))
	if err != nil || len(indices) != 2 {
		t.Fatalf("Publish = %v, %v", indices, err)
	}
	waitFor(t, "background publish", func() bool { return p.total() == 2 })
}

func TestAsyncPublisherRejectsWhenBoundedQueueIsFull(t *testing.T) {
	p := &fakeProducer{started: make(chan struct{}, 1), block: make(chan struct{})}
	a := NewAsyncPublisher(p, AsyncOptions{
		MaxEvents:      2,
		MinBatch:       1,
		MaxBatch:       1,
		FlushInterval:  time.Millisecond,
		MaxAttempts:    1,
		PublishTimeout: time.Second,
	})

	if _, err := a.Publish(context.Background(), events(1)); err != nil {
		t.Fatalf("first publish: %v", err)
	}
	// Wait until the producer has taken the first event and is blocked, so the
	// next events accumulate in the queue instead of being drained.
	select {
	case <-p.started:
	case <-time.After(time.Second):
		t.Fatal("producer never started")
	}

	if _, err := a.Publish(context.Background(), events(2)); err != nil {
		t.Fatalf("filling the queue: %v", err)
	}
	if _, err := a.Publish(context.Background(), events(1)); err != ErrFull {
		t.Fatalf("overflow error = %v, want ErrFull", err)
	}

	close(p.block)
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestAsyncPublisherCloseDrainsQueuedEvents(t *testing.T) {
	p := &fakeProducer{}
	a := NewAsyncPublisher(p, AsyncOptions{
		MaxEvents:      100,
		MinBatch:       100, // never reaches the threshold, so only Close drains
		MaxBatch:       100,
		FlushInterval:  time.Hour,
		MaxAttempts:    1,
		PublishTimeout: time.Second,
	})

	if _, err := a.Publish(context.Background(), events(5)); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	if got := p.total(); got != 0 {
		t.Fatalf("published %d events before Close, want 0", got)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if got := p.total(); got != 5 {
		t.Fatalf("published %d events after Close, want 5", got)
	}
}

func TestAsyncPublisherRejectsAfterClose(t *testing.T) {
	a := NewAsyncPublisher(&fakeProducer{}, AsyncOptions{FlushInterval: time.Hour})
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Publish(context.Background(), events(1)); err != ErrClosed {
		t.Fatalf("Publish after Close = %v, want ErrClosed", err)
	}
}

func TestWithoutIndicesKeepsUnpublishedEventsInOrder(t *testing.T) {
	in := events(4)
	out := withoutIndices(in, []int{0, 2, 9, -1})
	if len(out) != 2 || out[0].EventID != "e1" || out[1].EventID != "e3" {
		t.Fatalf("withoutIndices = %+v", out)
	}
}
