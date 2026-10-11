package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/trackme/ingestion-go/internal/enrich"
)

// Publisher writes enriched events to Kafka with acks=all.
// Message key = siteId:sessionId keeps a session's events ordered while
// still spreading load across partitions. eventId remains in the payload for
// idempotent dedupe downstream.
type Publisher struct {
	writer *kafka.Writer
	topic  string
}

func NewPublisher(brokers []string, topic string) *Publisher {
	return &Publisher{
		topic: topic,
		writer: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        topic,
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireAll,
			Async:        false,
			BatchTimeout: 10 * time.Millisecond,
			Compression:  kafka.Gzip,
		},
	}
}

func (p *Publisher) Publish(ctx context.Context, events []enrich.EnrichedEvent) error {
	msgs := make([]kafka.Message, 0, len(events))
	for _, event := range events {
		payload, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("marshal event %s: %w", event.EventID, err)
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
	return p.writer.WriteMessages(ctx, msgs...)
}

func (p *Publisher) Close() error {
	return p.writer.Close()
}
