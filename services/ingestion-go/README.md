# Ingestion Service (Go Edge Collector)

**Sole production collector.** Publishes enriched events to Kafka (`acks=all`).

## Pipeline

1. Validate V1 tracker batches (`POST /v1/batch`, `POST /v1/e`)
2. Resolve site keys via SHA-256 → Postgres `sites.public_key_hash`
3. Enforce privacy settings, domain allowlist, DNT, localhost policy
4. Redis fixed-window rate limiting + monthly quota gate
5. Enrich geo/UA/bot
6. Produce to Kafka topic `KAFKA_TOPIC` (key = `eventId`)

Redis Streams are no longer used for events. Node ingest is deprecated.

## Run

```bash
pnpm --filter @trackme/ingestion-go dev
# or
cd services/ingestion-go && go run ./cmd/server
```

Requires `KAFKA_BROKERS` (default `localhost:9092`) and Postgres/Redis.
