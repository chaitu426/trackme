# Deploying TrackMe on AWS and on GCP

What to run, what to change in `infra/`, and what to set, for a production deployment on either cloud. The app code does not change between clouds; only where the five pieces of infrastructure and the five processes live.

> Status: this is a plan written from the repository, not a deployment that has been run. Items marked **(verify)** depend on a provider's current limits or pricing. The repository has **no Dockerfiles or Terraform yet** (`infra/` holds a local docker-compose, an Aiven guide and migrations); section 6 lists what to add.

## 1. What runs

Five processes and five stores.

| Process | Source | Port | Needs | Scale by |
| --- | --- | --- | --- | --- |
| **web** (dashboard, API routes, tracker assets) | `apps/web`, Next.js, `next start` | 3000 | Postgres, ClickHouse, Redis, Kafka (alert and Ask events) | CPU; stateless |
| **ingestion-go** (the public edge: `POST /v1/batch`, `/v1/e`, `GET /health`, `/ready`) | `services/ingestion-go` | 3001 (`INGESTION_PORT`), metrics on `METRICS_PORT` | Postgres, Redis, Kafka | requests; stateless |
| **event-worker** (Kafka to ClickHouse) | `services/event-worker`, `node dist/worker.js` | none | Kafka, ClickHouse, Redis, Postgres | Kafka partitions (`WORKER_PARTITION_CONCURRENCY` x replicas) |
| **scheduled-worker** (rollups, classifier, leak rollup, retention, alerts) | `services/scheduled-worker`, `node dist/scheduler.js` | none | Postgres, ClickHouse, Redis | **exactly one replica** unless its jobs are made leader-elected (verify in `src/`) |
| **tracker-docs** (optional) | `apps/tracker-docs` | 3002 or as set | none | static-like |
| ingest-proxy (optional) | `services/ingest-proxy`, Go | any | the edge | only for first-party proxying; see `infra/examples/nginx-first-party-proxy.conf` |

| Store | Used for | Managed option on AWS | Managed option on GCP |
| --- | --- | --- | --- |
| PostgreSQL 15+ | tenancy, users, sites, settings | **RDS for PostgreSQL** or Aurora | **Cloud SQL for PostgreSQL** |
| ClickHouse 24+ | events, rollups, payments, leaks | **ClickHouse Cloud** (AWS region) or self-run on EC2/EKS | **ClickHouse Cloud** (GCP region) or self-run on GCE/GKE |
| Redis-compatible | rate limits, quotas, sessions, realtime, streams | **ElastiCache for Valkey/Redis** (TLS) | **Memorystore for Redis/Valkey** (TLS) |
| Kafka | durable event bus | **Amazon MSK** (or MSK Serverless) | no native Kafka: **Confluent Cloud on GCP**, **Aiven Kafka**, or self-run (Strimzi on GKE); GCP's own *Managed Service for Apache Kafka* exists **(verify availability and SASL support)** |
| Object storage | not required today (source maps are in Postgres/ClickHouse; verify before relying on this) | S3 | GCS |

ClickHouse and Kafka are the two with no clean "native cloud" answer on both providers, so most teams run them as a managed third-party service in the same region as the apps. The repo already supports that: `infra/aiven/` is the managed-services path, and the apps read plain connection variables.

## 2. Choose a compute shape

| Shape | AWS | GCP | When |
| --- | --- | --- | --- |
| **Containers, no servers** (recommended) | ECS on Fargate | Cloud Run (web, edge) + a small always-on service for workers | least to operate |
| Kubernetes | EKS | GKE | you already run it |
| One VM per process group | EC2 + systemd | GCE + systemd | cheapest, most manual |

Notes that decide the shape:

- **Workers must not scale to zero.** event-worker holds a Kafka consumer group and scheduled-worker is a clock. On GCP that means Cloud Run with `min-instances=1` and "CPU always allocated", or GKE/GCE. On AWS, Fargate services with `desiredCount` of 1 or more.
- **The edge is latency-sensitive and public.** Put it behind the load balancer on its own hostname (for example `ingest.example.com`), keep `/metrics` on the private `METRICS_PORT`, and tell it how many proxies sit in front (`TRUSTED_PROXY_HOPS`, below).
- **web is stateless** (sessions are in Redis/Postgres, not memory), so run two or more behind the load balancer.

## 3. AWS

### 3.1 Topology

```
Route 53 ── CloudFront (optional, caches /t/v1/tracker.js)
              │
        ALB (443, ACM certificate)
        ├── app.example.com    → ECS service web            (3000)
        ├── ingest.example.com → ECS service ingestion-go   (3001, health /health)
        └── docs.example.com   → ECS service tracker-docs   (optional)

Private subnets:
  ECS: event-worker (n tasks), scheduled-worker (1 task)
  RDS PostgreSQL · ElastiCache (Valkey, TLS) · MSK (SASL/SCRAM over TLS) · ClickHouse Cloud via PrivateLink or public TLS
NAT gateway for egress (payment gateways, email, ClickHouse Cloud)
Secrets Manager / SSM Parameter Store → task environment
CloudWatch Logs; Prometheus scrapes the edge's METRICS_PORT (`infra/observability/alerts.yml`, `grafana-dashboard.json`)
```

### 3.2 Steps

1. **Network.** VPC with two AZs, public subnets (ALB, NAT), private subnets (everything else). Security groups: ALB open on 443; apps accept only from the ALB; stores accept only from the apps' security group.
2. **Stores.**
   - RDS PostgreSQL 16, Multi-AZ, `rds.force_ssl=1`. Use **RDS Proxy** if `web` (10 connections per task) + edge + scheduler pools could exceed `max_connections`.
   - ElastiCache Valkey 7 with in-transit encryption; use the `rediss://` URL. Set `maxmemory-policy` to `noeviction` for the keys that must not vanish, or use separate logical instances (the app has separate `REDIS_RATELIMIT_URL`, `REDIS_CACHE_URL`, `REDIS_STATE_URL`, `REDIS_COORD_URL`, which all default to `REDIS_URL`; production refuses to start if any is unset or still the development default).
   - MSK, three brokers, SASL/SCRAM over TLS. Create topics with `infra/aiven/create-kafka-topics.mjs` (it works against any Kafka; set `KAFKA_PARTITIONS` and `KAFKA_REPLICATION=3`).
   - ClickHouse: ClickHouse Cloud in the same AWS region (PrivateLink if you can), or a self-run 3-node cluster on EC2 with EBS gp3 (not recommended unless you operate ClickHouse).
3. **Build and push images** (section 6) to **ECR**.
4. **Secrets** to Secrets Manager, injected as task environment (section 5).
5. **Migrations**, once per release, from a one-off ECS task or CI job inside the VPC (section 7).
6. **ECS services.** One task definition per process. `web`: 1 vCPU / 2 GB, 2 tasks. `ingestion-go`: 0.5 vCPU / 512 MB, 2+ tasks, health check `GET /health` (readiness `GET /ready`). `event-worker`: 1 vCPU / 1 GB, tasks up to the partition count. `scheduled-worker`: 0.5 vCPU / 1 GB, exactly 1 task, `deploymentConfiguration` minimum healthy 0 / maximum 100 so two copies never overlap.
7. **ALB** with ACM certificates, host-based rules as above, health checks on the right paths, idle timeout 60 s. The edge returns quickly; do not buffer.
8. **DNS and the tracker.** Point `ingest.<domain>` at the ALB. The tracker snippet's `data-endpoint` is `https://ingest.<domain>/v1/batch`; its script URL is served by `web` at `/t/v1/tracker.js`.
9. **Autoscaling.** Target tracking on CPU 60% for `web` and `ingestion-go`; for `event-worker`, on MSK consumer lag (CloudWatch metric `MaxOffsetLag`) with the maximum capped at the partition count.
10. **Observability.** Ship container logs to CloudWatch; run a Prometheus (or AMP + Managed Grafana) that scrapes `METRICS_PORT`; import `infra/observability/alerts.yml` and `grafana-dashboard.json`.

### 3.3 AWS-specific gotchas

- ALB adds one proxy hop: set `TRUSTED_PROXY_HOPS=1` for the edge and for `web` (two if CloudFront is also in front). A wrong value makes every visitor look like the load balancer, and rate limiting and country lookup break silently.
- Fargate tasks have no persistent disk. The GeoIP database (`infra/geoip/dbip-city-lite.mmdb`) must be **baked into the edge image** or downloaded at start (`scripts/download-geoip.sh`).
- MSK SASL/SCRAM uses port 9096; IAM auth uses 9098 and needs a different client library setup. The app's variables describe SASL/SCRAM (`KAFKA_SASL_MECHANISM`, `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD`, `KAFKA_SSL=true`).
- ClickHouse Cloud over the public internet needs the NAT gateway's Elastic IP allow-listed.

## 4. GCP

### 4.1 Topology

```
Cloud DNS ── Global external HTTPS load balancer (managed certificate) [+ Cloud CDN for /t/v1/tracker.js]
              ├── app.example.com    → Cloud Run web             (min instances 2)
              ├── ingest.example.com → Cloud Run ingestion-go    (min instances 2)
              └── docs.example.com   → Cloud Run tracker-docs    (optional)

Always-on workers: GKE Autopilot or GCE (or Cloud Run with min=1, CPU always allocated)
  event-worker (n), scheduled-worker (1)
Cloud SQL PostgreSQL (private IP) · Memorystore (Valkey/Redis, TLS) · Kafka: Confluent/Aiven/Managed Kafka · ClickHouse Cloud (GCP region)
Serverless VPC Access (or Direct VPC egress) so Cloud Run reaches private IPs
Secret Manager → env / mounted secrets; Cloud Logging; Managed Service for Prometheus
```

### 4.2 Steps

1. **Project and network.** A VPC with a subnet in one region; Private Service Access for Cloud SQL and Memorystore; Cloud NAT for egress.
2. **Stores.**
   - Cloud SQL PostgreSQL 16, HA, private IP, "require SSL". Connection limits are small on small tiers: use **Cloud SQL Auth Proxy** or **PgBouncer** and cap pool sizes (`web` uses up to 10 per instance).
   - Memorystore for Redis (or Valkey), in-transit encryption on. The auth string goes into `REDIS_URL` as `rediss://:<auth>@host:port`.
   - Kafka: there is no Pub/Sub substitute here, because the pipeline relies on Kafka semantics (`acks=all`, consumer groups, partition ordering by `eventId`). Use Confluent Cloud or Aiven Kafka in the same region, or Google's managed Kafka service if SASL/SCRAM fits your plan **(verify)**.
   - ClickHouse Cloud in a GCP region, or self-run on GCE with Persistent Disk SSD.
3. **Build and push images** to **Artifact Registry** with Cloud Build (section 6).
4. **Secrets** to Secret Manager; reference them from Cloud Run (`--set-secrets`) or GKE (External Secrets / CSI driver).
5. **Migrations** as a **Cloud Run Job** (or Cloud Build step on a private pool) running the migration commands (section 7).
6. **Services.**
   - `web`: Cloud Run, 1 vCPU / 2 GiB, concurrency 80, min instances 2. 
   - `ingestion-go`: Cloud Run, 1 vCPU / 512 MiB, concurrency 200, min instances 2, startup probe `GET /health`. For very high event rates run it on GKE instead, to avoid per-request billing and cold starts.
   - `event-worker`, `scheduled-worker`: **not** request-driven, so use GKE Autopilot Deployments (event-worker: replicas up to partition count; scheduled-worker: `replicas: 1`, `strategy: Recreate`), or Cloud Run with `--no-cpu-throttling --min-instances=1 --max-instances=1` for the scheduler.
7. **Load balancer and DNS.** A global external Application Load Balancer with serverless NEGs for the Cloud Run services; managed certificates; hosts as above.
8. **Autoscaling.** Cloud Run scales on concurrency; GKE HPA on CPU for the workers, or KEDA on Kafka lag for `event-worker`.
9. **Observability.** Cloud Logging by default; Managed Service for Prometheus scraping the edge's `METRICS_PORT`; import the alert rules from `infra/observability/alerts.yml`.

### 4.3 GCP-specific gotchas

- A Google load balancer in front of Cloud Run is one hop, but Cloud Run also adds `X-Forwarded-For` handling of its own. Set `TRUSTED_PROXY_HOPS` after testing with a known client IP, and check the country the dashboard reports for your own request.
- Cloud Run's filesystem is in-memory: bake the GeoIP database into the edge image.
- Cloud Run request timeout and body limits are fine for event batches (up to 50 events), but **source map uploads** are larger; the app allows a bigger body on that one route only, so confirm the load balancer does not cap it lower.
- Memorystore is reachable only from inside the VPC, so Cloud Run needs VPC egress configured.

## 5. Configuration to set (both clouds)

Production refuses to start with development defaults, by design. Set these, from the secret store:

| Variable | Used by | Notes |
| --- | --- | --- |
| `NODE_ENV=production` | all | turns on the production checks |
| `DATABASE_URL` | web, edge, workers | `?sslmode=require` |
| `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB` | web, event-worker, scheduled-worker | HTTPS URL; create the database first |
| `CLICKHOUSE_DASHBOARD_USER`, `CLICKHOUSE_DASHBOARD_PASSWORD` | web | **required in production**: a read-only user. Create it with `infra/ops/clickhouse-dashboard-ro.sql` (see `infra/aiven/README.md` section 3 if the provider limits settings profiles) |
| `REDIS_URL` (+ `REDIS_RATELIMIT_URL`, `REDIS_CACHE_URL`, `REDIS_STATE_URL`, `REDIS_COORD_URL`) | web, edge, workers | `rediss://`; the edge refuses to start if any is unset or still the dev default |
| `KAFKA_BROKERS`, `KAFKA_SSL`, `KAFKA_SASL_MECHANISM`, `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD`, `KAFKA_CA_CERT_PATH` (only for a private CA), `KAFKA_TOPIC`, `KAFKA_DLQ_TOPIC`, `KAFKA_CONSUMER_GROUP` | edge, event-worker | |
| `SITE_SIGNING_SECRET_KEY` (+ `SITE_SIGNING_SECRET_KEY_PREVIOUS` while rotating) | web, edge | long random value; rotate with `pnpm security:rotate-secrets` |
| `NEXTAUTH_SECRET` | web | long random value |
| `APP_URL`, `NEXT_PUBLIC_DOCS_URL` | web | public URLs |
| `SESSION_COOKIE_DOMAIN` | web | parent domain if the app and docs share sign-in |
| `TRUSTED_PROXY_HOPS` | web, edge | number of proxies in front (ALB=1, plus CDN=2); the edge **requires** it |
| `METRICS_PORT` | edge | private listener for `/metrics`; or `ALLOW_PUBLIC_METRICS=true` to accept the risk |
| `METRICS_TOKEN` | web | protects the web app's metrics route |
| `ALLOWED_ORIGINS` | edge | origins allowed to post events |
| `INGESTION_PORT` | edge | default 3001 |
| `RESEND_API_KEY` or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` | web | invitations, verification, alerts |
| `API_RATE_LIMIT_PER_MINUTE`, `CSP_MODE` | web | tuning |
| `WORKER_PARTITION_CONCURRENCY` | event-worker | match topic partitions |

`GEO_LOOPBACK_IP` is a development setting; the edge refuses to start in production if it is set.

## 6. What to change in the repository

Nothing in `apps/` or `services/` is cloud-specific. Add these, and leave `infra/docker` and `infra/aiven` as the local and managed-services references.

```
infra/
  docker/                      (unchanged: local development)
  aiven/                       (unchanged: managed Postgres/ClickHouse/Kafka/Valkey, reused on either cloud)
  images/                      NEW  Dockerfiles, one per process
    web.Dockerfile             multi-stage: pnpm install, `pnpm build:app --filter=@trackme/web`, run `next start --port 3000`
    ingestion-go.Dockerfile    multi-stage: golang build of ./cmd/server, copy the binary and infra/geoip/*.mmdb into a distroless image
    event-worker.Dockerfile    pnpm build, `node dist/worker.js`
    scheduled-worker.Dockerfile pnpm build, `node dist/scheduler.js`
    tracker-docs.Dockerfile    optional
  aws/                         NEW  Terraform (or CDK)
    network.tf  rds.tf  elasticache.tf  msk.tf  ecr.tf  ecs.tf  alb.tf  secrets.tf  observability.tf
  gcp/                         NEW  Terraform
    network.tf  cloudsql.tf  memorystore.tf  artifact-registry.tf  cloudrun.tf  gke-workers.tf  lb.tf  secrets.tf  observability.tf
  migrations/                  (unchanged: run by the release job)
.github/workflows/             NEW  build-and-push, migrate, deploy per cloud (or Cloud Build `cloudbuild.yaml`)
```

Image notes:

- Build with the **monorepo root as context** so workspace packages (`packages/*`) are available; `pnpm deploy --filter <package> --prod` produces a small runtime folder per service.
- Run as a non-root user; `EXPOSE` the port; add a `HEALTHCHECK` only where the platform does not do it for you (the edge exposes `GET /health`).
- The web build runs `apps/web/scripts/copy-tracker-assets.mjs` first; keep the order.
- Pin Node 22+ (`engines` allows 20+) and Go to the version in `go.mod`.

## 7. Release order

1. Build and push all images, tagged with the commit.
2. **Migrate** (a one-off job inside the VPC):
   - Postgres: `pnpm db:migrate`
   - ClickHouse: `node infra/aiven/migrate-clickhouse.mjs` (records progress in `schema_migrations`, safe to re-run; `--dry-run` first)
   - Kafka topics, first time only: `node infra/aiven/create-kafka-topics.mjs`
   - Read-only dashboard user, first time only (section 5).
3. Deploy **event-worker** and **scheduled-worker** first if a migration added columns they write; otherwise any order. The migrations are additive, so old code keeps working against the new schema during a rolling deploy.
4. Deploy **ingestion-go**, then **web**.
5. Smoke test: `GET /health` and `GET /ready` on the edge; sign in; send one event with the tracker snippet; see it on the dashboard within a few seconds; check `/metrics` is **not** reachable on the public hostname.

Rollback: redeploy the previous image tag. Migrations are additive; destructive ones have `down` files in `infra/migrations/clickhouse`, but run those by hand and only after reading them.

## 8. Cost and sizing starting point

A small production footprint (a few million events a month) is roughly: 2 web tasks, 2 edge tasks, 1 to 2 event-worker tasks, 1 scheduler, a small Multi-AZ Postgres, a 1 to 2 GB Valkey, a 3-broker small Kafka, and ClickHouse Cloud at its smallest paid tier. The two expensive items are **Kafka** and **ClickHouse**; if cost matters, start with a single self-run Redpanda/Kafka node and ClickHouse on one VM (see `docs/operations/FREE_TEST_HOSTING.md` for the low-memory tuning) and move to managed services when traffic or uptime demands it.

## 9. Before going live

- [ ] Every variable in section 5 set from the secret store; none in the image or the repo.
- [ ] `TRUSTED_PROXY_HOPS` verified with a known client IP (country and rate limit behave).
- [ ] The edge's `/metrics` is private; alerts from `infra/observability/alerts.yml` are wired to a pager.
- [ ] Postgres and ClickHouse backups on, with one restore tested.
- [ ] TLS everywhere: managed certificate on the load balancer, `sslmode=require`, `rediss://`, Kafka SSL.
- [ ] One scheduled-worker replica, confirmed after a deploy.
- [ ] GeoIP database present in the edge image.
- [ ] `pnpm security:guard` and `pnpm security:audit` pass in CI.
- [ ] Payment gateway webhook URLs updated to the production hostname, and their secrets set per site.
