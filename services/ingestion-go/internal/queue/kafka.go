package queue

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/trackme/ingestion-go/internal/enrich"
	"github.com/trackme/ingestion-go/internal/metrics"
)

// Publisher writes enriched events to Kafka with acks=all.
// Message key = siteId:sessionId keeps a session's events ordered while
// still spreading load across partitions. eventId remains in the payload for
// idempotent dedupe downstream.
type Publisher struct {
	writer  *kafka.Writer
	topic   string
	brokers []string
	// timeout bounds one Publish. The HTTP server gives up on a request after its write
	// timeout, and kafka-go otherwise keeps retrying a stalled broker long after that.
	timeout time.Duration
}

// ParseCompression maps a KAFKA_COMPRESSION value to a codec. zstd needs
// brokers >= 2.1; operators on older brokers set "snappy" (or "gzip").
func ParseCompression(name string) (kafka.Compression, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "zstd":
		return kafka.Zstd, nil
	case "snappy":
		return kafka.Snappy, nil
	case "lz4":
		return kafka.Lz4, nil
	case "gzip":
		return kafka.Gzip, nil
	case "none":
		return 0, nil
	}
	return 0, fmt.Errorf("unsupported KAFKA_COMPRESSION %q", name)
}

// newWriter builds the producer. The HTTP handler no longer waits on it: the
// async queue flushes large batches in the background, so a linger here costs
// no request latency and lets one WriteMessages call carry up to BatchSize
// events. kafka-go v0.4.47 has no idempotent producer, so retries of ambiguous
// timeouts rely on event-ID claims at the edge and the ClickHouse insert dedupe
// token for exactly-once storage.
func newWriter(brokers []string, topic string, compression kafka.Compression) *kafka.Writer {
	return &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        topic,
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		Async:        false,
		BatchSize:    5000,
		BatchBytes:   16 << 20,
		BatchTimeout: 10 * time.Millisecond,
		Compression:  compression,
		// These bound one background attempt. The queue retries with backoff, so
		// they can be longer than the old in-request budget.
		WriteTimeout: 10 * time.Second,
		ReadTimeout:  10 * time.Second,
		MaxAttempts:  5,
	}
}

func NewPublisher(brokers []string, topic string, compression kafka.Compression) *Publisher {
	return &Publisher{topic: topic, brokers: brokers, writer: newWriter(brokers, topic, compression), timeout: 10 * time.Second}
}

// WithTimeout sets the longest a Publish may take. Zero or negative keeps the default.
func (p *Publisher) WithTimeout(d time.Duration) *Publisher {
	if d > 0 {
		p.timeout = d
	}
	return p
}

// WithShuffle spreads each site over a stable subset of k partitions instead of all of them (see
// Shuffle). k <= 0 keeps plain key hashing.
func (p *Publisher) WithShuffle(k int) *Publisher {
	if k > 0 {
		p.writer.Balancer = &Shuffle{K: k}
	}
	return p
}

// Ping reports whether any broker accepts a connection, for readiness checks.
func (p *Publisher) Ping(ctx context.Context) error {
	var last error
	for _, broker := range p.brokers {
		dialer := &kafka.Dialer{Timeout: 2 * time.Second}
		conn, err := dialer.DialContext(ctx, "tcp", broker)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		last = err
	}
	return fmt.Errorf("no kafka broker reachable: %w", last)
}

var bufPool = sync.Pool{New: func() any { return bytes.NewBuffer(make([]byte, 0, 2048)) }}

// marshalEvent encodes through a pooled buffer and returns an exact-size copy,
// because the Kafka writer retains Value until the batch is flushed.
func marshalEvent(event enrich.EnrichedEvent) ([]byte, error) {
	buf := bufPool.Get().(*bytes.Buffer)
	defer bufPool.Put(buf)
	buf.Reset()
	enc := json.NewEncoder(buf)
	if err := enc.Encode(event); err != nil {
		return nil, err
	}
	out := bytes.TrimRight(buf.Bytes(), "\n")
	return append([]byte(nil), out...), nil
}

func successfulWriteIndices(err error, eventCount int) ([]int, bool) {
	var writeErrors kafka.WriteErrors
	if !errors.As(err, &writeErrors) || len(writeErrors) != eventCount {
		return nil, false
	}
	published := make([]int, 0, eventCount)
	for i, writeErr := range writeErrors {
		if writeErr == nil {
			published = append(published, i)
		}
	}
	return published, true
}

func (p *Publisher) Publish(ctx context.Context, events []enrich.EnrichedEvent) ([]int, error) {
	msgs := make([]kafka.Message, 0, len(events))
	for _, event := range events {
		payload, err := marshalEvent(event)
		if err != nil {
			return nil, fmt.Errorf("marshal event %s: %w", event.EventID, err)
		}
		key := event.SiteID + ":" + event.SessionID
		if key == ":" || event.SessionID == "" {
			key = event.SiteID + ":" + event.VisitorPseudonym
		}
		if key == ":" {
			key = event.SiteID
		}
		msgs = append(msgs, kafka.Message{
			Key:   []byte(key),
			Value: payload,
			Headers: []kafka.Header{
				{Key: "site_id", Value: []byte(event.SiteID)},
				{Key: "type", Value: []byte(event.Type)},
			},
			Time: time.Now().UTC(),
		})
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	err := p.writer.WriteMessages(ctx, msgs...)
	metrics.Default.KafkaPublishDuration.Observe(time.Since(start).Seconds())
	if err != nil {
		metrics.Default.KafkaPublishErrors.Inc()
		if published, known := successfulWriteIndices(err, len(events)); known {
			return published, err
		}
		return nil, err
	}
	published := make([]int, len(events))
	for i := range published {
		published[i] = i
	}
	return published, nil
}

func (p *Publisher) Close() error {
	return p.writer.Close()
}
