# Release Impact

`Errors & Reliability > Release Impact`. It answers: did this deploy make
the site better or worse?

## Needs
Tag builds with `data-release="web@1.4.2"` in the tracker snippet. Optionally report each deploy from CI
(`POST /api/v1/deploys`, see [`releases.md`](releases.md)) so the start time is exact; otherwise the first session seen on
the release is used. A site without release tags has no reports.

## What is compared
- **After:** sessions on this release in its first N hours (6, 24 or 72; so far, if N has not passed).
- **Before:** the same length of time just before the deploy, on the release that was live then (the one with the most
  sessions in that period, other than this one). Sessions still on old builds after the deploy are therefore not mixed in.
- If no earlier release is found, there is nothing to compare with and the report says so.

## Metrics
| Metric | Test | Bad direction |
|---|---|---|
| Sessions with an error | two-proportion z-test | up |
| Errors per 1,000 sessions | shown, not tested | up |
| LCP and INP, 75th percentile | Mann-Whitney U on the individual samples (tie-corrected) | up, and the whole distribution moved |
| Conversion of the site's first enabled goal | two-proportion z-test | down |
| New issues; regressions | counts | |

Not yet: revenue per session and API p95 (their data arrives with Phase 3 and `api_call` events), and a per-site
"primary goal" setting (today it is the first enabled goal, matched exactly as the Goals page does).

## The verdict
- **Collecting data:** fewer than 500 sessions on either side. No judgement is shown, whatever the numbers look like.
- **Regressed:** some metric is worse with p < 0.01 **and** at least 20% worse.
- **Watch:** worse with p < 0.05 and at least 10% worse.
- **Healthy:** otherwise. Improvements are never flagged.
The reasons are written out, and name where the errors concentrated: "Sessions with an error 329% worse (p < 0.001,
n=600), concentrated on browser Safari (2.8% to 33%, 180 sessions)". The breakdown lists a browser, country or device only
when it has at least 100 sessions on each side, its error rate rose significantly, and it is not simply all the traffic.

## Honest limits
- A deploy is not an experiment. Time of day and weekday differ between the two windows, so Watch means "look", not
  "proven". The page says this under "How to read this".
- Several metrics are tested at once, so an occasional false alarm is possible; the 10% / 20% size floors keep it rare.
- Timing: the report reads raw events for at most 72 hours of one site (bounded drill-down, cached for 5 minutes), not a
  precomputed table. That is fine for the sizes tested; it has not been measured on a very large site.
- No automatic rollback advice and no Slack/webhook post yet: posting waits for the Phase 4 alert engine.

## Verified
Statistics against worked examples (a textbook z-test, rank-test edge cases, an outlier that must not fool it).
End to end against the real ClickHouse with 600 sessions before and 600 after a seeded deploy where only Safari broke:
the previous release was found, the verdict was Regressed, the reason named Safari, and LCP and conversion (kept flat)
were not flagged. A second site saw nothing. `next build` compiles both pages.
**Not verified:** the pages in a browser (behind login), and the deploy-webhook path feeding the start time.
