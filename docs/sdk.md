# Tracker SDK: size, lazy modules and error capture

## Size (gzip)

| File | Before | Now | Loaded |
|---|---|---|---|
| `tracker.js` (core) | 10,052 B | **7,848 B** (-22%) | always |
| `tracker.vitals.<hash>.js` | in core | 3,535 B | when `data-collect-web-vitals` is on (default) |
| `tracker.errors.<hash>.js` | n/a | 3,417 B | only when `data-errors="true"` |

A page that turns off web vitals and errors downloads and parses 22% less than before. The core with vitals only
(no errors) is 7,224 B: error capture costs the core 624 B (config, three methods, release tags) and the rest sits
in its own file. The CI budgets are 8,000 B core, 3,800 B vitals, 4,500 B errors (`scripts/check-bundle-size.mjs`).

What was tried and rejected, with numbers: a stronger minifier (terser, 3 passes) saves 180 B (2.5%) for a new build
dependency; replacing the native `TextEncoder` byte count in the transport with a hand-written loop adds code and is
unlikely to be faster. Behaviour of everything in the core is unchanged: all pre-existing tests pass untouched.

## How lazy loading works

- `tracker.js` loads a chunk by adding a `<script async>` pointing **beside itself** (same directory). The chunk
  hands its API back on its own script element, so there are no globals.
- Build (`scripts/build-iife.mjs`): chunks are built first and named by content hash; the main file is built last
  with each chunk's name and sha384 baked in. If the page loaded `tracker.js` with `integrity=`, each chunk is loaded
  with its own `integrity=` too, so SRI pinning still covers all code that runs.
- npm build: the same features are plain dynamic `import()`s, split by your bundler.
- **Anything that serves `tracker.js` must also serve the `tracker.*.js` files next to it** (the Next app, a CDN
  upload, a first-party proxy such as `infra/examples/nginx-first-party-proxy.conf`). A missing chunk costs that
  feature only; the rest of the SDK works.
- One behavioural difference: web-vitals now registers a moment after load instead of with the core script. Its
  observers replay buffered entries, so metrics are the same; a visitor who leaves before the chunk arrives (a
  sub-second bounce) sends no vitals.

## Configuration

| Script attribute | Default | Meaning |
|---|---|---|
| `data-errors` | `false` | load the error module and capture uncaught errors, rejected promises and failed requests |
| `data-errors-4xx` | `false` | also report 4xx responses (5xx and network failures are always reported) |
| `data-errors-console` | `false` | also report `console.error` calls |
| `data-release` | none | build label on every event, e.g. `web@1.4.2` |
| `data-environment` | `production` | `production`, `staging` or `development` |

An invalid `data-release` or `data-environment` is dropped with one console warning; it never causes events to be
rejected.

## Error API

```js
trackme.captureException(err, { tags: { step: "pay" }, level: "error", fingerprint: "checkout-null-user" });
trackme.captureMessage("Checkout stalled", "warning");   // levels: fatal, error, warning, info (default info)
trackme.setTag("plan", "pro");                           // up to 10 tags, sent with every later error
```

These need `data-errors="true"` and do nothing otherwise. Calls made before the module has loaded are queued (20 at
most) and replayed. All of it is wrapped: the SDK never throws into your page.

## What is collected, and what is not

- **Captured:** uncaught errors, unhandled rejections, `fetch`/XHR failures, your `captureException` calls.
- **Breadcrumbs** (last 20): route changes, clicks (tag, id, up to 2 classes, up to 40 characters of the button or link
  text; never an input's value), and requests (`GET /api/orders 500 120ms`: method, path without query string, status, time).
- **Scrubbed in the browser and again on the server:** emails, phone numbers, UPI ids, card numbers, JWTs, bearer and
  basic tokens, API keys, passwords, and every URL query value outside `utm_*`, `ref`, `page`, `sort`, `lang`.
  The event's URL is sent without its query string and fragment.
- **Limits:** the same error is sent once per 10 seconds; at most 50 errors per browser session; requests to the
  ingest endpoint itself are never recorded.
- Errors respect consent and Do Not Track like every other event.

## Verified

A headless Chrome page loading the built tracker with `integrity=` ran every capture path against a local collector:
11 of 11 events passed the real `TrackerEventSchema`; both chunks loaded under SRI; the email in a rejection message
became `[email]`; a `?token=` in a fetch URL appeared nowhere; no request to the ingest endpoint was reported as an error.
Not verified: Firefox and Safari stack formats against real browsers (the parser has unit tests for both formats), and
behaviour on a very slow network.
