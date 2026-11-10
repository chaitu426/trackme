# Source maps

Production code is minified, so a stack trace reads `r @ app.min.js:1:52`. With a source map for that build, the issue
page shows `validateCart @ src/cart.ts:3:11`.

## Upload (in CI, after the build)

```
POST /api/v1/sourcemaps
Authorization: Bearer <deploy key>
Content-Type: application/json

{ "siteKey": "<public key from the tracker snippet>",
  "release": "web@1.4.2",                     // the same value as data-release in the snippet
  "file": "https://cdn.example.com/assets/app.3f2a.js",   // URL or path as it appears in stack traces
  "map": "<contents of app.3f2a.js.map>" }    // JSON text or an object
```

- **Auth** is the same deploy key as `POST /api/v1/deploys` (Organization & Team > API tokens > "Generate Deploy Key").
  The public `siteKey` only names the site.
- **Matching** is by the file's **path** (host, query and fragment ignored) plus the release. Upload one map per
  minified file. The release must equal what the SDK sends, or the map is never used.
- **Limits:** 10 MB per map, JSON version 3 only. Uploading the same site, release and file again replaces it, so CI
  can re-run safely. Errors: 400 bad body or not a source map, 401/403 key problems, 404 unknown `siteKey`, 413 too large.
- Add `"sourcesContent": false` (esbuild `--sources-content=false`, webpack `devtool: "hidden-source-map"` then drop
  contents) if you do not want your source code stored; only file names, lines and function names are used.

```sh
curl -fsS -X POST "$TRACKME_URL/api/v1/sourcemaps" \
  -H "Authorization: Bearer $TRACKME_DEPLOY_KEY" -H "Content-Type: application/json" \
  --data-binary "$(jq -n --arg k "$SITE_KEY" --arg r "$RELEASE" --arg f "$ASSET_URL" --rawfile m app.js.map \
     '{siteKey:$k, release:$r, file:$f, map:$m}')"
```

## How it is used

The map is applied **when you open an occurrence**, not when the error arrives. So a map uploaded after the first errors
still explains them, and nothing slows ingestion. Each frame is placed through the map (stack columns count from 1, maps
from 0). A function's name comes from the frame above it, because a map names what is *called* at a position, not the
function around it. A frame with no map, or one the map cannot place, stays as reported.

The page marks a trace "Source-mapped", or suggests uploading a map when a release has none.

## Known limit: grouping still uses minified names

Issues are grouped from the error type, message and top frames as the browser reported them. Minified function names
change between builds, so the same bug in two builds can appear as two issues until you set a fingerprint:
`trackme.captureException(err, { fingerprint: "checkout-null-cart" })`. De-minifying before grouping would fix this and
is the natural next step.

## Storage and retention

Maps live in an object store behind the `ObjectStore` interface (`packages/object-store`). The built-in adapter writes
files under `OBJECT_STORE_DIR` (default `.data/objects`). **With more than one web or worker host this directory must be
shared**, or an S3-compatible adapter added; none is built yet. Keys start with the site id. A daily job deletes maps
older than 90 days.

## Verified
A real esbuild-minified bundle was run, its genuine stack parsed, and de-minified to the original file, line, column and
function names. Not verified end to end: the upload route (it needs a live API key), and the S3 path (not built).
