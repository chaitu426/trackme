# Phase 2 plan: User 360 Timeline and Release Impact Report (for review)

Phase 1 is done (Error Tracking incl. source maps, Retention & Cohorts, Segments for Retention). One piece of Phase 2 is
already built and tested: the statistics engine (`packages/analytics/src/stats.ts`).

## Findings that shape the plan

1. **Error events do not carry the user id in ClickHouse.** The worker replaces an error event's `properties` with
   `{groupId, errorType, level}` (Phase 1A), dropping `distinctId`. Anything that attributes events to a user from
   `properties.distinctId` (Retention does; the User 360 timeline would) therefore misses errors. Fix first: keep
   `distinctId` in that object. Errors recorded before the fix stay unattributed in the timeline.
2. **A timeline already exists in the People drawer** (`getUserTimeline`, reads events by user). User 360 is an upgrade
   of it, not a new page: kinds (pages, events, errors), severity, session grouping, header cards, pinned moments.
3. **Payments, feedback and flag exposures do not exist yet** (Phases 3 and 5). The timeline ships with pages, events
   and errors, and gains kinds as those features land.
4. **Latency samples, not just p75s.** The rank test needs raw samples. Web vitals samples exist in `events_v2`
   (`vital_value`); API timings do not exist yet, so the API p95 check waits for `api_call` events.

## 2A. User 360 Timeline (build order)
1. Worker: keep `distinctId` on error events (+ test).
2. Migration 018 + down: `user_timeline` fed by a materialized view over `events_v2` (pageview, custom, error) for
   identified users: `(site_id, user_id, ts, event_id, kind, summary, severity, session_hash, release)`, ordered
   `(site_id, user_id, ts DESC, event_id)`, summaries capped at 200 chars and scrubbed, 90-day TTL, covered by erasure.
   Expected size: about 120 B per identified-user event. A page reads one user's rows by the sort key: no scan.
3. `getUserTimelinePage` with keyset pagination on `(ts, event_id)`, kind and severity filters.
4. UI: the profile drawer gets a Timeline view: filters, sessions as collapsible groups, "jump to error" links to the
   issue page, a copy-link that deep-links to the user, header cards (first and last seen, sessions, errors, current
   release, country and device). Pinned moments: first seen, signup (first named event, chosen in settings later),
   last error.
5. Anonymous events from before the user was identified (same browser, same day) are joined through `identity_map` at
   read time, bounded to the user's own sessions.

## 2B. Release Impact Report
1. Windows: N hours (default 24) before the deploy time versus N hours after. "Before" sessions are those on the
   previous release, "after" those on the new one, so stragglers on old builds do not blur the comparison. Deploy time
   comes from the deploy webhook (`site_releases`), or the first session seen on the release.
2. Metrics: sessions with an error (rate test) and errors per 1,000 sessions (shown), new issues first seen in the
   release, regressions, LCP and INP samples (rank test), conversion of the primary goal (rate test). Revenue per
   session and API p95 wait for Phase 3 data.
3. Verdict by `decideVerdict`: no verdict under 500 sessions a side ("collecting data"); Regressed needs p < 0.01 **and** a
   20% worsening; Watch needs p < 0.05 and 10%. The reasons are shown ("Checkout errors 3.1x on Safari, p < 0.01,
   n = 4,820"). Breakdown by browser, country and device from the rollup dimensions.
4. Fairness: a deploy is not an experiment. Traffic mix shifts with time of day and weekday, so the page says so and,
   where a week of history exists, compares against the same hours a week earlier as a second reference.
5. Output: a report page per release; an optional Slack/webhook post only with Regressed at p < 0.01, never an automatic
   rollback instruction.

## Decisions for you
1. OK to compare previous-release sessions (before) against new-release sessions (after) rather than all sessions by time?
   (Recommended; it needs the SDK `release` tag, so sites without it get no report.)
2. Primary goal for conversion: the first enabled goal, or a setting on the site? (Recommended: a setting, default first goal.)
3. OK to ship User 360 with pages, events and errors only, and add payment, feedback and flag kinds with their features?
4. Slack/webhook posting: the existing alert channels, or wait for Phase 4's alert engine?
