# Ask: the in-app agent

Ask is a floating pill at the bottom of every signed-in page. Focus it (click, or press `/`) and the conversation appears in the air above it: no solid panel, each turn a frosted sheet over the page, fading out at the top. The page stays
usable behind it. Fold it (`Esc`, or the chevron) and it is a bar again. There is no separate chat window, no route to open and nothing to close.

**Status: live.** The question goes to the Ask worker, which plans over the workspace's own ClickHouse data with an OpenAI model, and the steps and answer stream back over SSE. No answer is ever canned: if a run fails, the panel says why and shows nothing else. See **Backend** below.

## What it is not

Not a chat transcript. A turn is a **finding**:

1. The question.
2. **Steps**: what the agent did, live as it works (the current step carries the matrix mark), folded afterward to one line ("4 steps · 3 queries · 2.3 s").
3. The **answer**: text, figures, bars, a table or a trend, every figure carrying a numbered citation `[n]`.
4. **Evidence**, one card per citation: where the data came from (source and table), the **exact query**, the range, rows returned and time taken, a sample of rows to check
   the claim against, a link to the page that shows the same data, and a copy button. Editing the query is shown but disabled until the query builder exists.
5. **Confidence** and the **assumptions** the answer takes for granted, which can be expanded and challenged.
6. **What you could do next** (ideas beyond answering) and **follow-up questions** that continue from this finding.

A number is never free-standing: the interface (and a test) requires every citation to point at an evidence item that exists.

## Scope: what it may look at

Always visible in the header ("Looking at Payments Overview · acme.com · last 30 days · 4 sources") and editable under **Configure**:

- websites in scope (at least one), default time range;
- data sources it may read: Traffic, Errors, Payments, Releases, People (People is off by default);
- privacy: mask personal data (names, emails, user ids hidden in results and never sent to a model), most rows per query;
- standing instructions about the business (800 characters), added to every question;
- a plain statement of what it can do (read, run read-only queries, show its work, stay inside the chosen workspace and sites) and cannot (change settings, delete data, send messages, call outside services).

A question whose source is switched off is **declined by name** ("needs payments data, switched off for me right now") rather than answered. A question it cannot answer is declined with
what it could answer; it does not guess a number.

Suggestions follow the page: on Payments the starters are about success rate, checkout losses and drop-off; on Errors they are about cost and releases.

## The contract the backend must meet

`apps/web/src/lib/ask/types.ts`. A run produces an `Answer`: `steps`, `blocks`, `evidence`, `assumptions`, `confidence`, `followups`, `ideas`, and an optional `limit`.
The interface needs nothing else, so the backend can stream steps and then deliver blocks and evidence without a redesign.

State is a pure reducer (`lib/ask/state.ts`, tested): open or folded, view (Ask, History, Configure), draft, turns, history (30, same question moves to the top), scope (saved per
workspace in the browser), and a mark on the folded bar when an answer arrives while it is folded.

## Keyboard

`/` focus Ask from anywhere (not while typing in a field) · `Enter` ask · `Shift+Enter` new line · `↑` in an empty box recalls the last question · `Esc` fold.
`Ctrl/Cmd+K` is still the command palette; Ask never takes it.

## Backend (Phase 1: planner + query runner)

```
AskDock ─POST /api/v1/ask/runs─▶ web route: auth + tenant, clamp scope, budget pre-check,
                                  INSERT ask_runs(queued), XADD ask:runs, 202 { runId }
                                          │
ask-worker (services/ask-worker, stateless, N replicas)
   XREADGROUP ask-workers → mark running + heartbeat → OpenAI tool loop → run_query(template)
     · template wraps an existing analytics query fn (tenant condition + filters bound inside)
     · ClickHouse max_execution_time / max_result_rows set by the dashboard client
     · Redis per-workspace LLM concurrency + global RPM token bucket
   → grounding gate → UPDATE ask_runs(done, answer) → XADD ask:stream:<runId> → XACK
                                          │
AskDock ─GET /api/v1/ask/runs/:id/events─▶ SSE: replay + live steps, terminal `done`
```

It scales on the web side by returning immediately (the work is not in the request) and on the worker side by adding replicas: the Redis Streams consumer group shares the
queue, the budget in Redis is shared by every node, and run state lives in Postgres so an SSE reconnect or a web restart loses nothing.

### How the seven questions are answered

1. **How data is gathered.** A hybrid: the model picks a **vetted template id and typed parameters** (zod-validated), never SQL (`packages/ask/src/templates.ts`). A template calls
   an existing analytics function, which already binds the tenant condition and filters. A free-form SQL sandbox can be added later as a second tool without changing `Answer`.
2. **Where queries run.** The read-only dashboard ClickHouse client, with `max_execution_time` and `max_result_rows` set on every query, the per-tenant gate reused, and the
   `workspace_id`/`site_id` condition supplied by the system, never the model.
3. **What the model sees.** Only the templates whose source is on (id, source, description, parameter shape), the clamped scope and range, the instructions, and result rows
   (first 8, for the evidence sample). The planner is a tool loop with `run_query` and `finish`.
4. **Grounding check.** `packages/ask/src/grounding.ts`, run in the worker before the answer is stored: every citation must name an existing evidence item, and every number in a text
   block must appear in the sample of the evidence it cites. Ungrounded blocks are dropped and logged; a trail with fewer than two grounded links is dropped.
5. **The query builder.** Not yet. "Edit query" stays shown-but-disabled until the structured editor exists.
6. **Cost and abuse.** Redis budget: global completions-per-minute (`ASK_LLM_RPM`) and per-workspace in-flight runs (`ASK_WORKSPACE_CONCURRENCY`). The web route pre-checks it and
   returns 429 with `Retry-After` before a row is written; the worker takes a slot for the whole run.
7. **Audit.** Every accepted run writes an `ask:run` audit record (question truncated, sources, range) and an `ask_runs` row that keeps the full `Answer` JSON.

### Catalog

Traffic: `traffic_overview`, `compare_periods` (this period vs the equal one before, with the change), `traffic_timeseries`, `traffic_breakdown`, `page_engagement`, `web_vitals`, `web_vitals_by_page`, `custom_events`.
Errors: `errors_top`, `error_trend`. Payments: `payments_overview`, `gateway_health`, `checkout_funnel`, `revenue_leaks`, `payment_failures`, `payment_recovery`, `refunds_disputes`.
Releases: `releases_seen`, `release_new_issues`. People (aggregates only, never names or ids): `retention`, `people_overview`.
The prompt lists each parameter with its allowed values, so the model does not guess enum names.

### Conversation, arithmetic and failure handling

- **Follow-ups.** The browser sends the last four finished exchanges (question and the answer text shown) with the next question. They reach the model as context, marked as not instructions and not evidence; anything cited is re-queried.
- **`calculate` tool.** Exact arithmetic for derived figures (a change in percent, a share). Its results are accepted by the grounding gate; a figure that is neither in the evidence, nor calculated, nor a rounding of an evidence figure, nor the range length is still dropped.
- **Never empty.** If the gate drops every block, the person gets the evidence tables with a plain note and low confidence, not a finished run with nothing on screen. Out of tool rounds with evidence in hand, the last round is forced to `finish`.
- **Named failures.** Provider rate limit, timeout, rejected key and provider outage each have their own message (`packages/ask/src/failure.ts`); detail stays in the worker log. A run has a 150 s wall-clock deadline.
- **Stop.** The panel's Stop button calls `DELETE /api/v1/ask/runs/:id` (creator only); the worker checks between model calls and the run ends as `cancelled`.
- **Queue correctness.** A run that finds its workspace at the concurrency limit is re-enqueued after a short pause (it was previously acked and lost). Stale runs are re-enqueued onto the stream (they were reset in Postgres but never redelivered) and failed after ten minutes. A finished run that is redelivered is not run again. The fleet-wide `ASK_LLM_RPM` bucket is now enforced in the worker, not only pre-checked by the web route.
- **Prompt injection.** Query results are wrapped as data and the prompt tells the model to ignore instructions inside them.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ASK_ENABLED` | `false` | Turns the API and worker on. In production it requires `OPENAI_API_KEY`. |
| `OPENAI_API_KEY` | — | Provider key; required when `ASK_ENABLED`. |
| `ASK_MODEL` | `gpt-4.1` | Model id for the planner. |
| `ASK_MAX_TOKENS` | `8192` | Per-completion output cap. |
| `ASK_MAX_STEPS` | `6` | Most tool-loop iterations before a run fails. |
| `ASK_WORKSPACE_CONCURRENCY` | `2` | Runs a single workspace may have in flight. |
| `ASK_LLM_RPM` | `120` | Shared planner completions per minute across the fleet. |
| `ASK_RUN_TIMEOUT_MS` | `120000` | A run with a heartbeat older than this is re-queued by the sweeper. |
| `ASK_METRICS_PORT` | `9466` | Worker `/health` and `/metrics` port. |

To run locally: `ASK_ENABLED=true OPENAI_API_KEY=… pnpm dev`, plus `pnpm start:ask` (or it runs under `pnpm start:all`). The `ask_runs` table comes from
migration `0010`.

### Phase 2 (not built)

The money-trail builder and `rank_causes`, watches (`ask_watches` + scheduled-worker evaluation), server-side case-file persistence, ticket push, the SQL sandbox, and the query
builder editor. The notes below describe them.

## Working states

While a run is in progress the turn shows one live line: the matrix mark, what the agent is doing, and for a table read the table name with a row count climbing to the result, plus small ticks for finished steps. The answer text is then written out word by word with a glyph caret (about 1.8 s however long it is; instant under reduced motion and for turns already read). Sources are quiet chips that expand to the exact query and sample rows; confidence, assumptions and the step summary are one line that expands.

## The money trail (our edge)

Other analytics tools answer "what happened". Sentry knows the error, a payments dashboard knows the failure, web analytics knows the drop-off, and none of them can say **"this error cost you ₹195,970"**. TrackMe holds errors, releases, gateway events, checkout sessions and payments in one place, so Ask can follow a problem from its **cause to the rupees it cost**, link by link, each link citing its evidence. That is the product's USP, and Ask is where it is easiest to use: ask a plain question, get the chain and the number.

An answer about something that cost money carries three extra things (all in `types.ts`, all optional):

1. **`trail`**: ordered links (release, error, gateway, funnel, money), each with a title, a plain detail, when it happened and a citation, plus a `total` (the figure, what it is, and how it was estimated). Drawn as a vertical line that grows as the links appear.
2. **`watch`**: a standing check the answer suggests ("a gateway's success rate falls below 70% over 15 minutes"). One click opens channels (Email, Slack, Webhook) and arms it. A question asked once keeps being asked.
3. **Case file and ticket** (built in the browser from the answer, so they never say more than the answer did): *Copy case file* gives markdown with the question, answer, trail, every query as SQL and the assumptions; *Copy ticket* gives a title that leads with the cause and the money, the impact, and where to start. The finding leaves the panel and goes where work happens.

Status: the interface draws `trail` and `watch`, and the case-file and ticket copies work from any answer, but the backend does not produce a trail or a watch yet (Phase 2, below), so a live answer carries neither today. A watch armed in the panel is saved in the browser only (`trackme_ask_watches`).

### Backend, for the next phase

- **Trail builder.** Not free text from a model. A deterministic joiner over existing data, which a model only narrates:
  - *cause candidates*: new error groups and regressions (`new-error-groups` job, `alerts:events`), releases (`site_releases`), gateway incidents (`payments/health` stretches), classified failure causes (`payment_failure_class`);
  - *exposure*: `leak_sessions` (session → error groups → paid), `order_session` (order ↔ session), `payment_events` for values;
  - *cost*: the revenue-leak estimator in `packages/analytics/src/revenue-leak.ts` (two-proportion test; value = gap × affected sessions × average order; a range from "beyond normal drop-off" to "every session would have paid"). Reuse it as is so Ask and the Revenue Leaks page can never disagree.
  - Output is `Trail` directly. A link is only emitted if its evidence query ran and returned rows; if the join cannot be made (no checkout sessions, no payments source) the trail is omitted and the answer says why, never a guessed rupee figure.
- **Ranking.** "What should I fix first" is the trail totals sorted descending with their confidence; expose it as a planner tool `rank_causes(range, limit)`.
- **Watches.** Store in Postgres (`ask_watches`: workspace, site, `metric` id from a fixed catalog, comparator, threshold, window, channels, created_by, armed_at). The metric catalog is a fixed list of vetted queries (gateway success rate, error-affected checkout sessions, error cost per week), not model-written SQL. Evaluation runs in the scheduled worker and publishes to `alerts:events`, reusing the alert engine's channels, throttling and delivery log. A watch shows its last value and last fired time in History. Limit per workspace, and the creator is audited.
- **Case files.** Server side only adds a stable link: persist the `Answer` JSON (question, scope, trail, evidence samples) under an id so a teammate opens the same finding read-only; evidence queries are re-runnable by people with access, never embedded with raw personal data (masking applies before storage).
- **Tickets.** Later: push the ticket text to Linear/Jira/GitHub through the workspace's integration, with the case-file link in the body.
- **Grounding.** Every trail node and the total must resolve to an evidence item, enforced by the same check as the answer text (`citationsOf` already covers trail nodes).
