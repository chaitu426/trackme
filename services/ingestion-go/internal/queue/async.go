package queue

import (
	"context"
	"errors"
	"log"
	"os"
	"sync"
	"time"

	"github.com/trackme/ingestion-go/internal/enrich"
	"github.com/trackme/ingestion-go/internal/metrics"
)

var (
	// ErrFull means the bounded queue cannot accept more events right now. The
	// caller should shed the request (429) instead of waiting on Kafka.
	ErrFull = errors.New("produce queue is full")
	// ErrClosed means the edge is shutting down and no longer accepts events.
	ErrClosed = errors.New("producer is shutting down")
)

// Producer is the Kafka write path the async queue drains into. It is an
// interface so the batching/retry behaviour can be tested without a broker.
type Producer interface {
	Publish(ctx context.Context, events []enrich.EnrichedEvent) (publishedIndices []int, err error)
}

// AsyncOptions bounds the queue and sets how it is drained. Zero values fall
// back to the defaults below.
type AsyncOptions struct {
	// MaxEvents is the hard bound on events waiting for Kafka. When it would be
	// exceeded, Publish returns ErrFull and the edge answers 429.
	MaxEvents int
	// MinBatch flushes as soon as this many events are queued.
	MinBatch int
	// MaxBatch caps one Kafka WriteMessages call.
	MaxBatch int
	// FlushInterval is the longest an event waits when the queue is below MinBatch.
	FlushInterval time.Duration
	// MaxAttempts bounds retries for one batch. Exhausted batches are counted as
	// dropped: their claims and quota stay reserved because the outcome is unknown.
	MaxAttempts int
	// RetryBackoff is the first retry delay; it doubles per attempt, capped at 5s.
	RetryBackoff time.Duration
	// PublishTimeout bounds one Kafka write attempt.
	PublishTimeout time.Duration
	// WAL, when set, takes events the queue cannot hold or Kafka would not accept, and a
	// background loop replays them. Without it those events are shed (429) or dropped.
	WAL *WAL
}

func (o AsyncOptions) withDefaults() AsyncOptions {
	if o.MaxEvents <= 0 {
		o.MaxEvents = 10_000
	}
	if o.MinBatch <= 0 {
		o.MinBatch = 500
	}
	if o.MaxBatch <= 0 {
		o.MaxBatch = 5_000
	}
	if o.MaxBatch < o.MinBatch {
		o.MaxBatch = o.MinBatch
	}
	if o.MinBatch > o.MaxEvents {
		o.MinBatch = o.MaxEvents
	}
	if o.FlushInterval <= 0 {
		o.FlushInterval = 50 * time.Millisecond
	}
	if o.MaxAttempts <= 0 {
		o.MaxAttempts = 5
	}
	if o.RetryBackoff <= 0 {
		o.RetryBackoff = 100 * time.Millisecond
	}
	if o.PublishTimeout <= 0 {
		o.PublishTimeout = 10 * time.Second
	}
	return o
}

// AsyncPublisher decouples the HTTP request from Kafka. Publish only appends to
// a bounded in-memory buffer; a background goroutine drains it in large batches.
//
// An accepted (202) request therefore means "queued", not "durably written to
// Kafka". Claims and quota are settled at admission and are never refunded for
// an ambiguous produce outcome, because refunding would let a retry be charged
// twice or stored twice. Failures are visible through edge_publish_outcomes_total.
type AsyncPublisher struct {
	pub    Producer
	opts   AsyncOptions
	wake   chan struct{}
	stop   chan struct{}
	done   chan struct{}
	once   sync.Once
	mu     sync.Mutex
	queue  []enrich.EnrichedEvent
	since  time.Time
	closed bool
}

func NewAsyncPublisher(pub Producer, opts AsyncOptions) *AsyncPublisher {
	a := &AsyncPublisher{
		pub:  pub,
		opts: opts.withDefaults(),
		wake: make(chan struct{}, 1),
		stop: make(chan struct{}),
		done: make(chan struct{}),
	}
	go a.run()
	if a.opts.WAL != nil {
		go a.replay()
	}
	return a
}

// Publish enqueues events without waiting for Kafka. The returned indices mark
// every event as accepted into the queue; delivery is tracked separately.
func (a *AsyncPublisher) Publish(_ context.Context, events []enrich.EnrichedEvent) ([]int, error) {
	if len(events) == 0 {
		return nil, nil
	}

	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return nil, ErrClosed
	}
	if len(a.queue)+len(events) > a.opts.MaxEvents {
		a.mu.Unlock()
		if a.spill(events) {
			return allIndices(len(events)), nil
		}
		metrics.Default.PublishQueueOverflow.Inc()
		return nil, ErrFull
	}
	if len(a.queue) == 0 {
		a.since = time.Now()
	}
	a.queue = append(a.queue, events...)
	depth := len(a.queue)
	a.mu.Unlock()

	metrics.Default.PublishQueueDepth.Set(float64(depth))
	select {
	case a.wake <- struct{}{}:
	default:
	}

	return allIndices(len(events)), nil
}

func allIndices(n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	return out
}

// spill moves events to the WAL. It reports false when there is no WAL or no room, in which
// case the caller sheds or drops exactly as it did before the WAL existed.
func (a *AsyncPublisher) spill(events []enrich.EnrichedEvent) bool {
	if a.opts.WAL == nil {
		return false
	}
	if err := a.opts.WAL.Append(events); err != nil {
		log.Printf("async produce: wal append failed, %d events not spilled: %v", len(events), err)
		return false
	}
	metrics.Default.PublishOutcomes.WithLabelValues("spilled").Add(float64(len(events)))
	metrics.Default.WALBytes.Set(float64(a.opts.WAL.Bytes()))
	return true
}

// replay drains the WAL oldest-first whenever Kafka accepts writes. A frame is removed only after
// Kafka acknowledged it; a partially acknowledged frame keeps just its unacknowledged events.
// If the process dies mid-segment the frames already sent are sent again on the next start:
// at-least-once, absorbed by the worker's block dedupe and the reconciliation job.
func (a *AsyncPublisher) replay() {
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	var (
		seg    string
		frames [][]enrich.EnrichedEvent
	)
	for {
		select {
		case <-a.stop:
			return
		case <-tick.C:
		}
		a.opts.WAL.Roll()
		for {
			if seg == "" {
				segs := a.opts.WAL.Segments()
				if len(segs) == 0 {
					break
				}
				seg = segs[0]
				var err error
				if frames, err = a.opts.WAL.Frames(seg); err != nil {
					log.Printf("async produce: unreadable wal segment %s: %v", seg, err)
					_ = os.Rename(seg, seg+".bad")
					seg = ""
					continue
				}
			}
			if len(frames) == 0 {
				a.opts.WAL.Remove(seg)
				seg = ""
				metrics.Default.WALBytes.Set(float64(a.opts.WAL.Bytes()))
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), a.opts.PublishTimeout)
			published, err := a.pub.Publish(ctx, frames[0])
			cancel()
			if err != nil {
				frames[0] = withoutIndices(frames[0], published)
				metrics.Default.PublishOutcomes.WithLabelValues("replayed").Add(float64(len(published)))
				break // Kafka is still unhappy; try again next tick
			}
			metrics.Default.PublishOutcomes.WithLabelValues("replayed").Add(float64(len(frames[0])))
			frames = frames[1:]
		}
	}
}

// Pressure is how close the edge is to refusing work, 0 (idle) to 1 (queue full). Any backlog in
// the WAL means Kafka is struggling, which counts as at least half.
func (a *AsyncPublisher) Pressure() float64 {
	a.mu.Lock()
	p := float64(len(a.queue)) / float64(a.opts.MaxEvents)
	a.mu.Unlock()
	if w := a.opts.WAL; w != nil {
		if b := w.Bytes(); b > 0 {
			p = max(p, 0.5+0.5*float64(b)/float64(w.maxBytes))
		}
	}
	return p
}

// Close stops accepting new events, drains what is queued (bounded by a 10s
// deadline), then returns. The underlying producer is closed by its owner.
func (a *AsyncPublisher) Close() error {
	a.once.Do(func() {
		a.mu.Lock()
		a.closed = true
		a.mu.Unlock()
		close(a.stop)
	})
	<-a.done
	return nil
}

func (a *AsyncPublisher) run() {
	ticker := time.NewTicker(a.opts.FlushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-a.stop:
			a.drain()
			close(a.done)
			return
		case <-a.wake:
		case <-ticker.C:
		}
		a.flush(a.opts.MaxAttempts)
	}
}

// flush drains batches while the queue is at or above MinBatch, or when the
// oldest pending event has waited FlushInterval.
func (a *AsyncPublisher) flush(maxAttempts int) {
	for {
		batch, ok := a.take(false)
		if !ok {
			return
		}
		a.publish(batch, maxAttempts)
	}
}

func (a *AsyncPublisher) drain() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for ctx.Err() == nil {
		batch, ok := a.take(true)
		if !ok {
			return
		}
		a.publishContext(ctx, batch, 1)
	}
	a.mu.Lock()
	pending := len(a.queue)
	a.mu.Unlock()
	if pending > 0 {
		log.Printf("async produce: shutdown drain deadline reached with %d events still queued", pending)
	}
}

func (a *AsyncPublisher) take(force bool) ([]enrich.EnrichedEvent, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.queue) == 0 {
		return nil, false
	}
	if !force && len(a.queue) < a.opts.MinBatch && time.Since(a.since) < a.opts.FlushInterval {
		return nil, false
	}
	n := len(a.queue)
	if n > a.opts.MaxBatch {
		n = a.opts.MaxBatch
	}
	batch := make([]enrich.EnrichedEvent, n)
	copy(batch, a.queue[:n])
	rest := len(a.queue) - n
	copy(a.queue, a.queue[n:])
	a.queue = a.queue[:rest]
	if rest == 0 {
		a.since = time.Time{}
	}
	metrics.Default.PublishQueueDepth.Set(float64(rest))
	metrics.Default.PublishBatchSize.Observe(float64(n))
	return batch, true
}

func (a *AsyncPublisher) publish(batch []enrich.EnrichedEvent, maxAttempts int) {
	budget := a.opts.PublishTimeout * time.Duration(maxAttempts)
	if budget <= 0 || budget > 60*time.Second {
		budget = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	a.publishContext(ctx, batch, maxAttempts)
}

func (a *AsyncPublisher) publishContext(ctx context.Context, batch []enrich.EnrichedEvent, maxAttempts int) {
	remaining := batch
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		writeCtx, cancel := context.WithTimeout(ctx, a.opts.PublishTimeout)
		published, err := a.pub.Publish(writeCtx, remaining)
		cancel()
		if err == nil {
			metrics.Default.PublishOutcomes.WithLabelValues("published").Add(float64(len(remaining)))
			return
		}

		// A per-message error tells us exactly which events landed. Keep retrying
		// only the rest instead of duplicating the successful ones.
		if len(published) > 0 {
			metrics.Default.PublishOutcomes.WithLabelValues("published").Add(float64(len(published)))
			remaining = withoutIndices(remaining, published)
			if len(remaining) == 0 {
				return
			}
		}

		if attempt == maxAttempts || ctx.Err() != nil {
			fate := "spilled to wal"
			if !a.spill(remaining) {
				fate = "dropped"
				metrics.Default.PublishOutcomes.WithLabelValues("dropped").Add(float64(len(remaining)))
			}
			log.Printf("async produce: %d events unpublished after %d attempt(s), %s: %v", len(remaining), attempt, fate, err)
			return
		}

		metrics.Default.PublishOutcomes.WithLabelValues("retried").Inc()
		backoff := a.opts.RetryBackoff * time.Duration(1<<uint(attempt-1))
		if backoff > 5*time.Second {
			backoff = 5 * time.Second
		}
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
		case <-a.stop:
			if !a.spill(remaining) {
				metrics.Default.PublishOutcomes.WithLabelValues("dropped").Add(float64(len(remaining)))
			}
			return
		}
	}
}

func withoutIndices(events []enrich.EnrichedEvent, published []int) []enrich.EnrichedEvent {
	drop := make(map[int]struct{}, len(published))
	for _, i := range published {
		if i >= 0 && i < len(events) {
			drop[i] = struct{}{}
		}
	}
	out := make([]enrich.EnrichedEvent, 0, len(events)-len(drop))
	for i, event := range events {
		if _, ok := drop[i]; !ok {
			out = append(out, event)
		}
	}
	return out
}
