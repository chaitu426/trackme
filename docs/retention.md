# Retention & Cohorts

`Analytics > Retention & Cohorts` (hidden until `FEATURE_FLAGS` contains `retention`). It answers: of the people who
first showed up in a period, how many came back in each period after?

## Identified users only

Anonymous visitors get a new pseudonym every 24 hours (by design and by the privacy policy), so TrackMe cannot tell
whether one came back. **Retention therefore covers users your app has identified with `trackme.identify()`.** The page
states the number of identified users beside the chart, and when there are none it explains how to start instead of
showing an empty grid. If you want anonymous retention, that needs a separate, consent-based persistent ID: a product
and legal decision, not built.

## Reading the chart

- Rows are cohorts: the day, week (Monday) or month a user first appeared. Columns are the periods that follow.
- Each cell is the share of the cohort active in that period, shown as a number and shaded by it (the number is never
  only a colour). Hover for "X of Y users".
- `–` means that period has not happened yet. It is not zero, so a recent cohort never shows a fake drop.
- Period 0 is the cohort's own period: 100% for "any activity", and lower if you count a specific return event.
- The bottom row is the average weighted by cohort size, over the cohorts that have reached that period.

Choices (in the URL, so a view can be shared):

| Control | Options |
|---|---|
| Granularity | Daily (last 14 cohorts), Weekly (last 8), Monthly (last 6) |
| Cohort starts at | First visit, or the first time a user did a named custom event (signup, purchase) |
| Counts as returning | Any activity (a pageview or custom event), or a named custom event |

## How it is computed

Three tables (migration 017) are kept by ClickHouse materialized views as events arrive: `user_active_day` (who was
active when), `user_first_day`, and `user_event_day` (who did which event when). They are exact and incremental; there is
no nightly job. The identified user comes from `properties.distinctId`, which the tracker adds to pageviews and custom
events after `identify()`; events before the user was identified are not attributed.

A query reads one site's users and their activity between the first cohort and the last period needed: one row per user
per active day, never raw events. Results are cached for 5 minutes. That is a design target, not a measurement: for a
site with millions of identified users the query reads tens of millions of rows, and a precomputed cohort table would be
the next step. It has not been measured at that size.

Retention: 25 months by table TTL. These tables hold user ids, so erasure removes a person from all three.

## Not built
- A segment filter. The query accepts a user list (`userIds`) so a saved segment can plug in; the page does not offer it yet.
- Rolling or "unbounded" retention, and cohort-size limits for very large sites.

## Verified
Against the real ClickHouse with six users over seven days and every number worked out by hand: the daily matrix, a
signup cohort, signup followed by purchase, weekly and monthly roll-ups, a user filter, an empty filter, another site
(empty), and an anonymous visitor and a bot (both excluded) all matched. Migration 017 rolled back and re-applied cleanly.
**Not verified:** the page rendered in a browser, and performance at large scale.
