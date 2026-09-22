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
// Message key = eventId so retries land on the same partition and
// ClickHouse ReplacingMergeTree(event_id) can collapse duplicates.
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
		msgs = append(msgs, kafka.Message{
			Key:   []byte(event.EventID),
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
