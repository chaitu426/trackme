# Ingestion at Scale: Production Risk Review and Target Architecture

Status: proposal, 2026-11-08. Branch `fet/tracer-doc-update`, read from the working copy
(including the uncommitted async-queue and fused-gate work).

Builds on, and where noted corrects: [`docs/architecture/ARCHITECTURE_OPTIMIZATION_PLAN.md`](ARCHITECTURE_OPTIMIZATION_PLAN.md),
[`docs/operations/INGESTION_FAILURE_ANALYSIS.md`](../operations/INGESTION_FAILURE_ANALYSIS.md) and
[`docs/operations/INGESTION_FIX_PLAN.md`](../operations/INGESTION_FIX_PLAN.md). Those documents fixed the load-test incident. This one asks
the next question: **what breaks when 1,000+ sites each send thousands of requests, and what do the
companies that run this at planetary scale do about it?**

How to read the evidence labels used below:

| Label | Meaning |
|---|---|
| **[code]** | Read directly in this repository; file and line given. |
| **[est]** | My arithmetic from stated assumptions. Needs the load test in section 9 to confirm. |
| **[src]** | Taken from a source I opened or searched this session; linked in section 11. |
| **[mem]** | From my background knowledge of the paper or system; not re-verified this session. Check before quoting externally. |

---

## 1. Summary

The pipeline's shape (tracker, edge, Kafka, worker, ClickHouse) is the right shape; PostHog and Cloudflare
run the same one [src]. The risks are in **where the work happens**, not in the box diagram:

1. **Shared systems are touched per request or per event, not per lease or per block.** Redis gets about two
   scripts per request and one key per event; ClickHouse gets many small inserts into 9 tables.
2. **Overload turns into data loss.** 429 on a collection endpoint, an in-memory queue sized in events (about
   0.2 s at peak), 503 on any Redis hiccup, and a permanent drop path that leaves dedupe claims behind.
3. **Exactly-once rows is weaker than documented.** The ClickHouse dedupe token only protects the last 1,000
   blocks and only if a replayed batch has identical membership.
4. **No tenant isolation.** One large or abusive site shares every queue, partition and insert with everyone.

The target design applies seven techniques, each tied to a system that already solved the same problem:

| # | Technique | Borrowed from | Replaces |
|---|---|---|---|
| T1 | Capacity **leases** with a safe-capacity fallback | Google Doorman [src] | Redis script per request, fail-closed 503 |
| T2 | **Sliding-window counter** and fingerprint sets, local per edge | Cloudflare rate limiting [src] | Per-IP Redis counters, per-event Redis keys |
| T3 | **Adaptive concurrency limit** plus **criticality shedding with sample weights** | Netflix concurrency-limits [src], Google SRE overload handling [mem], Cloudflare adaptive sampling [src] | 429 when the queue is full |
| T4 | **Durable intake**: sharded ring buffers with disk spill | Vector / Fluent Bit disk buffers [mem] | One 10k-event in-memory queue |
| T5 | **Offset-addressed blocks** with an intent record, plus **sealing** of closed days | ClickHouse Kafka Connect exactly-once [src], Photon [src], Mesa [src] | Batch-hash dedupe token |
| T6 | **Shuffle sharding** of sites over partitions | AWS Builders' Library [src] | Every site on every partition |
| T7 | **Visitor-consistent sampling** (`SAMPLE BY`) and **XFetch** cache refresh | Cloudflare ABR [src], Vattani et al. [src] | Raw scans for heavy queries, per-process stampede guard |

Everything else (HLL realtime, SDK backpressure hints, stale-if-error, tiered retention) is smaller and listed in
section 6.

---

## 2. Assumptions and capacity model

All numbers here are **[est]**. Replace them with measured values after section 9.

| Quantity | Assumption | Derived |
|---|---|---|
| Peak requests | 10,000 req/s | |
| Events per request | 3 average (SDK allows up to 50, `transport.ts:27`) | 30,000 events/s peak |
| Enriched event, JSON | about 700 B | about 21 MB/s raw into Kafka; about 3-4 MB/s after zstd |
| Sites | 1,000 active, Zipf-distributed | top 10 sites likely carry 30-50% of traffic |
| Edge instances | 20 | 500 req/s each |
| Sustained vs peak | sustained is roughly 35% of peak | about 1B events/day sustained |

Costs that scale linearly and bite first, per **1,000 events/s sustained**:

| Resource | Current design | Cost |
|---|---|---|
| Redis dedupe keys (`evt:<id>`, 25 h TTL, `dedupe/claims.go:15`) | one key per event | 86.4M keys/day; about 8-10 GB at roughly 100 B/key **[est]** |
| Redis scripts | `Admit` + async `Confirm` per request (`server.go:636`) | about 2 scripts per request, O(events) work each |
| ClickHouse parts | 3 inserts per batch, 9 target tables on the v2 path | see section 4, F6 |

---

## 3. Current design, in one picture

```
 tracker (browser)                     edge (Go, N instances)                      async plane
 ───────────────                      ────────────────────────                    ──────────────────────────
 batch <=50 events   POST /v1/batch   validate -> site resolve (in-proc cache)    Kafka growth_events
 retry queue 100 ev  ───────────────► -> enrich -> gate.Admit (Redis EVAL) ─────► (key = site:session)
 5 attempts, 5s..5m                   -> AsyncPublisher (10k-event RAM queue)         │
                                      -> 202                                          ▼
                                      confirm claims (async Redis EVAL)       event-worker (Node, kafkajs)
                                                                              zod per event -> 3 inserts ─► ClickHouse
 Redis: IP/site counters, quota,                                              + realtime Redis SETs           events_raw
 evt:<id> claims (25h), realtime                                                                              events_ingest(Null)
 Postgres: sites, workspaces                                                                                  └MV► events_v2 ─► 7 MVs
```

Already solved by earlier work and **not repeated here**: fused admission script, async producer with bounded queue,
fail-closed admission, shadow v2 writes, periodic lag sampling, e2e latency histogram, read-only dashboard user,
result cache with single-flight and stale-while-revalidate, per-site SSE hub, nightly reconciliation job.

---

## 4. Findings register

Severity: **S1** will cause an outage or data loss at the target load; **S2** degrades correctness or cost;
**S3** hygiene. "Confidence" is how sure I am it bites in production.

### F1. Redis is on the per-request path and cannot be sharded (S1, confidence high)
- `gate.go:89-143` takes keys `[ip, site, quota, evt:id...]` in one script. In Redis Cluster every key in a
  script must hash to one slot, so this script cannot run on a cluster **[src: Redis semantics, known]**.
  Capacity is therefore one primary's command rate.
- `server.go:636` adds a second script (`Confirm`, one `EXISTS`+`EXPIRE` per event) per request. The "one round
  trip" claim in `gate.go:1` is true for latency only; Redis load is two O(events) scripts per request.
- The site and workspace-quota keys are hot keys: every edge instance increments the same key for a large site.

### F2. Per-event dedupe keys do not scale in memory (S1, confidence high, size is **[est]**)
`dedupe/claims.go:15` keeps confirmed IDs for 25 h. See section 2: about 8-10 GB per 1,000 events/s sustained,
roughly 250-300 GB at 30,000 events/s. Eviction or `maxmemory` pressure would then silently drop dedupe
protection or the rate-limit and quota counters sharing that instance (see F12).

### F3. The intake queue is too short and one `Close` away from loss (S1, confidence high)
- `async.go:51` bounds the queue at 10,000 events. At 30,000 events/s that is about **330 ms** of buffer. Any
  broker leader election or GC pause longer than that returns 429 (`server.go:627`).
- One flusher goroutine (`async.go:162`) and one mutex (`async.go:119`, `async.go:208`) serialize all producers and
  the drain. `take` copies the remaining queue under the lock (`async.go:224`).
- After 5 failed attempts a batch is counted dropped (`async.go:265-268`), but its dedupe claims stay for 25 h. The
  SDK's retry is then answered as a duplicate. The loss is **permanent and silent** except for one counter.
- 202 means "in RAM". A crash or OOM loses up to the queue contents. The shutdown drain is bounded at 10 s
  (`async.go:191`).
- Marshalling happens on the flusher goroutine (`kafka.go:131-154`), single-threaded.

### F4. Rate limits drop legitimate traffic (S1/S2, confidence high)
- `INGESTION_RATE_LIMIT_MAX=1000` per IP per minute (`config.go:90`), counted in requests. Corporate NAT, schools,
  mobile carrier-grade NAT and VPN exits put thousands of real visitors behind one IP. Their events get 429.
- `SITE_RATE_LIMIT_MAX=10000` requests/min (`config.go:92`) is about 167 requests/s. A site doing 1,000 requests/s
  is throttled to 17% of its traffic, and the SDK's retries amplify the load.
- Fixed windows (`ratelimit.WindowKey`) allow up to 2x the limit across a boundary.

### F5. Fail-closed turns a Redis blip into a global outage (S1, confidence medium)
`admit.go:79-83` returns 503 for every site on any Redis error. `docs/operations/INGESTION_FIX_PLAN.md` chose this deliberately
(and `docs/architecture/ARCHITECTURE_REVIEW.md` P2-1 had chosen the opposite earlier), so the policy has flipped once. Both ends are
wrong for an ingestion path: fail-open loses enforcement; fail-closed makes rate-limit infrastructure a
single point of failure for revenue-bearing data. The Doorman answer (section 5, C1) is a third option.

### F6. ClickHouse part creation will probably outrun merges (S1, confidence medium, rate is **[est]**)
- Worker defaults favour freshness: `WORKER_FETCH_MIN_BYTES=2048`, `WORKER_FETCH_MAX_WAIT_MS=100`
  (`config/src/index.ts:101-102`). The plan's own WS7 target is about 1 MB / 500 ms and about one insert per second.
- In `shadow` mode (the default, `config/src/index.ts:93`) each batch does up to **three inserts**: `events_raw`,
  `web_vitals` and `events_ingest` (`clickhouse.ts:~140-215`).
- The `events_ingest` insert is synchronous and carries no `async_insert` (`clickhouse.ts:116-118` applies only
  to the legacy tables), and its MV chain writes into `events_v2` plus 7 aggregate tables.
  `mv_dim_daily` alone emits 9 rows per event (`009_aggregates.sql`, `ARRAY JOIN`).
- Rough count: 4 concurrent partitions x about 10 fetches/s x (3 inserts, plus 8 MV targets on one of them)
  is several hundred new parts per second across tables **[est]**. Monthly partitions
  (`PARTITION BY toYYYYMM`) put them all in one partition. When a partition hits
  `parts_to_throw_insert` ClickHouse rejects inserts, the worker throws, Kafka redelivers, lag grows. ClickHouse's
  own guidance is roughly one insert per second with 10k-100k rows [src].

### F7. "Exactly-once rows" in `events_v2` is bounded by a 1,000-block window and batch identity (S2, confidence medium)
- `v2InsertSettings` (`clickhouse.ts:66`) hashes the batch's event IDs into `insert_deduplication_token`. That
  deduplicates only if a **redelivered batch has exactly the same membership**. After a rebalance or a different
  fetch size it will not.
- `events_v2` is `non_replicated_deduplication_window = 1000` (`008_events_v2.sql:64`): the last **1,000 blocks**.
  At 40 inserts/s that is 25 seconds. A worker that restarts after a minute replays outside the window.
- `site_daily_agg` and the other aggregates use `SimpleAggregateFunction(sum)`. A duplicate pageview that gets
  through is permanent until a rebuild. The plan's principle 2 ("idempotency lives at the edge, not in storage")
  cannot cover this, because edge dedupe is a 25-hour best effort that fails open (F5's older path) and is blind to
  cross-instance retries when a claim expired.
- I could not confirm from documentation alone whether a chained MV target honours the token when the source
  table is `Null`-engine; write an integration test for it (section 9) before trusting the guarantee.

### F8. The worker does CPU-heavy work on one event loop (S2, confidence medium, throughput is **[est]**)
- Per event: `JSON.parse` (`worker.ts:88`), zod `safeParse` (`contract.ts`), `toIngestRow`, `JSON.stringify` for
  ClickHouse, plus `JSON.stringify` of properties. All on one thread, `partitionsConsumedConcurrently=4`
  (`worker.ts:247`) only overlaps I/O.
- Realtime Redis writes are awaited inside the batch (`worker.ts:186`), and dead letters are sent one at a time
  (`worker.ts:209-212`). A slow Redis or DLQ extends every batch, even though neither is on the critical path for
  the data.
- Scale-out stops at the partition count; locally the topic has 2 partitions (the compose file sets
  `KAFKA_NUM_PARTITIONS=6` but auto-create is on, so the count depends on how the topic was first created).

### F9. Site resolver limits (S2, confidence medium)
- `resolver.go:66`: `staleMax = 5 min`. If Postgres is down for longer, **every site starts failing with 500**
  (`server.go:352`). Existing sites should survive a Postgres outage for hours.
- `resolver.go:67,328-336`: `cacheMax = 5000`, and on overflow half the map is evicted in random order. Fine for
  1,000 sites, a thundering-herd generator at 20,000.
- A single `sync.Mutex` guards the cache for every request. Cold deploy: every instance misses every site at
  once, bounded only by the Postgres pool.

### F10. Missed pub/sub invalidations during a Redis outage (S3)
`WatchInvalidations` (`resolver.go:366`) relies on Redis pub/sub, which does not replay. A revoked signing secret
published while the subscription is down is picked up only when the 60 s TTL expires. Acceptable, but it should be
a documented bound and a metric.

### F11. No HTTP-level overload control (S2, confidence medium)
`HTTPRequestsInFlight` is a gauge only (`server.go:164`). There is no limit on concurrent in-flight work, so
overload shows up as rising latency and then timeouts, which the SDK treats as `retry` and resends
(`transport.ts:52`). Retries during an outage multiply load by up to 5x.

### F12. One failure domain for everything stateful in Redis (S2)
Rate limits, quota, dedupe, realtime, sessions, locks and pub/sub can share one instance in a simple deployment
(`docs/architecture/ARCHITECTURE_REVIEW.md` P2-10 is still open). `config/src/index.ts` defines separate role URLs, which is the right
shape; production must actually split them and use `maxmemory-policy noeviction` on the counters.

### F13. Retention and cost (S2)
`events_v2` keeps raw events 24 months (`008_events_v2.sql`, `TTL ... INTERVAL 24 MONTH`) with
`ttl_only_drop_parts = 1`, while the site settings contain `retentionMonths`. Per-site retention
(`docs/architecture/ARCHITECTURE_REVIEW.md` P2-6) cannot be implemented with whole-part drops. Cloudflare stores aggregates long
and raw data briefly because "we just cannot afford yet to store non-aggregated data for that long" [src].

### F14. Read-side leftovers (S3)
`ANALYTICS_READ` defaults to `v1` (`config/src/index.ts:91`), so the aggregate tables are paid for on write but not
used on read. `FINAL` remains in `overview.ts:61,72,89`, `web-vitals.ts:31` and `backfill.ts`. Single-flight is
per process (`query-cache.ts`), so N web nodes can each rebuild a hot key at expiry.

### F15. Tracker retry behaviour amplifies outages (S2)
`MAX_ATTEMPTS=5`, `RETRY_BASE_MS=5000`, `RETRY_MAX_MS=300000` with +/-25% jitter (`transport.ts:34-39,404`). After
a 60-second edge outage, clients that failed are synchronised enough to hit again within the same few seconds.
The edge's `Retry-After: 1` (`server.go:733`) is constant and the SDK does not read it.

### F16. `ingest-proxy` is another hop that holds the signing secret (S3)
`services/ingest-proxy` forwards signed requests to the edge. It is correct to exist for customers who want
first-party collection, but it must scale and shed like the edge; it currently has its own 10 s upstream timeout
and no concurrency limit.

---

## 5. How large systems solve this, and what we take

### 5.1 Survey

| System | What they do | Source status | Take | Do not take |
|---|---|---|---|---|
| **Google Doorman** | Clients hold *leases* of capacity (default about 5 min, refreshed about every 5 s). The server runs an allocation algorithm over every client's demand. If the server is unreachable, leases expire and the resource falls back to a configured *safe capacity*. Hierarchical: leaf servers talk to parents. | [src] usenix.org SREcon16, GitHub design doc. Repo archived Nov 2024, "alpha quality". | The lease + safe-capacity model, the idea that clients *report demand* | The software itself (archived, needs etcd). Cooperative clients: ours are our own edges, so that is fine. |
| **Google Photon** | Joins click and query streams. Retries give at-least-once; a Paxos-backed `IdRegistry` gives at-most-once; together, exactly-once *eventually*. Stores only metadata, batches registry requests. Known failure: a registry write followed by a lost response can lose a joined event, so Photon depends on recovery. | [src] research.google, SIGMOD 2013, via secondary summaries | At-least-once transport plus a **small, batched, authoritative registry**, and recovery for the gap | A global Paxos registry. Our scale does not need it. |
| **Google Mesa** | Pre-aggregated, *versioned* deltas, with atomic visibility of whole updates, background compaction merging deltas. Updates are batched, not per-row. | [src] research.google | Aggregate updates as **atomic, versioned, batched** units; compaction as a first-class background process | Geo-replicated metadata via Paxos |
| **HyperLogLog++** | 64-bit hash, bias correction for small cardinalities, sparse representation, mergeable, single pass. | [src] research.google, EDBT 2013 | You already use `uniqCombined64`, which follows this family. Use **PFADD/PFCOUNT** for realtime. | |
| **Google SRE: overload and criticality** | Requests carry a criticality; under overload shed lowest first; clients throttle themselves based on rejection rate. | [mem] SRE book, "Handling Overload" and "Addressing Cascading Failures" | Criticality classes and client-side adaptive throttling | |
| **Cloudflare rate limiting** | *Sliding window counter*: estimate the current rate from the previous window's count weighted by elapsed fraction plus the current count. One `GET` and simple math. Edge servers stay mostly independent; counters are shared sparingly. Early memcached design needed a query per request, which they knew attacks would crush. | [src] blog.cloudflare.com "counting-things" (excerpts only; full post not read) | Sliding-window counter; **keep edges independent; share rarely** | |
| **Cloudflare analytics (ClickHouse + ABR)** | 6M req/s on ClickHouse (2018). Aggregates kept long, raw kept short. *Adaptive Bit Rate*: the same data stored at 100% / 10% / 1% (and lower) resolutions in separate tables; the query picks a resolution by cost. Upstream, the log receiver partitions by key and does *adaptive sampling* before the inserters; Kafka sits between. | [src] blog.cloudflare.com (2018 post, 2020 ABR post, 2024 pipeline post via excerpts) | Multi-resolution reads; adaptive sampling **upstream of storage**; short raw retention | Their custom inserters |
| **PostHog** | Rust capture service does only: validate key, anonymise IP, normalise, write to Kafka. ClickHouse *pulls* from Kafka. Plugin server enriches and writes a second topic. They report that Kafka decoupled streams from processing but each dependency adds operational burden. | [src] posthog.com docs and blog | Keep the capture path tiny; **separate consumer purposes** | Adopting Kafka-engine ingestion wholesale (see 5.3) |
| **Netflix concurrency-limits** | Replace fixed concurrency limits with limits that adapt from observed RTT (AIMD, Vegas, Gradient2). Gradient is the ratio of no-load RTT to current RTT; reject beyond the limit. | [src] netflixtechblog.medium.com "Performance under Load" | Gradient2-style limiter at the HTTP layer | |
| **AWS shuffle sharding** | Each tenant is assigned a small *random subset* of workers; a poisonous tenant can take out only the workers it maps to, and the chance that two tenants share all workers falls exponentially. | [src] aws.amazon.com/builders-library | Subset assignment of sites to partitions | Treating it as free: it only helps if clients retry within their shard. |
| **ClickHouse Kafka Connect sink** | Exactly-once built on *insert deduplication* plus a state machine in Keeper that records the intended batch **before** insert, so a replay re-sends the identical batch. | [src] clickhouse.com blog | The **intent record** idea (section C6) | Adopting the connector (it drops our validation, DLQ and realtime fan-out) |
| **XFetch** | Probabilistic early expiration: each reader may refresh early with probability growing as expiry nears, scaled by recompute cost. No locks. Proven optimal in the paper. | [src] VLDB 2015 (PDF not read) | Cross-node stampede protection with no coordination | |
| **WarpStream / Redpanda** | WarpStream is diskless on object storage: much cheaper, latency in the hundreds of ms. Redpanda keeps local disks and has better tail latency. Most figures come from a competitor's blog. | [src] weak (vendor-written) | Know the trade: our ingest path is async already, so +200-400 ms broker latency would not hurt users | A migration now. No evidence Kafka is our bottleneck. |

### 5.2 Principles for this system (revised)

1. **Touch each shared system per lease, per batch, or per block, never per request or per event.**
2. **Overload degrades quality (sampling, delay), never completeness of high-value events, and never silently.**
3. **Idempotency is layered**: edge best-effort (cheap), block-level exact (authoritative), day-level sealing
   (repairs). This revises principle 2 of the optimization plan, which put it all at the edge.
4. **A dependency outage changes capacity, not correctness.** Redis down means a lower safe rate; Kafka down means
   disk spill; Postgres down means serve stale; ClickHouse down means Kafka backlog.
5. **Isolate tenants before optimizing them.** Blast radius first, throughput second.
6. **Everything reversible by flag**, as in the plan's section 11.

### 5.3 Decisions deliberately *not* taken

| Option | Why not (now) | Revisit when |
|---|---|---|
| ClickHouse Kafka engine / Kafka Connect sink instead of our worker | Our worker owns validation, DLQ, realtime fan-out. But **splitting consumer groups** (C6) captures most of the benefit. | Worker becomes the cost centre after C6. |
| Replace Kafka with WarpStream/Redpanda | No measured broker bottleneck. Managed Kafka at the same region is fine. | Broker cost or cross-AZ traffic dominates the bill. |
| Global Paxos-style event-ID registry (Photon) | Section C2 gets within the 0.01% duplicate target with far less. | Duplicates exceed target after C5 + sealing. |
| Protobuf on the Kafka topic for space | Plan section 6.3 deferred it; zstd on repeated JSON keys already captures the space win. | **Reopen for CPU**, not space: see C4 and F8. |
| Cell-based multi-region now | Operational cost high; one region with AZ spread meets stated load. | Contractual latency or residency requirements. |

---

## 6. Target architecture

```
                         ┌────────────── control plane (Postgres + Redis) ───────────────┐
                         │ site settings, plans, per-site budgets, partition map (site→k) │
                         └───────┬───────────────────────────────┬───────────────────────┘
                                 │ lease renew (1 pipelined call │ settings push (pub/sub +
                                 │ per edge per tick)            │ versioned poll)
 tracker ─ POST ─► L7 LB ──────► edge instance ───────────────────────────────────────────┐
 (batch_id,        (rendezvous   ├ adaptive concurrency limit (Gradient2)                  │
  sample hints)     on site key) ├ validate → resolve (RCU snapshot cache)                  │
                                 ├ local admission: lease token-bucket + sliding window      │
                                 ├ criticality shedding (weights, never silent)             │
                                 ├ sharded ring buffers (pre-encoded, zstd)                 │
                                 └ disk WAL spill when Kafka is slow ───────────────────────┤
                                                                                            ▼
                                        Kafka (RF3, min.isr 2, shuffle-sharded partitions per site tier)
                                           ├── consumer group A: ch-writer  ──► ClickHouse (blocks 50-100k rows,
                                           │      offset-addressed tokens, intent record)    events_ingest→events_v2→MVs)
                                           ├── consumer group B: realtime   ──► Redis HLL / counters
                                           └── DLQ topic + replay tool
                                        sealing job (hourly/daily): rebuild closed days from deduped events_v2
                                        → REPLACE PARTITION on aggregates
```

### C1. Edge admission by leases (fixes F1, F4, F5)

**Idea.** Redis stops being a per-request dependency. Each edge asks the control plane, about every 2 seconds
and in **one pipelined call for all sites it currently serves**, for a *rate grant* per site. It enforces the grant
with an in-process token bucket. If it cannot renew, the lease runs out and the edge drops to a *safe rate*.

**Allocation (per site, in Redis, one script per site inside the pipeline):**

```
inputs   G = site global budget (events/s, from plan; burst = 5 x G for 1 s)
         demand[e] = edge e's EWMA arrival rate, reported with each renewal, TTL = 2 ticks
         active edges A = { e : demand[e] fresh }
water-fill:   share = G / |A|
              give each edge min(demand[e] x 1.25, share); redistribute unused to edges still below demand
reply    grant[e] (events/s), lease_ttl = 10 s, safe_rate = 0.5 x G / E_total
edge     bucket.rate = grant; bucket.burst = grant x 1 s
         if now > lease_expiry: bucket.rate = safe_rate     // never 503, never unlimited
```

This is Doorman's fair-share allocation reduced to the part that matters here [src].

**Monthly quota** is a counter, not a rate, so it uses *geometric chunk leasing*:

```
chunk c = clamp( remaining / (4 x E_active), 1, 10_000 )
edge withdraws c units from Redis when its local balance < c/4, spends locally per billable event
unspent units are refunded on graceful drain; leaked on crash (conservative: customer is not over-served)
worst-case overshoot at month end <= E x c, and c shrinks toward 1 as remaining shrinks
```

Because `c` shrinks as the remainder shrinks, a small plan (1M events/month) is enforced almost exactly while a
large plan pays almost no Redis cost. The existing `usage-metering` job already reconciles against ClickHouse
truth, so a leaked chunk self-corrects.

**Per-IP and per-session limits** become local sliding-window counters (Cloudflare form) [src]:

```
est = prev x (1 - elapsed/W) + curr        // 2 integers per key; no Redis
```

Key design, to stop punishing NAT:

| Limit | Key | Default | Purpose |
|---|---|---|---|
| Per session | `site + session_id` | 300 events/min | A legitimate session never exceeds this. Cheap, precise. |
| Per IP ceiling | `site + IP/24 (or /56 for IPv6)` | 30,000 events/min | Abuse containment only; high enough for CGNAT. |
| Per site | lease (above) | plan | Fairness across tenants. |

Per-IP counters are per edge and approximate. With rendezvous routing on the site key (C2) one site's traffic
concentrates on few edges, so approximation error is small. Real abuse (L3/L4) belongs to the CDN/WAF in front.

**Failure behaviour.** Redis down: edges run on current leases, then safe rate; metric
`edge_lease_state{state="valid|safe"}` and an alert on `safe` for more than 60 s. No 503 on the happy path.

**Cost.** Redis load drops from about 2 scripts per request (about 20,000/s at peak) to about
`E_edges / tick` pipelined calls per second: **20 edges / 2 s = 10 calls/s**, each carrying up to a few hundred
site leases. **[est]**

### C2. Dedupe in three layers (fixes F2, F7 first half)

| Layer | Mechanism | Window | Memory |
|---|---|---|---|
| L1 edge | Rotating **fingerprint sets**: open-addressed `uint64` sets of `hash64(event_id)`, two generations of 5 minutes | 5-10 min | 30k ev/s x 600 s x 8 B about **144 MB** per edge-equivalent. Exact enough: false-positive chance per lookup is about n / 2^64, about 1e-12. A Bloom filter at 1% would drop real events and is not acceptable. |
| L1b routing | Load balancer **rendezvous-hashes on the site key**, so a site's retries land on the same edge. Optimisation, not correctness. | | |
| L2 block | Offset-addressed tokens in the worker (C6) | the ClickHouse window, sized in C6 | |
| L3 day | Sealing job dedupes by `event_id` for closed days | permanent | |

The 25-hour Redis claim set is deleted. The SDK retry queue can resend an event up to 23 h later
(`transport.ts` `MAX_EVENT_AGE_MS`), but those are events that were never acknowledged; a duplicate arises only
when the first attempt was stored *and* the response was lost *and* the retry comes late, which L3 repairs.
The SDK also sends a `batch_id` so the edge can short-circuit a whole batch with one fingerprint instead of 50.

### C3. Durable intake (fixes F3)

- **Sharded ring buffers**, one per CPU core (or per Kafka writer), holding **pre-encoded, length-prefixed
  bytes**. Encoding happens on the request goroutine (parallel), not on the flusher.
- **Sized in seconds, not events.** Capacity target is 10 seconds of peak: about 300,000 events x about 200 B
  compressed = about 60 MB of RAM. **[est]**
- **Disk spill (WAL).** When a ring passes 50% or Kafka writes exceed their deadline, the flusher switches to appending
  zstd segments to a local directory (fsync once per group commit, about 10 ms). A replay goroutine drains
  segments oldest-first when Kafka recovers. Disk bound: 10 GB per edge is hours of outage at the per-edge share
  of 3-4 MB/s **[est]**. The WAL is the line between "202 means queued in RAM" and "202 means will survive a
  process crash"; make the WAL mandatory in production and RAM-only an explicit dev flag.
- **Permanent failure is never silent**: after retries a segment moves to `dead/` with a metric and a runbook
  entry; and the dedupe fingerprint is removed so a client retry is accepted.
- **Back-pressure signal, not 429.** When the WAL is above 80%, the edge starts returning `503` with
  `Retry-After` jittered **per request** and sets `X-GI-Backoff` (C5/C9) so SDKs slow down. 429 is reserved for a
  site that exceeded its own lease.

### C4. Overload control: adaptive concurrency plus criticality shedding (fixes F11, F15)

**Adaptive concurrency limit (Gradient2 family, Netflix [src]).** Wrap the mux in a limiter that tracks
`rtt_noload` (long-window minimum) and `rtt_now` (short-window smoothed). Each interval:

```
gradient = clamp( (rtt_noload x tolerance) / rtt_now, 0.5, 1.0 )     // tolerance ~ 1.5-2
limit_new = limit x gradient + queue_headroom                         // smoothed with alpha ~ 0.2
if inflight >= limit: reject immediately with 503 + Retry-After       // before reading the body
```

Rejection is cheap (no JSON parse, no Redis). Latency stays flat instead of growing until the 10 s server write
timeout (`main.go`), and the SDK is told to back off instead of retrying into the queue.

**Criticality classes with sample weights.** Under pressure shed in this order; every kept event carries a weight so
aggregates stay unbiased:

| Class | Types | Shed policy |
|---|---|---|
| C0 | conversions / `identify` / goals / custom events with a goal | never shed |
| C1 | `pageview` | never shed below WAL 80%; above that, sample at 1-in-2, weight 2, only for sites over their lease |
| C2 | `web_vital`, scroll, engagement pings | first to go: keep 1-in-N, weight N, N from queue pressure |

Weights are written as a `sample_weight UInt16 DEFAULT 1` column. Aggregates change from `count()` to
`sum(sample_weight)`; `uniq*` is unchanged because a retained visitor still hashes to one value. This is the
same family as Cloudflare's adaptive sampling [src] and Google's criticality-based shedding [mem], applied
*before* storage so ClickHouse never sees the overload. **Every shed decision is a counter by class and site tier**;
dashboards show shed ratio, and any non-zero C0/C1 shedding pages.

### C5. Kafka topology and tenant isolation (fixes F8 scale-out, noisy neighbour)

- **Partitions:** at least 24, RF 3, `min.insync.replicas=2`, `auto.create.topics.enable=false` (already the plan's
  decision in section 6.4; here the number is raised so shuffle sharding has room).
- **Shuffle sharding [src: AWS].** Each site maps to `k` partitions by rendezvous hash of `site_id`; within those,
  `partition = shard[hash(session) mod k]` so per-session ordering is preserved.
  - Tier by traffic: small sites `k=2`, medium `k=4`, large `k=8-12`, set from a control-plane table that the
    edge already receives with site settings. `k` is derived from measured per-site rate divided by the safe
    per-partition rate, reviewed daily.
  - Effect for `N=24, k=4`: a victim site shares on average `k²/N ≈ 0.67` of its 4 partitions with any given
    noisy site, instead of all of them **[est]**. Two sites collide on all four with probability `1/C(24,4)`
    = 1/10,626.
  - Cost: Kafka partition assignment is no longer a plain hash, so changes need the rendezvous function in both
    the edge and any tooling that reproduces it. It also needs the site tier table to be consistent across edges
    (stale tier for a few seconds is harmless: ordering is per session and session maps are cached).
  - **Adopt only when** the top site exceeds about 10% of traffic or after the first noisy-neighbour incident.
- **Server-driven client back-off.** Responses carry `X-GI-Backoff: <ms>`; the tracker's next flush interval is
  `max(own backoff, X-GI-Backoff)` with full jitter. This turns the 10,000 clients into a cooperative system,
  which is Doorman's "refresh interval" idea [src] applied to browsers.

### C6. Worker and ClickHouse: big blocks, exact blocks, repaired days (fixes F6, F7, F8)

**Split by purpose.** Two consumer groups on the same topic (broker fan-out cost is negligible):

| Group | Does | Must never |
|---|---|---|
| `ch-writer` | decode, minimal validation, build blocks, insert, commit | call Redis, wait on DLQ, or do anything not needed to make rows durable |
| `realtime` | HLL / counters in Redis (C8) | block the writer; it may lag or fail independently |
| DLQ | handled by an async producer with its own queue and an alert | |

**Validation.** The edge validates every field already (`validate.Event`), so zod per event in the worker is
a second implementation of the same contract. Replace it by: schema-version check + a compiled structural check
(ajv-compiled or generated) on a **sample of 1-5%** of messages for drift detection, and full validation only
for messages that arrive from a producer version the worker does not recognise.

**Block formation (target 50-100k rows, at most about 1 flush/s per pod).**

- One flusher per pod collects rows from all its assigned partitions, flushes on `rows >= 50k || bytes >= 32 MB
  || age >= 1 s`. Inserts/s per table = pods / 1 s, not partitions x fetches/s.
- Freshness is preserved separately: the `realtime` group serves "live" views within 1 s; dashboards over
  aggregates tolerate seconds of delay. The measurement behind the current 100 ms default
  (`config/src/index.ts:98-100`: 795 ms to 498 ms) justified freshness only for the live view.
- **Parts budget formula:** `parts/s per table = pods / flush_interval`; with 8 pods at 1 s, 8/s per table.
  Alert at active parts per partition above 200 (plan target < 300).
- Single insert path: `events_ingest` only, `async_insert=0`. Remove the `events_raw` and `web_vitals` inserts
  after v2 reconciliation, as the plan intends.

**Exactly-once blocks: the intent record (from ClickHouse's own connector design [src]).**

```
loop per partition-group:
  1. read rows for offsets [a, b)  (b chosen by the size/time rule above)
  2. WRITE intent {topic, partition, a, b, token} to a durable store    <- before touching ClickHouse
  3. INSERT ... SETTINGS insert_deduplication_token = H(topic, partition, a, b)
  4. commit Kafka offset b
  5. delete intent
on restart: if an intent exists for a partition, re-read EXACTLY [a, b), reuse the same token,
            then continue. The replay is identical, so deduplication cannot be defeated by batch boundaries.
```

- Intent store: a small ClickHouse `KeeperMap` table, or Postgres, or Redis with AOF. Pick one that is already
  operated; the write is tiny (one row per flush).
- The dedupe window must exceed the longest plausible crash-to-restart time at the new insert rate. Set
  `non_replicated_deduplication_window` (or, if the cluster is replicated, `replicated_deduplication_window`
  and `replicated_deduplication_window_seconds`) to at least `restart_budget x inserts/s`, for example
  10 minutes x 8/s = **4,800 blocks, set 20,000**. Which pair of settings applies depends on whether production
  uses Replicated engines; the migrations use plain `MergeTree`, so **confirm the production engine** (open
  decision D3).
- **Test it.** An integration test must: insert block, kill before commit, replay, and assert row counts in
  `events_v2` and in every MV target table are unchanged (F7's open question).

**Sealing (Photon's "exactly-once eventually" [src], Mesa's atomic batch units [src]).**

```
hourly: for closed hour h (older than lateness bound L = 30 min):
   build shadow table from events_v2 WHERE hour = h  LIMIT 1 BY event_id   (dedupe by id)
   recompute each aggregate for h from the shadow table
   ALTER TABLE <agg> REPLACE PARTITION ... FROM shadow           (atomic swap)
```

Use *day* partitions for aggregate tables (not `toYYYYMM`) to make `REPLACE PARTITION` cheap; keep monthly for
`events_v2` itself if merges prefer it. Cost is bounded because only closed windows are touched and the nightly
reconciliation job (`reconciliation.ts`) already measures drift and `DUPLICATE_RATE_LIMIT`. Real-time numbers
come from the MVs; closed periods become exact. The dashboard can show a "provisional" badge for the open window.

**MV fan-out audit.** `mv_dim_daily` (9x), `mv_filter_daily` (11-column key) and `mv_session_day` (one row per
session-day) dominate write amplification. Use `system.query_views_log` to measure rows and time per MV at the
target load; drop or defer dimensions nobody queries (for example `campaign_name`, `os`) to a lazy hourly job.

**Runtime.** Decide *after* profiling. Ladder: (a) remove zod + Redis + serial DLQ from the writer path, run
more pods, measure; (b) librdkafka-based client for Node (`@confluentinc/kafka-javascript` **[mem]**); (c) Go
consumer with a native-protocol ClickHouse client (franz-go + ch-go **[mem]**), which also lets the writer share
the `enrich` types with the edge. Stop at the first rung that meets the target; (c) is a rewrite of about 300 lines
plus the block formation.

### C7. ClickHouse schema (fixes F13, supports T7)

`events_v2` is not yet read in production, so schema changes are cheap now and expensive after cutover.

1. **Sampling key.** Add `SAMPLE BY intHash32(visitor_hash)` and put it last in the sorting key:
   `ORDER BY (site_id, toDate(timestamp), type, event_name, intHash32(visitor_hash), session_hash, timestamp)`.
   ClickHouse requires the sampling expression to be in the primary key and to evaluate to an unsigned integer
   [src: ClickHouse MergeTree docs]. `visitor_hash` is `UInt64`; verify the expression type in a test.
   Then funnels, journeys and path analysis for large sites run `SAMPLE 0.1` and stay coherent per visitor,
   which is the point: random row sampling breaks multi-step queries, visitor-consistent sampling does not.
2. **Multi-resolution reads (ABR).** Query layer picks `SAMPLE 1 / 0.1 / 0.01` from estimated rows scanned
   (rows in range from `site_daily_agg`), and returns `sampled: true, rate` so the UI can show the confidence
   note, like Cloudflare's per-query resolution choice [src]. Totals and uniques stay exact from the aggregates.
3. **`sample_weight`** column (C4) and `received_at` kept for e2e latency.
4. **Retention tiers.** Raw: 30 days on fast disk, then `TTL ... TO VOLUME 'cold'` (object storage), delete at the
   plan's retention. Aggregates: 24 months. Per-site retention needs `TTL ... WHERE` rules, which require dropping
   `ttl_only_drop_parts = 1`; or partition raw by `(retention_class, toYYYYMM)` so classes still drop whole parts.
   The second is cheaper to operate.
5. **Delete the legacy write path** and `events_raw` dedupe-by-sort-key (`event_id` last in `ORDER BY`) after the
   v2 cutover, as the plan already schedules.

### C8. Realtime with HyperLogLog (fixes F8 realtime cost)

Replace per-session `SET` + sorted set (`redis-realtime.ts`) with per-minute HLL buckets:

```
PFADD  rt:{site}:{minute}  visitor1 visitor2 ...        // one command per site per flush
EXPIRE rt:{site}:{minute}  600
active visitors (5 min) = PFCOUNT rt:{site}:{m-4} ... rt:{site}:{m}   // merge on read, 12 KB per bucket max
top pages = HINCRBY rt:{site}:{minute}:paths path n   + bounded size (Space-Saving if > 200 distinct)
```

Memory is constant per site (about 12 KB x 5 buckets), writes are one command per site per flush instead of one
per active session, and the structure is mergeable, which is exactly the HLL++ property [src]. The realtime
consumer group (C6) owns it, so a Redis hiccup cannot stall inserts. Keep the Pub/Sub nudge for the SSE hub.

### C9. Read path (fixes F14)

1. **XFetch** [src] in `query-cache.ts`: when serving a cached value, with probability
   `p = exp(-(ttl_left) / (beta x delta))` (delta = measured recompute time of this key) refresh in the
   background. No locks, works across nodes, replaces the per-process guard.
2. **Flip reads to v2** after shadow reconciliation (`ANALYTICS_READ=shadow`, then `v2`), remove the remaining
   `FINAL` (`overview.ts:61,72,89`, `web-vitals.ts:31`).
3. **Per-tenant query budgets** in ClickHouse: a settings profile or quota per workspace
   (`max_execution_time`, `max_rows_to_read`, `max_concurrent_queries_for_user` through a per-tenant role). The
   read-only dashboard user exists (`clickhouse-dashboard-ro.sql`); extend it to per-tier profiles so one tenant's
   heavy segment query cannot starve others.
4. **Cache keys already normalise live ranges** (`normalizeRange`); add the sample rate to the key.

### C10. SDK and tracker (fixes F15)

- Read `Retry-After` and `X-GI-Backoff`; use *full jitter* (`sleep = random(0, min(cap, base x 3^n))`) instead of
  +/-25%.
- Send `batch_id` (96-bit random) per request.
- Keep batching up to 50 events and 30 KB. Add a **time-to-live on retries per class**: do not retry C2 events
  (web vitals) more than twice; they are the cheapest to lose.
- `sendBeacon` on page hide already exists; keep it.

### C11. Control-plane hardening (fixes F9, F10, F12, F16)

- Resolver: **stale-if-error** (RFC 5861 semantics [mem]) up to 6 hours for existing sites when Postgres fails;
  replace the global mutex with an atomically swapped immutable snapshot (RCU) updated by a single refresher; an
  LRU instead of random eviction with `cacheMax` raised to 100,000; **prewarm** at startup from a bulk query of
  hot sites. Add `site_cache_age_seconds` and `site_invalidation_lag` metrics.
- Settings changes carry a monotonically increasing `settings_version`; edges poll `GET /sites/versions` every
  30 s as a backstop for lost pub/sub messages.
- Redis: split by role in production, `noeviction` on counters/leases, `allkeys-lru` only on pure caches. Keep a
  replica for failover; with leases the primary is no longer in the request path, so a failover is a non-event.
- `ingest-proxy`: add the same concurrency limiter and shared metrics; document that it holds a signing secret and
  must not be exposed beyond its CORS allow-list (the code already requires `ALLOWED_ORIGINS`).

---

## 7. Failure-mode matrix (target behaviour)

| Dependency fails | Today | Target | Visible to customers |
|---|---|---|---|
| Redis (leases, quota) | 503 for all sites (fail-closed) or no enforcement (fail-open) | Run on current leases, then safe rate; quota continues on local chunk then shrinks | None for minutes; rate caps tighten after lease expiry |
| Postgres | Sites 500 after 5 min | Serve stale up to 6 h | None; settings changes delayed |
| Kafka | 429 after about 0.3 s of buffer | WAL spill; replay on recovery | None; data delayed |
| ClickHouse | Kafka backlog; lag alert | Same; Kafka retention must cover the outage (set 72 h) | Dashboards stale, nothing lost |
| Worker pod dies | Redelivery; dupes outside dedupe window | Intent record replays identical block | None |
| Edge instance dies | Up to 10k events lost | WAL replay on restart; routing shifts site to next rendezvous edge | None |
| Noisy site | Slows every partition | Confined to its `k` partitions; own lease; shed by class | Only that site is sampled |
| Retry storm after outage | Synchronised retries at 5 s base | Full jitter + `X-GI-Backoff` + concurrency limiter | Slightly delayed data |
| Lost invalidation message | Up to 60 s stale (and longer if Redis down) | Versioned poll every 30 s | Bounded, measured |

---

## 8. Rollout

Each phase is behind a flag and has an exit criterion. Effort: S = days, M = 1-2 weeks, L = 3+ weeks.

| Phase | Work | Effort | Exit criterion |
|---|---|---|---|
| **0 Measure** | Instrument: per-stage latency, `system.parts` per table, `query_views_log` per MV, Redis `COMMANDSTATS`, queue/WAL depth. Run section 9 baseline. | S | Baseline numbers replace every **[est]** in this doc. |
| **1 Worker blocks** (C6 block formation, split groups, intent record, dedupe-window sizing) and **schema** (C7 `SAMPLE BY`, `sample_weight`) | Do before v2 cutover; the table is cheap to rebuild now. | M-L | Active parts per partition < 200 at target load; replay-after-kill test shows zero duplicate rows in `events_v2` and every MV target. |
| **2 Edge intake** (C3 rings + WAL, C4 concurrency limiter) | | M | Kafka stall of 60 s produces zero 429s and zero data loss; WAL drains in under 5 min after recovery. |
| **3 Leases and local dedupe** (C1, C2, C11 resolver) | | L | Redis `COMMANDSTATS` at target load < 100 calls/s; Redis kill test: no 5xx, rates tighten to safe rate; per-event Redis keys gone. |
| **4 Shedding, weights, SDK hints** (C4 classes, C10) | Needs aggregate queries to use `sum(sample_weight)`. | M | Synthetic overload sheds C2 only; totals within 1% of ground truth. |
| **5 Sealing, read path** (C6 sealing, C9, C7 ABR) | | L | Duplicate rate <= 0.01% after sealing; dashboards p95 targets from the plan's section 0 met; `FINAL` gone. |
| **6 Isolation** (C5 shuffle sharding) | Only if the trigger in C5 is met. | M | Noisy-site injection moves other sites' p99 e2e by < 10%. |

Reverse order of risk: 0, 1, 2 are largely independent and can run in parallel; 3 depends on 0; 4 depends on 1
(the `sample_weight` column); 5 depends on 1; 6 is optional.

### Observability to add (SLIs)

| SLI | Definition | Alert |
|---|---|---|
| Acceptance | 2xx / (2xx + 5xx + 429) per site tier | below 99.9% for 5 min |
| Completeness | acknowledged events versus rows in `events_v2` (+ declared shed) | gap above 0.1% per hour |
| Freshness | e2e p95 from `received_at` to insert | above 10 s (writer), above 2 s (realtime) |
| Duplicates | `count() - uniqExact(event_id)` over the last closed hour | above 0.01% |
| Shed ratio | shed events by class and site tier | any C0/C1 shed |
| Lease health | edges in `safe` state; lease utilisation | any for 60 s |
| WAL | depth and oldest-segment age | above 50% or 10 min |
| Parts | active parts per partition per table | above 200 |
| MV cost | rows written and ms per MV per insert | regression versus baseline |

---

## 9. Test plan

1. **Load shape.** 1,000 sites with Zipf popularity (exponent about 1.1), 10,000 req/s, 1-50 events per request
   mix, 5% retries, bursts of 3x for 10 s. `scripts/simulate-traffic.ts` is the
   starting point; add the Zipf distribution and a deterministic event-ID ledger so completeness is checkable.
2. **Invariant checks after every run:** acked = stored + declared shed (by class); duplicates <= 0.01%; no
   `DROPPED` outcome without a matching retry; parts per partition stay under the alert threshold.
3. **Chaos matrix** (each for 60-120 s under load): kill Redis; add 500 ms latency to Redis; stall Kafka leader;
   `kill -9` one edge; `kill -9` one worker pod mid-insert; ClickHouse insert latency x10; Postgres down for 10 min.
4. **Replay test** (F7): insert, kill before commit, restart, assert identical row counts in `events_v2` and
   all aggregate tables. Run once with a restart under the dedupe window, once over it.
5. **Lease accounting test:** sum of grants never exceeds `G` over any 1 s window; quota overshoot stays within
   `E x c`.
6. **Noisy neighbour:** one site at 20x its lease; check victims' p99 and e2e.
7. **Property tests** for `sample_weight`: sampled aggregates equal full aggregates within the stated error.

---

## 10. Open decisions and risks

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Edge durability level (RAM only vs WAL) | WAL mandatory in production. |
| D2 | Which store holds the worker intent record | Whatever is already operated and has AOF or equivalent durability (Postgres is the least surprising). |
| D3 | ClickHouse engine in production (plain `MergeTree` vs `Replicated*`) | Replicated for HA; then use `replicated_deduplication_window[_seconds]`. Must be confirmed; changes C6 settings. |
| D4 | Sampling policy visible to customers | Never sample C0/C1 except under a lease breach; always disclose `sampled` in the API. |
| D5 | Quota semantics under leases (count at lease time vs at store time) | Count at lease time, reconcile from ClickHouse (existing job). |
| D6 | Adopt shuffle sharding | Defer until the C5 trigger. |
| D7 | Worker runtime | Decide after Phase 0 profile. |

Risks:
- **Lease allocation bugs create silent over/under-limiting.** Mitigate with the accounting test and a
  shadow mode where leases run alongside the Redis gate and the two decisions are compared for a week.
- **WAL adds a stateful component to a stateless edge.** Needs disk sizing, cleanup and a startup replay that cannot
  block readiness. Keep the WAL format trivial (length-prefixed zstd segments).
- **Sampling changes semantics of counts.** Needs the `sample_weight` columns in every aggregate before any
  shedding is enabled, or counts will under-report during overload.
- **Rendezvous routing at the load balancer** depends on the LB. If it cannot hash on the site key (it is in
  the JSON body), route on a header or path segment the tracker sets (`X-GI-Site`).
- **Numbers marked [est]** may be off by a factor of a few. The design is chosen so each component's cost is
  bounded by a formula, not by a guess, but the instance counts will move.

---

## 11. References and verification status

Opened or searched this session (summaries only unless noted):
- Google, [Photon: Fault-tolerant and Scalable Joining of Continuous Data Streams](https://research.google/pubs/photon-fault-tolerant-and-scalable-joining-of-continuous-data-streams/) (SIGMOD 2013). Read via secondary summaries; the full paper was not opened.
- Google SRE / Visser, [Doorman: Global Distributed Client Side Rate Limiting](https://usenix.org/conference/srecon16europe/program/presentation/visser); [design doc](https://github.com/codemartial/doorman/blob/master/doc/design.md). Project is archived and alpha.
- Cloudflare, [Counting things, a lot of different things](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/). Search excerpts only.
- Cloudflare, [Explaining Cloudflare's ABR Analytics](https://ghost.blog.cloudflare.com/explaining-cloudflares-abr-analytics/) and [HTTP Analytics for 6M requests per second using ClickHouse](https://blog.cloudflare.com/http-analytics-for-6m-requests-per-second-using-clickhouse/). Search excerpts only.
- PostHog, [How PostHog works](https://posthog.com/docs/how-posthog-works). Search excerpts.
- Netflix, [Performance under Load](https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581). Search excerpts.
- AWS, [Workload isolation using shuffle-sharding](https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding). Search excerpts.
- ClickHouse, [Official Kafka connector with exactly-once](https://clickhouse.com/blog/kafka-connect-connector-clickhouse-with-exactly-once); [bulk insert best practices](https://clickhouse.com/docs/cloud/bestpractices/bulk-inserts); [MergeTree `SAMPLE BY`](https://clickhouse.com/docs/sql-reference/statements/alter/sample-by).
- Vattani, Chierichetti, Lowenstein, [Optimal Probabilistic Cache Stampede Prevention](https://iris.uniroma1.it/handle/11573/877847) (PVLDB 8(8), 2015). PDF not read.
- Heule, Nunkesser, Hall, [HyperLogLog in Practice](https://research.google/pubs/hyperloglog-in-practice-algorithmic-engineering-of-a-state-of-the-art-cardinality-estimation-algorithm/) (EDBT 2013).
- Gupta et al., [Mesa](https://research.google/pubs/mesa-geo-replicated-near-real-time-scalable-data-warehousing/) (VLDB 2014).
- WarpStream/Redpanda comparisons: vendor-written (AutoMQ); treat as directional only.

Used from memory and not re-verified: Google SRE book chapters on overload and cascading failures; Redis Cluster
cross-slot script restriction; RFC 5861 stale-if-error; availability of `@confluentinc/kafka-javascript`,
franz-go and ch-go; Vector and Fluent Bit disk buffering behaviour. Confirm before citing externally.

Every **[est]** figure in sections 1-10 is arithmetic from the section 2 assumptions; none has been measured.

---

## 12. Implementation status (2026-11-08)

**Verification so far:** everything below compiles (`go build`, `go vet`, `gofmt`; `tsc --noEmit` for the worker,
tracker and web app). The Phase 0 helpers (quantile maths, Zipf sampler) were checked against hand-computed
values. **No test suite was run after Phase 0, no new unit tests were written, and nothing has run against a live
stack** (Docker was down). Treat Phases 1-6 as reviewed code, not validated behaviour.

| Phase | Built | Flag / how to enable | Not built, and why |
|---|---|---|---|
| **0 Measure** | `edge_stage_duration_seconds`, `worker_stage_seconds`; a planned probe script (Redis commands/keys per event, ClickHouse new parts/s, per-MV cost, stage quantiles) and a planned open-loop baseline load script (Poisson arrivals, Zipf sites, acked-vs-stored ledger) | both removed from the repo; rewrite when needed (edge needs `TRUSTED_PROXY_HOPS=1`) | Not run. This is the next action. |
| **1 Worker** | Exact-replay intent record (`intent.ts`) + commit after every batch; realtime split into its own consumer group; batched DLQ send; 1 MB / 500 ms fetch defaults; migration `011` (dedupe window 1,000 -> 20,000 blocks) | On by default. `WORKER_ROLES=writer,realtime`. **Apply `011` before deploying.** | Go consumer / validation sampling: decide from the Phase 0 profile (D7). `SAMPLE BY` and `sample_weight` columns: see Phase 5 note. |
| **2 Edge intake** | Disk WAL (spill instead of 429 or drop, replay oldest-first); adaptive concurrency limiter; per-response jittered `Retry-After` | `EDGE_WAL_DIR`, `EDGE_ADAPTIVE_LIMIT=true` | Sharded per-core ring buffers: contention is unproven; Phase 0 stage timings decide. Protobuf payload. |
| **3 Leases** | `internal/lease`: Doorman-style site rate leases (one pipelined Redis call per tick), chunked quota, local sliding-window IP limit, local fingerprint dedupe; stale-if-error (6 h) and error backoff in the site resolver | `EDGE_LEASES=true`, `SITE_EVENTS_PER_SEC`, `EDGE_FLEET_SIZE` | Per-session limit (the gate request carries no session ids); LB rendezvous routing (infrastructure); resolver RCU/LRU/prewarm; versioned settings poll. |
| **4 Shedding + hints** | Web-vital sampling above 0.5 queue/WAL pressure, `sampleWeight` in the payload, `X-GI-Backoff`, CORS exposure, tracker honours `X-GI-Backoff` / `Retry-After` | `EDGE_SHED=true` | Weights into aggregates: see deviation 1. `batch_id`. |
| **5 Read path** | XFetch early refresh in `query-cache.ts` (`early` cache result metric) | On by default | Sealing job, `SAMPLE BY` / ABR reads, daily-partitioned aggregates, `FINAL` removal, v2 read flip: see deviation 2. |
| **6 Isolation** | `Shuffle` partitioner (HRW subset of K partitions per site) | `KAFKA_SHUFFLE_K=4` | Per-tier K from a control-plane table (K is global for now). |
| Not in any phase table | | | HLL realtime (C8): needs the web reader changed in lockstep. |

### Where the implementation deliberately differs from sections 1-10

1. **Sampling is web-vitals only, and weights are not pushed into aggregates.** C4 proposed weights through every
   aggregate. That would change the `AggregateFunction` state type of `web_vitals_agg` (a destructive migration I
   cannot validate here). Uniform random sampling keeps quantiles and good/needs/poor shares unbiased, which is
   what the vitals views show; only absolute web-vital counts (and `site_daily_agg.events`, which includes them)
   under-report while shedding. `sampleWeight` rides in the Kafka payload so exact counts can be rebuilt later.
2. **Sealing and `SAMPLE BY` are not implemented because they need one table rebuild.** Aggregates are
   `PARTITION BY toYYYYMM(date)`, so `REPLACE PARTITION` would rewrite a whole month, not a day; `SAMPLE BY` cannot
   be added to the existing `events_v2` sort key. Both want a single "v3" migration (daily-partitioned aggregates,
   sampling key in `PRIMARY KEY`, `sample_weight`) that should be authored and rehearsed against a real ClickHouse.
   Writing about 300 lines of untested materialized-view DDL would risk silent aggregate corruption, so it was not done.
3. **Intent store is Redis** (the worker's existing state instance), not Postgres (D2). If Redis is unreachable the
   worker still makes progress and counts `worker_intent_errors_total`; exactness degrades, liveness does not.
4. **Quota fails soft inside the lease admitter**: if Redis cannot be reached when a chunk is needed, events are
   admitted uncharged and `edge_redis_errors_total{op="quota"}` increments; the 15-minute metering job reconciles
   from ClickHouse. This is the "dependency outage changes capacity, not correctness" principle applied to billing.
5. **Site rate limit units change with `EDGE_LEASES`**: from requests per minute (`SITE_RATE_LIMIT_MAX`) to events
   per second per site across the fleet (`SITE_EVENTS_PER_SEC`, default 2000). Set `EDGE_FLEET_SIZE` to the real
   instance count: it sizes the fallback rate (`SiteRate/Fleet`) and the quota chunks.

### Risks to check first when this is run

- **kafkajs leftover redelivery.** After a crash the first batch is cut back to the logged range and the remaining
  messages are left unresolved, relying on kafkajs fetching again from the last resolved offset. The first
  integration test should kill the worker mid-insert and assert no message is lost or duplicated.
- **Dedupe window vs insert rate.** `011` sets 20,000 blocks; confirm that is at least restart-time x inserts/s with
  the measured insert rate, and use the Replicated settings if production is replicated (D3).
- **Chained materialized views and the token.** Whether a block deduplicated at `events_v2` also skips the
  downstream aggregate views, with the source table being `Null`-engine, is unverified (F7).
- **WAL replay is at-least-once** across a process restart mid-segment (frames already sent are sent again).
- **Limiter timing includes slow clients' body reads**, which can lower the limit; watch `edge_concurrency_limit`
  before enabling it in production.

---

## 13. Round 2: findings from the rest of the codebase, and from the new code

Same evidence labels as the top of this document. Everything marked **[code]** was read in the working copy; nothing
here has been run. Severity: **S1** outage, data loss, or security/compliance exposure; **S2** degrades at scale;
**S3** hygiene.

### 13.1 Defects in the Phase 1-6 code, found on re-read

| ID | Finding | Status |
|---|---|---|
| M1 | **Quota stranded on every restart.** Each edge holds withdrawn-but-unspent quota in memory; a deploy of 20 edges strands up to 20 chunks per workspace. Because `usage-metering.ts` reconciles with `max(redis, clickhouse)` it can only raise the Redis counter, so stranded units are charged to the customer until month end. With chunk = remaining/(4 x fleet), a 100k-quota workspace could lose about 25% in one deploy. | **Fixed**: `Admitter.Drain` refunds on graceful shutdown. |
| M2 | **Worker intent calls could hang.** The worker's Redis client queues commands forever (`maxRetriesPerRequest: null`), so a Redis outage would stall the writer past the Kafka session timeout, contradicting the claim "degrades exactness, not liveness". | **Fixed**: 500 ms timeout on every intent call. |
| M3 | Lua stringified a millisecond timestamp with `..`, which only works while it has under 14 digits. | **Fixed**: `string.format('%.0f')`. |
| M4 | **Fleet size is configuration, not discovery.** `EDGE_FLEET_SIZE` wrong by 5x means the quota chunk is 5x too large (stranded units on idle edges, premature 402s elsewhere) and the safe rate 5x too generous. | **Fixed**: edges heartbeat into the ZSET `lease:edges` and use the live count for quota chunks and the safe rate; `EDGE_FLEET_SIZE` is only the value used before the first count arrives. |
| M5 | **A crash still strands quota, and nothing can lower the counter.** `max(redis, clickhouse)` is right for not losing live increments but makes any over-charge permanent for the month. | **Fixed differently from the proposal**: setting the counter to `clickhouse_total + outstanding` would drop recent events, because ClickHouse totals lag by the 15-minute rollup cadence. Instead each edge reports what it holds in `lease:q:{workspace}` (changes only), and the new `quota-reclaim` job (every 5 minutes) subtracts the entries of edges that are no longer alive. |

### 13.2 Security and compliance

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| R2 | S1 | **Live OTP codes are written to the log in every environment.** Only the `devCode` field in the HTTP response is gated by `isDev`; the `console.log` of `CODE: [ ... ]` is not. Anyone with log access can take over `login_otp` and `password_reset` flows. | [code] `app/api/auth/otp/send/route.ts` (the `[SECURITY AUDIT]` block) |
| R3 | S1 | **Auth rate limits key on a client-controlled value.** Seven call sites read the *leftmost* `X-Forwarded-For` entry, which the caller sets freely, so a rotating header defeats the per-IP limits on login, OTP send/verify, signup, session and invite accept. The Go edge already does this correctly (`clientip`: Nth entry from the right); the web app never got the fix. Audit rows also store the raw header string, so the recorded "IP" is attacker-controlled. Related: login records a failure *before* checking the password, so five requests lock any known email for 15 minutes (lockout DoS), and the not-found path returns before the password hash is verified, a timing difference that reveals whether an account exists. | [code] `login/route.ts:34`, `otp/send/route.ts:26`, `otp/verify/route.ts:30`, `session/route.ts:55`, `signup/route.ts:29`, `invites/accept/route.ts:49,226`; goals routes store the raw header |
| R4 | S2 | **The web rate limiter is not atomic.** `INCR`, then `EXPIRE` only if the count is 1, then `TTL`: three round trips, and a crash between the first two leaves a counter with no expiry that blocks that key forever. This is the bug `ratelimit/limiter.go` already fixed with a script. `recordFailedLoginAttempt` has the same shape, so a lost `EXPIRE` is a permanent account lockout. | [code] `apps/web/src/lib/rate-limit.ts` |
| R8 | S1 | **There is no erasure or export path.** The product is marketed as privacy-first and ships a DPA page, but nothing deletes or exports one person's data: no per-visitor delete in ClickHouse, none for `identify` traits, only age-based retention. | [code] repo-wide search for erasure/delete-visitor finds only UI copy |
| R7 | S1 | **Retention is not enforced where the data now lives, and the job will silently fail at scale.** It issues one `ALTER TABLE ... DELETE` mutation per site per table nightly (1,000 sites x 7 tables = 7,000 mutations) and swallows every error as a warning. ClickHouse delays and then rejects mutations when too many are pending (thresholds are version-specific; **[mem]** roughly 500 and 1,000), so most would be skipped without anyone noticing. Its table list is the legacy tables only: `events_v2` and every new aggregate keep a fixed 24-month TTL, so a site configured for 12 months keeps 24. | [code] `jobs/retention.ts`, `008_events_v2.sql` TTL |

### 13.3 Hot-path and capacity

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| R1 | S1 | **Realtime falls back to a keyspace-wide `SCAN`.** When a site has no active visitors (the normal state for most sites) `getRealtimeSnapshot` and `getActiveVisitorCount` run `SCAN ... MATCH active:{site}:*` over the whole Redis keyspace, 500 keys per call. It runs on every hub refresh (about every 5 s per watched site) and on page loads. The comment calls it a legacy path for keys written before the index existed, but those keys expire in 5 minutes. With millions of other keys in the same instance this is hundreds of thousands of round trips per idle site. | [code] `apps/web/src/lib/realtime.ts` `scanActiveKeys` |
| R5 | S1 | **All tenants share one ClickHouse user and 20 query slots, and ranges are unbounded.** `dashboard_ro` allows 20 concurrent queries for the whole platform; one tenant running heavy funnel/journey queries (10 s limit each) can fill them and every other dashboard queues or errors. `DateRangeSchema` only checks that `from`/`to` are datetimes, so API-key callers can ask for any span; only 3 of the 14 files that read `events_raw` call `assertRawScanRange` (breakdowns, events, overview). Cache keys use the exact timestamps for ranges that do not end "now", so an API client varying the millisecond never hits the cache. | [code] `clickhouse-dashboard-ro.sql`, `contracts/analytics.ts`, `queries/*.ts`, `query-cache.ts` |
| R6 | S2 | **Usage metering will fail past about 16,000 (workspace, site) rows.** It sends all rows in one multi-row upsert; PostgreSQL allows 65,535 bind parameters and each row binds 4, so the whole job errors above about 16k rows. It also re-aggregates the entire month for every site every 15 minutes from `event_rollups_daily`, a legacy table that must be repointed at the v2 aggregates at cutover. | [code] `jobs/usage-metering.ts` |
| R12 | S2 | **`ingest-proxy` opens a new TCP connection per request beyond two.** It uses `http.Client{Timeout}` with the default transport (`MaxIdleConnsPerHost = 2`), so at load every request pays a handshake and the host collects `TIME_WAIT` sockets until ports run out. It also has no concurrency limit. | [code] `services/ingest-proxy/main.go:40` |
| R11 | S3 | **The onboarding poll counts the whole site history.** `getFirstEventStatus` runs `count()` and `min(timestamp)` over every row of the site on each poll, uncached. `SELECT 1 ... LIMIT 1` answers "received" at a fraction of the cost. | [code] `queries/verification.ts` |
| R13 | S3 | **Duplicate Postgres indexes.** `sessions.token_hash`, `api_keys.key_hash` and `workspace_invites.token` are `UNIQUE` (already indexed) and also have a separate explicit index. Pure write amplification, notably on `sessions`. | [code] `packages/db/src/schema/*.ts`, migration `0001` |
| R14 | S3 | `TRUSTED_PROXY_HOPS` defaults to 1 in the Go edge. If the edge is ever exposed directly, the last `X-Forwarded-For` entry is client-supplied. The startup log mentions it but the default is the unsafe one. | [code] `config.go` |

### 13.4 Functional gap that affects the data model

| ID | Sev | Finding |
|---|---|---|
| R9 | S1 | **Nothing writes `site_user_profiles`.** The People page, the people API and the Segments feature all read it, but the only writer in the repo is `scripts/seed-identified-users.ts`. `identify` events are validated and stored in ClickHouse and go no further, so in production these features have no data. When this is built it should not be Postgres: a profile per visitor is tens of millions of rows. Project `identify` events into a ClickHouse table (`ReplacingMergeTree` keyed `(site_id, distinct_id)`, or an `AggregatingMergeTree` with `argMaxState` for traits) from the existing materialized-view chain, and keep Postgres for the small saved-segment definitions. |
| R10 | S2 | Segment "behaviour" conditions run up to four raw scans of 365 days, parsing `properties_json` with `JSONExtractString` per row and without `assertRawScanRange`, plus trait filters on a JSONB column with no GIN index. Moving profiles into ClickHouse (R9) with `distinct_id` as a real column removes both costs. |

### 13.5 Suggested order for the next batch

| Order | Items | Why first | Size |
|---|---|---|---|
| 1 | R2, R1, R3 + R4 (one shared `clientIp()` and one atomic limiter script), R12 | Each is a few lines, removes a security or outage risk, needs no migration | S |
| 2 | M4, M5 | Closes the quota accounting gaps in the lease design before it is switched on | M |
| 3 | R5 (per-tenant query gate, bounded `DateRange`, cache-key normalisation), R6, R11, R13 | Protects the shared read path and the metering job | M |
| 4 | R7, R8 | Compliance work; needs the "v3" table rebuild and a retention-class partition scheme | L |
| 5 | R9, R10 | A new ClickHouse projection plus API changes | L |

### 13.6 Status after the first Round 2 batch

**Fixed (compiles; not run):** R1 (no keyspace `SCAN`; the index is authoritative), R2 (OTP only logged in
development), R3 (one `getClientIp()` that takes the entry `TRUSTED_PROXY_HOPS` places from the right, used by every
auth limiter and every audit row; login verifies a dummy hash when the account does not exist), R4 (one atomic
Lua call for the web limiter and the failed-login counter), R12 (proxy keeps 512 idle connections to the edge), M4, M5.

**Not changed on purpose:**
- **Lockout is still keyed by email**, so five failed attempts still lock a known email for 15 minutes. Keying
  it by email *and* a trustworthy IP is the usual compromise, but it weakens the brute-force bound and is a
  product decision.
- **`getClientIp()` returns `"unknown"`** (one shared bucket) when the header is missing or shorter than the hops.
  That is deliberate (fails closed), but it means a deployment with no proxy in front must set
  `TRUSTED_PROXY_HOPS=0` and will share one bucket until it has one.
- The `ingest-proxy` still has no concurrency limit: it is a separate Go module and cannot import the edge's limiter.

**New finding from this pass**
| ID | Sev | Finding |
|---|---|---|
| R15 | S2 | **The edge and the metering job can point at different Redis instances.** The edge dials `REDIS_URL` for rate limits and quota (`REDIS_RATELIMIT_URL` is parsed into the config and never used), while `usage-metering.ts` reconciles the `usage:` counters on `REDIS_STATE_URL`. They are the same instance in development. If production splits Redis by role as the config encourages, reconciliation silently updates a counter the edge never reads. The new quota janitor deliberately uses `REDIS_URL` (the edge's instance); metering should be pointed at the same one. |

### 13.7 Status after the shared read-path batch

**Fixed:**
- **R5, per-tenant gate.** `packages/analytics/src/tenant-gate.ts`: each workspace runs at most
  `DASHBOARD_TENANT_CONCURRENCY` (4) dashboard queries at once per web node; up to `DASHBOARD_TENANT_QUEUE` (64)
  wait FIFO for at most 5 s; beyond that the request gets **429 `ANALYTICS_BUSY`** with `Retry-After: 2`. It sits inside
  `getDashboardClickHouseClient()`, so all 14 query files are covered without editing them, and queries are sent
  with `wait_end_of_query=1` so the time in the gate equals the time a ClickHouse slot is held.
  The error extends `AnalyticsQueryError` so existing `catch` blocks rethrow it instead of turning it into a 502.
- **R5, bounded range.** `DateRangeSchema` now rejects `to < from`, spans over 366 days, and any granularity that
  would return more than 5,000 points ("minute" is limited to 3.5 days, "hour" to about 7 months).
- **R6.** The usage upsert is chunked at 5,000 rows (20,000 bind parameters). Metering now reconciles on `REDIS_URL`,
  the edge's instance (this closes R15 for metering).
- **R11.** The onboarding poll reads at most 1,000 rows from the start of the sort key. `received` is exact;
  `totalEvents` saturates at 1,000; `firstEventAt` is exact unless the first day alone has more than 1,000 rows.
- **R13.** Migration `0004` drops the three duplicate indexes and the schema files no longer declare them.

**Decided not to do:** normalising cache keys for closed ranges. A closed day sent with exact timestamps is
precisely the request that should cache; rounding it would change what the numbers mean. The gate and the span
bound already cap the damage from a caller who varies the milliseconds to defeat the cache.

**Verified:** `tsc --noEmit` clean for web, scheduled-worker and event-worker; the new gate test (6), the new range
test (5), the contracts fixtures and the usage-metering tests pass. Not verified: the gate against a real ClickHouse
(in particular that `wait_end_of_query` is accepted under the `readonly = 2` profile) and migration `0004` on a database.

### 13.8 Status after retention and erasure (R7, R8)

**Correction to 13.5:** these did not need the "v3" table rebuild. Grouping sites by retention class and treating the
table TTL as a ceiling works on the existing tables, so it ships without a rebuild.

**New finding, R16 (S1):** the privacy form offers 12, 24 and **36** months, but every table deleted at a fixed 24, so a
site that chose 36 months silently lost a third of its promised history.

**Retention (R7):**
- Migration `012_retention_ceiling.sql` raises every table's TTL to 60 months (14 tables, including `events_v2` and the six
  aggregates). It only extends lifetimes, so it deletes nothing.
- `retention.ts` now enforces each site's own value, including the 24-month default, by grouping sites by retention class:
  one statement per class x 500-site chunk x table (1,000 sites on 3 settings is about 84 statements, was about 14,000).
  It covers all 14 tables, validates ids as UUIDs, checks `system.mutations` and refuses to start on a backlog over 100,
  and **fails the run** if any statement failed (previously a warning no one saw).
- New alert `RetentionNotRun` (36 h) and a runbook entry. The generic one-hour `ScheduledJobStale` rule now excludes
  `retention`, which runs daily and would otherwise page every night.
- **Consequence to be aware of:** because the ceiling is 60 months, the job is now what enforces the 24-month default.
  If it stops, data outlives its promise; that is why the alert is `page` severity. Data of sites deleted from Postgres
  has no row to group by and lives until the 60-month ceiling.

**Erasure (R8):**
- `DELETE /api/v1/sites/{siteId}/people/{identifier}` previews by default and deletes only with `?confirm=true`. It needs the
  new `data:erase` permission (owner, admin), an interactive session (not an API key), and writes an audit row holding a
  keyed hash of the identifier, not the identifier. `GET` on the same URL remains the access/export side.
- `packages/analytics/src/erasure.ts` finds the person (distinct id or visitor pseudonym), expands to every pseudonym seen
  on their events, and deletes from `web_vitals`, then `events_v2`, then `events_raw`; every statement is scoped to one
  workspace and site with bound parameters, and the order makes a failed run safe to repeat. It also removes the
  Postgres profile row.
- **Not erased, by design:** daily aggregate tables (anonymous counts and HyperLogLog states), Kafka and the dead-letter
  topic until their retention expires, and nothing is done about backups. A browser shared by two people loses both
  people's events under it. These limits belong in the DPA text.

**Tests:** 9 retention tests (including grouping, id validation, failure surfacing, backlog guard) and 6 erasure tests
(order, preview deletes nothing, empty person, tenant scope on every statement, identifier never in SQL text) pass.
Type-checks are clean for web and scheduled-worker.

**Not verified (needs a real ClickHouse):** that `DELETE FROM ... WHERE x IN (SELECT ...)` and the
`arrayJoin(arrayConcat(arrayMap(...)))` subquery are accepted by your server version (lightweight deletes need 23.3+); that
`MODIFY TTL` on large tables is acceptable at your data volume; and the lookup step's cost on a very large site (it parses
`properties_json` for every row of that site, and the writer client's request timeout is 30 s).

**Still open:** an erasure button in the dashboard and a bulk/async path for sites too large for a 30-second lookup.

### 13.9 Status after identified users (R9, R10)

**Two corrections to 13.4:**
1. "Nothing writes `site_user_profiles`" was incomplete. `POST /api/v1/sites/{siteId}/people` is a server-side identify
   endpoint that does write it. It had **no authorization check beyond "has a session"**, so any signed-in user of any
   workspace could write profiles into any site: a cross-tenant write (**R17, S1**). It now requires `sites:update` on
   the site's own workspace. What stays true is that the tracker's `identify()` never reached that table.
2. The erasure lookup is **not** faster as a result of this work. It still parses `properties_json` per row, because the
   profile table does not store visitor hashes. Adding `groupUniqArray` of visitor hashes to it would fix that.

**What was built:**
- Migration `013_site_profiles.sql`: `site_profiles_agg` (AggregatingMergeTree, one merged row per site and distinct id)
  and `mv_site_profiles`, fed from `events_v2`. `identify()` already copies the distinct id and every trait into
  `properties`, so no edge or worker change was needed. `traits` is the latest identify event's properties via
  `argMax`; first/last seen, event count and `uniqCombined64` sessions are folded in. It has the 60-month TTL and a
  commented one-time backfill for events already in `events_v2`.
- `packages/analytics/src/queries/profiles.ts`: `listProfiles`, `profileStats`, `getProfile`, `findProfiles`, and the
  segment condition builder translated to ClickHouse. Trait comparisons use the raw JSON value as text, so numeric
  and boolean traits compare as they did with Postgres `->>` (`JSONExtractString` would have returned `''` for them).
- The People page, `GET /people`, `GET /people/{id}` and segment evaluation now read ClickHouse. A backend's `POST
  /people` values are overlaid on the event-derived row for the same distinct id (one indexed Postgres lookup for the
  page being shown). Segment conditions see what the tracker sent, not the overlay.
- The profile table holds emails and traits, so it was added to **erasure** (deleted first, and even when no events are
  found, so it cannot be stranded) and to **retention** (`last_seen` against the site's cutoff).

**Effect on R10:** trait filters no longer scan a JSONB column in Postgres; they are evaluated in ClickHouse over one
row per person. Behaviour conditions are unchanged: they still scan raw events (up to 365 days) with a per-row JSON
extraction. Fixing that needs `distinct_id` as a real column on `events_v2`, which is part of the table rebuild.

**Requirements and limits:**
- Needs `WORKER_WRITE_V2` = `shadow` or `only` (the default is `shadow`). With v2 writes off the table stays empty.
- A person who exists only in Postgres (set by a backend, never tracked) is not listed.
- One merged row per person, read with `GROUP BY distinct_id` over the whole site: comfortable to roughly a million
  identified people per site; beyond that the list page needs a precomputed ordering.
- Backfill is manual (see the migration) and should be run once, after the view exists.

**Tests:** 18 new (profile mapping, every condition's SQL and bound parameters, AND/OR composition, no value in SQL
text, paging, tenant scope) plus the updated erasure and retention suites: all pass (36 analytics, 11 scheduler).
Type-checks are clean for web, scheduler and analytics.

**Not verified (needs a real ClickHouse):** that `argMaxState(if(...), if(...))`, `HAVING` on aliases of aggregates,
`JSONHas` / `JSONExtractRaw` with a bound key, and `positionCaseInsensitiveUTF8` behave as written; and the merge
semantics of `SimpleAggregateFunction(min/max/sum, DateTime64)` in this table. Run `013`, send an `identify()` and a
few page views from a test site, and compare the People page with the raw events before relying on it.

**Status of the whole list:** R1 to R16 done as described above; R17 fixed; nothing else from section 13 is open
except the items called out in 13.8 and the verification that needs a live stack.
