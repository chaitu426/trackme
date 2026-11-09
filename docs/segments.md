# Segments

A segment is a saved filter over **identified users** (people your app has `identify()`-ed): traits, first and last seen,
session and event counts, and behaviour ("did X in the last N days", "did not"). They are created in People, stored in
Postgres (`site_segments`, migration 0003), at most 50 per site, and every definition is validated by a strict schema
(`apps/web/src/lib/segment-schema.ts`) before it is saved or evaluated. All values reach ClickHouse as bound parameters.

## Where a segment can be used

| Report | Status |
|---|---|
| People | Built: pick a segment to list its members. |
| **Retention & Cohorts** | **Built:** the Segment dropdown restricts the cohorts to the segment's users. |
| Funnels, Journeys, Overview | Not built. |

Why not the rest: those reports count **sessions and visitors**, and most of their traffic is anonymous, while a segment
describes identified users. Applying one means turning "these users" into "these sessions" (through `identity_map`),
which silently excludes everyone anonymous, and it would run as a very large `IN (…)` list. That is a real design
decision (and a cost), not a quick picker, so it is left out rather than shipped misleadingly.

## Limits to know

- A segment resolves to at most **20,000 users** (the most recently active). If more match, Retention says the chart is a
  sample. Evaluating bigger segments needs the condition compiled into the query itself instead of a user list.
- Segments see what the tracker sent. A name or email a backend attached through `POST /people` is not part of the
  conditions (it is searchable in People, but not filterable here).
- A saved definition that no longer passes the schema is skipped, never trusted.

## How Retention uses one

The page reads the saved definition for this site only (an id from another site returns nothing), evaluates it with the
same engine as People (`matchSegment`), and passes the user ids to the cohort query, which filters the cohort users.
Results are cached for 5 minutes, keyed by the segment's definition.

## Verified
`matchSegment` (cap reporting, did / did-not behaviour, no behaviour query without candidates) and the retention user
filter (including "empty segment = no one" and another site = nothing) are tested; the latter against the real ClickHouse.
**Not verified:** a saved segment end to end through the Retention page in a browser.
