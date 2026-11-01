# Managed services on Aiven

An alternative to `infra/docker/docker-compose.yml`, which is unchanged. Use this when
Postgres, ClickHouse, Kafka and Valkey (Redis-compatible) run as Aiven services instead of local containers. Valkey
is configured through `REDIS_URL` with a `rediss://` URI; no setup script is needed.

## 1. Configure

```bash
cp infra/aiven/.env.aiven.example .env.aiven     # repo root, gitignored
mkdir -p infra/aiven/certs                         # gitignored
```

Fill in `.env.aiven` from each service's *Connection information*. Save the Kafka
*CA certificate* to `infra/aiven/certs/ca.pem`.

To run any service against Aiven, load that file as its environment (for example
`ENV_FILE`-style tooling, or copy the values into the deployment's secrets). The apps read
the same variable names as the Docker setup, so nothing else changes.

## 2. One-time setup, in order

```bash
# ClickHouse: in the console, Databases and tables, create `growth_analytics` first.
node infra/aiven/migrate-clickhouse.mjs --dry-run    # preview
node infra/aiven/migrate-clickhouse.mjs              # apply; records progress in schema_migrations

# Kafka: Aiven does not auto-create topics.
node infra/aiven/create-kafka-topics.mjs

# Postgres
pnpm db:migrate
```

All three are safe to re-run. `migrate-clickhouse.mjs` stops at the first failing
statement and prints it; fix and re-run to continue from that file.

## 3. Read-only dashboard user (production)

The web app refuses to start dashboard queries in production without
`CLICKHOUSE_DASHBOARD_USER`. On Aiven:

1. Console > ClickHouse > Users: create `dashboard_ro`.
2. Grant `SELECT` on `growth_analytics.*` only (the console's user page, or
   `GRANT SELECT ON growth_analytics.* TO dashboard_ro` from the query editor).
3. Aiven may not allow custom settings profiles. If `infra/ops/clickhouse-dashboard-ro.sql`
   fails on the `CREATE SETTINGS PROFILE` statements, skip them: the grant alone gives
   read-only access, only the per-query limits are lost. Record that in the plan.

## 4. Limits to know about

- **Postgres connections.** Small plans allow ~20. Use Aiven's *Connection pools* (PgBouncer)
  if you run more than a couple of processes.
- **Kafka.** Small plans cap topics and partitions; the free plan allows 2 partitions per topic and 5 topics (3 partitions is rejected with POLICY_VIOLATION).
- **Secrets.** Never commit `.env.aiven`. Rotate any password that has been pasted into a
  chat, screenshot or ticket.

## Not yet verified against a live Aiven service

The migration runner's statement splitting is tested by dry run only. `008`/`009` have not
run on a real ClickHouse yet, so the first real run of `migrate-clickhouse.mjs` is also
that validation.
