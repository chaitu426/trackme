# User 360 timeline

Open a person in **Analytics > User Profiles**: the drawer now opens on a **Timeline** tab. The earlier view (sessions,
journeys and replay) is still there under "Sessions & replay".

## What it shows
- **Header cards:** sessions and errors in the last 90 days, the release and the country/device they last used.
- **Key moments:** first seen (exact, kept 25 months), last seen, and their last error, which links to its issue page.
- **The stream:** pages, custom events and errors on one clock, newest first, grouped by visit. Filters: Everything,
  Errors, Events, Pages. "Load older" pages through the history; error rows open the issue; "Copy link" gives a URL that
  opens this person straight away (it is the People page searched for their id, so the viewer needs access to the site).

## Identified users only
A row exists only for events that carry the person's id (`properties.distinctId`, set by the tracker after `identify()`).
Activity from before someone was identified, and anonymous visitors, are not on this timeline; the Sessions tab still
shows the browser's earlier visits. Errors are included because the worker now keeps the user id on error events;
errors recorded before that change (2026-11-09) have no user and are not attributed.

## How it is stored
`user_timeline` (migration 018) is filled by a ClickHouse view as events arrive: one row of about 100 to 150 bytes per
page, event or error, ordered by site, user and time, with a 90-day TTL. A page of history is a contiguous read of one
person's rows, so its cost does not depend on the size of the site. Pagination is keyset on (time, event id).
- A page's summary is its path **without the query string**, which can hold tokens and emails.
- An error's summary is its scrubbed title (the same scrubbing as the issue list).
- `kind` is an open string. Payments, feedback and flag exposures will appear as new kinds when those features ship,
  without changing the table.
- Erasing a person removes their rows (`eraseVisitor`).

## Not built
- Payment, feedback and flag-exposure rows (their features do not exist yet).
- Pinning a "signup" moment: it needs a per-site choice of which event means signup.
- A deep link that opens a person by id without searching the list.

## Verified
Against the real ClickHouse, through the worker's own error path: errors land on the user's timeline with the title
scrubbed; a `?token=…&email=…` is stripped from a page row; anonymous events, anonymous errors and a bot are excluded;
paging through all rows two at a time returns every row once (including two events at the same instant); kind and
severity filters work and a hostile filter value is ignored; another user or another site sees nothing. Migration 018
rolled back and re-applied cleanly. `next build` compiles the route and the drawer.
**Not verified:** the drawer in a browser (behind login).
