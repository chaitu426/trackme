# Hosting trackme for free (testing, no Docker)

Goal: run the whole pipeline (tracker → Go edge → Kafka → event-worker → ClickHouse, plus Postgres, Redis/Valkey, web app, scheduled-worker) for **$0**, with the fewest moving parts and the least memory.

> Free-tier terms change often. Items marked **(verify)** conflicted between sources when this was written (2026-11). Check the linked page before you depend on them.

## 0. Pick a path

| Path | Cost | Effort | Best for | Catch |
|---|---|---|---|---|
| **A. Everything on your PC (WSL2)** | $0 | low | development, demos on your machine | not reachable from the internet unless you tunnel (§6) |
| **B. One free cloud VM, everything native** | $0 | medium | a real public test URL, closest to production | Oracle may reclaim idle VMs; Arm binaries |
| **C. Managed free tiers (mix)** | $0 | medium | no server to maintain | ClickHouse and Kafka have **no permanent free tier** |

**Recommendation:** B for anything others will touch, A for daily development. C only for the pieces that have a real free tier (Postgres, Valkey), mixed into A or B.

## 1. What each component needs (and the cheapest free source)

| Component | Needed? | Free source |
|---|---|---|
| Postgres 15+ | yes (tenancy) | native on VM/WSL; or [Neon Free](https://neon.com/faqs/free-plan-limits-and-quotas) (1 GB/project, 100 CU-hours/month, blocks writes instead of billing); or [Aiven free](https://aiven.io/docs/platform/concepts/free-plan) (1 GB RAM / 1 GB disk) |
| Redis-compatible | yes (rate limit, quota, sessions, realtime) | native Valkey/Redis; or Aiven free Valkey (1 GB RAM, `maxmemory` 50%) |
| Kafka-compatible broker | yes | **Redpanda single binary** (self-hosted). Managed Kafka has no dependable free plan: Aiven's own docs list free Postgres/MySQL/Valkey only; third-party pages claim a Kafka free tier, which is unverified |
| ClickHouse | yes (analytics) | **native single binary** (self-hosted). [ClickHouse Cloud](https://clickhouse.com/pricing.md) is a 30-day / credit-limited trial, then pay-as-you-go: fine for a one-off demo, not a standing test env |
| Go edge (`services/ingestion-go`) | yes | build once, run the binary |
| event-worker, scheduled-worker, web | yes | Node 22+/24, `pnpm` |
| tracker-docs, ingest-proxy | optional | skip for testing |

The repo already supports the managed variant: `infra/aiven/README.md`, `.env.aiven.example`, `migrate-clickhouse.mjs`, `create-kafka-topics.mjs`. The same scripts work against self-hosted services, only the env vars change.

## 2. Memory budget (why the tuning in §5 matters)

Target: **everything in ~6–8 GB** (fits a 2 OCPU/12 GB Oracle VM, or a WSL2 VM capped at 8 GB).

| Service | Untuned | Tuned |
|---|---|---|
| ClickHouse | 2–4 GB+ | ~1–1.5 GB |
| Redpanda | grabs most RAM by default | ~1 GB |
| Postgres | 200–400 MB | ~150 MB |
| Valkey | 50 MB | 50–100 MB |
| Go edge | 100–300 MB | ~100 MB (`GOMEMLIMIT`) |
| event-worker | 200–400 MB | ~200 MB |
| scheduled-worker | 150–250 MB | ~150 MB |
| web (Next, `start`, not `dev`) | 300–600 MB | ~350 MB |
| **Total** | 5–8 GB+ | **~3.5–4.5 GB** |

Rule: always run **built** apps (`pnpm build:app` then `pnpm start:*`), never `next dev`, on a small box.

## 3. Path A: local, WSL2 (no Docker)

Windows has no native ClickHouse/Redpanda, so use WSL2 (Ubuntu). It is a plain Linux VM, not Docker.

1. `wsl --install -d Ubuntu`, reboot. Cap its memory in `%UserProfile%\.wslconfig`:
   ```
   [wsl2]
   memory=8GB
   processors=4
   swap=4GB
   ```
   then `wsl --shutdown`.
2. Inside Ubuntu, keep the repo on the **Linux filesystem** (`~/trackme`), not `/mnt/c` (10× slower file IO for ClickHouse/node_modules). Clone it there.
3. Install the runtimes: Node 24 (via `nvm`), `corepack enable` (pnpm), Go (from go.dev tarball), `sudo apt install postgresql valkey-server` (or `redis-server`).
4. ClickHouse, official single binary ([docs](https://clickhouse.com/docs/knowledgebase/install-clickhouse-windows10)):
   ```bash
   mkdir -p ~/ch && cd ~/ch && curl https://clickhouse.com/ | sh
   ./clickhouse server          # leave running; add the config from §5.1
   ```
5. Redpanda ([dev deployment docs](https://docs.redpanda.com/streaming/24.3/deploy/deployment-option/self-hosted/manual/production/dev-deployment.md)): follow the apt setup from the current docs, then
   ```bash
   sudo rpk redpanda mode dev
   sudo systemctl start redpanda      # or: rpk redpanda start --mode dev-container (see §5.2)
   ```
   If systemd is off in WSL, add `[boot]\nsystemd=true` to `/etc/wsl.conf` and restart WSL.
6. Continue at §4 (common steps).

## 4. Common steps (A and B)

```bash
cp .env.example .env            # then edit as in §7
pnpm install --frozen-lockfile

# schemas
createdb trackme                                   # or psql: CREATE DATABASE trackme;
pnpm db:migrate                                    # Postgres (Drizzle)
node infra/aiven/migrate-clickhouse.mjs --dry-run  # then without --dry-run; applies infra/migrations/clickhouse/*.sql in order
node infra/aiven/create-kafka-topics.mjs           # growth_events, growth_events_dlq

# build
pnpm build:app
(cd services/ingestion-go && go build -o bin/ingestion-go ./cmd/server)   # run.mjs launches this binary
node scripts/download-geoip.mjs                    # optional, free DB-IP database

# run (separate terminals, or pm2/systemd on B)
pnpm start:edge        # :3001
pnpm start:worker      # metrics :9464
pnpm start:scheduler   # metrics :9465
pnpm start:web         # :3000
```

`pnpm start:all` starts them together if you prefer one terminal.

**Smoke test**
```bash
curl -s localhost:3001/healthz
pnpm seed:demo                       # demo workspace + site
pnpm exec tsx scripts/e2e-load.ts    # sends events, checks they reach ClickHouse
```
Then open `http://localhost:3000`, sign up (dev mode returns the OTP as `devCode`, see §7), add the printed tracker snippet to any HTML page.

## 5. Low-memory tuning (the "most optimized" part)

### 5.1 ClickHouse
Create `~/ch/config.d/lowmem.xml` (and `users.d/` for profile settings) in the data dir the server uses:
```xml
<clickhouse>
  <max_server_memory_usage_to_ram_ratio>0.5</max_server_memory_usage_to_ram_ratio>
  <mark_cache_size>268435456</mark_cache_size>
  <uncompressed_cache_size>0</uncompressed_cache_size>
  <background_pool_size>4</background_pool_size>
  <max_concurrent_queries>20</max_concurrent_queries>
  <!-- system log tables grow forever and cost RAM/IO: drop the noisy ones -->
  <query_thread_log remove="1"/>
  <trace_log remove="1"/>
  <text_log remove="1"/>
  <metric_log remove="1"/>
  <asynchronous_metric_log remove="1"/>
</clickhouse>
```
Setting names are from memory of the ClickHouse docs, so **(verify)** against the config reference for your version. The repo already sets per-query limits and `wait_end_of_query=1` for dashboard queries.

### 5.2 Redpanda
- `rpk redpanda mode dev` / `--mode dev-container` turns on overprovisioned mode, `--reserve-memory 0M`, skips hardware checks and **skips fsync**. Right for tests, wrong for real data.
- Cap it explicitly: `rpk redpanda start --smp 1 --memory 1G --reserve-memory 0M --overprovisioned` **(verify flags for your version)**.
- Use **2 partitions** (`KAFKA_PARTITIONS=2`, `KAFKA_REPLICATION=1`) and short retention (`rpk topic alter-config growth_events --set retention.ms=86400000`). One edge + one worker needs no more.

### 5.3 App processes
- Go edge: `GOMEMLIMIT=120MiB`, `GOMAXPROCS=2`, keep the WAL dir on local disk with a small cap.
- Node: `NODE_OPTIONS=--max-old-space-size=256` for workers, `384` for web.
- Workers: `WORKER_WRITE_V2=1`. If memory is tight, run one `event-worker` and one scheduler, not several; `WORKER_ROLES` can split roles across processes later.
- Redis: `maxmemory 128mb`, `maxmemory-policy noeviction` (quota and leases must never be evicted).
- Postgres: `shared_buffers=64MB`, `max_connections=30` (set the web pool small too).

## 6. Path B: one free cloud VM, everything native

1. **VM**: Oracle Cloud Always Free Ampere A1. Oracle's [resource page](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) says 3,000 OCPU-hours and 18,000 GB-hours per month, i.e. 4 OCPU / 24 GB. Several 2026 posts say it was **cut to 2 OCPU / 12 GB from 15 June 2026 (verify)**. Both fit the budget in §2.
   - Idle reclamation: instances under roughly 15–20% CPU/network/memory (95th percentile, 7 days) may be reclaimed **(verify)**. Running the real stack plus a periodic `scripts/e2e-load.ts` usually keeps it busy; upgrading the account to pay-as-you-go while staying inside the free limits is the commonly reported safeguard **(verify)**.
   - Capacity is often "out of host capacity": retry later or try another availability domain/region.
2. Ubuntu 22.04/24.04 arm64. Open ports 80/443 in the VCN security list **and** `sudo iptables`/ufw (Oracle images block them by default).
3. Install as in §3 (steps 3–5, no WSL). ClickHouse and Redpanda both publish arm64 builds.
4. Run services under **systemd** (restart on failure) or `pm2 start ecosystem.config.cjs` for the Node apps. One unit per process, `After=` ordered: postgres, valkey, redpanda, clickhouse → edge, worker, scheduler → web.
5. **TLS + hostname for free**: point a free DuckDNS/`nip.io` name at the VM and put **Caddy** in front (automatic Let's Encrypt):
   ```
   app.example.duckdns.org { reverse_proxy localhost:3000 }
   ingest.example.duckdns.org { reverse_proxy localhost:3001 }
   ```
6. Bind databases and Kafka to `127.0.0.1` only. Only Caddy faces the internet. No data store should ever have a public port.
7. Nightly backup: `pg_dump` plus ClickHouse `BACKUP` to a local dir, copied off-box (a free object store bucket works). Test data is disposable, but this protects your configuration.

**Public URL without a server (Path A):** `cloudflared tunnel --url http://localhost:3000` gives a free temporary HTTPS URL; run a second tunnel for port 3001 (the ingestion URL the tracker posts to).

## 7. Environment (production mode on a public test box)

The app refuses unsafe production config on purpose. Minimum set:

```
NODE_ENV=production
APP_URL=https://app.example.duckdns.org
NEXTAUTH_SECRET=<openssl rand -hex 32>
SITE_SIGNING_SECRET_KEY=<openssl rand -hex 32>        # >= 32 chars; also read by the Go edge

DATABASE_URL=postgres://trackme:***@127.0.0.1:5432/trackme
CLICKHOUSE_URL=http://127.0.0.1:8123
CLICKHOUSE_DASHBOARD_USER=dashboard_ro                  # read-only user: create it, see below
KAFKA_BROKERS=127.0.0.1:9092
KAFKA_PARTITIONS=2
KAFKA_REPLICATION=1
REDIS_URL=redis://127.0.0.1:6379                        # and every REDIS_*_URL role your .env.example lists

TRUSTED_PROXY_HOPS=1                                    # Caddy is one hop (edge + web)
METRICS_PORT=9100                                       # edge metrics on a private port (or ALLOW_PUBLIC_METRICS=1)

# email: the console fallback now THROWS in production. Use a free tier:
RESEND_API_KEY=...                                      # or the SMTP_* variables (Resend / Brevo / Gmail app password)
```

- Read-only ClickHouse user:
  ```sql
  CREATE USER dashboard_ro IDENTIFIED BY '***' SETTINGS readonly = 1;
  GRANT SELECT ON trackme.* TO dashboard_ro;
  ```
- **Private-only shortcut:** with `NODE_ENV=development` the OTP is returned as `devCode` and no email provider is needed. Never do this on a public host.
- Variable names above follow `.env.example` / `packages/config`; if one differs, `.env.example` wins.

## 8. Start order and health checks

| # | Start | Check |
|---|---|---|
| 1 | Postgres, Valkey | `pg_isready`, `redis-cli ping` |
| 2 | ClickHouse | `curl localhost:8123/ping` → `Ok.` |
| 3 | Redpanda | `rpk cluster health` |
| 4 | migrations + topics (§4) | `SELECT name FROM schema_migrations` in ClickHouse |
| 5 | edge | `curl :3001/healthz` |
| 6 | event-worker, scheduled-worker | `curl :9464/metrics`, `curl :9465/metrics` |
| 7 | web | open `:3000` |

End-to-end proof: send one event, then `SELECT count() FROM events_v2` in ClickHouse and see it in the dashboard within a few seconds. If events pile up in Kafka but not ClickHouse, look at the worker log and `growth_events_dlq`.

## 9. Gotchas

- **Edge must be deployed before the tracker/proxy** (timestamp-signed ingestion): clock skew over a few minutes makes events fail with 401. Keep NTP on (`timedatectl`; WSL clocks drift after sleep: `sudo hwclock -s`).
- Run migrations in order, including Postgres `0004`/`0005` and ClickHouse `011`–`013`; don't skip.
- Redis eviction or a restart without persistence resets quota counters: acceptable for tests, not for billing.
- Redpanda dev mode and the WAL are not fsynced: power loss can drop the last seconds of events. Fine for tests.
- Free cloud Postgres (Neon) sleeps when idle: first request after idle is slow, and writes stop at the 1 GB cap.
- The Go edge WAL, ClickHouse and Redpanda all need disk: check `df -h`; set small `WAL` byte caps and Kafka retention so a test never fills the volume.
- Do not expose ClickHouse (8123/9000), Redpanda (9092), Postgres or Valkey to the internet. The repo's own compose file binds them to `127.0.0.1` for the same reason.

## 10. Quick decision

- Just want to see it work today: **Path A**, §3 → §4 → §8.
- Need others to try it: **Path B**, plus Caddy and a free dynamic DNS name.
- Don't want to run a broker or ClickHouse at all: not possible for free long-term; use the ClickHouse Cloud trial plus Redpanda on a VM, or accept Path B.
