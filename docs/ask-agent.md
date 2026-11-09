# Ask: the in-app agent

Ask is a bar at the bottom of every signed-in page. Focus it (click, or press `/`) and it unfolds upward in place into a small floating panel; the page stays
usable behind it. Fold it (`Esc`, or the chevron) and it is a bar again. There is no separate chat window, no route to open and nothing to close.

**Status: interface only.** The panel runs on a demo engine (`apps/web/src/lib/ask/demo-engine.ts`) that answers five kinds of question from the demo dataset and
declines anything else, and a "Preview" tag says so. The backend phase replaces `answerFor` and leaves the interface alone.

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

## Decisions for the backend phase (not made here)

These are the architecture questions the interface deliberately leaves open:

1. **How data is gathered.** A planner that picks sources and builds queries from the scope, versus a fixed set of vetted query templates the model fills in. Templates are safer and
   cheaper; free-form SQL is more flexible and needs a sandbox.
2. **Where queries run.** Read-only credentials, a row and time limit from the scope, per-workspace concurrency (the dashboard's gate already does this), and the tenant condition on
   every statement added by the system, never by the model.
3. **What the model sees.** Schemas and descriptions of the allowed sources, the scope, the instructions, and result rows after masking. Never raw personal data when masking is on.
4. **Grounding check.** Reject or flag any figure in a draft answer that is not in a query result, before it reaches the person. The citation contract makes this mechanical.
5. **The query builder.** "Edit query" becomes a structured editor over the same evidence item, re-run through the same limits.
6. **Cost and abuse.** Per-workspace budgets and rate limits, with the remaining allowance shown in the panel.
7. **Audit.** Each run (question, scope, queries, answer) in the workspace audit log.
