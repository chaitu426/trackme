# Releases and environments

Every event can say which build it came from and where it ran. Features that need it: Error Tracking
(first and last release, regressions), the Release Impact Report, release filters.

## Tagging events

The tracker config takes two optional values (added to the SDK in Phase 1; the edge, worker and
ClickHouse accept them now):

| Field | Rules | Default |
|---|---|---|
| `release` | 1 to 64 characters: letters, digits, `. _ + @ / -`, starting with a letter or digit | none (stored as empty) |
| `environment` | `production`, `staging` or `development` | `production` |

An invalid value rejects that one event at the edge (`release` reason), like any other contract breach.
Stored on `events_v2` as `release` and `environment` (migration 014).

## Reporting a deploy

```
POST /api/v1/deploys
Authorization: Bearer <deploy key>
Content-Type: application/json

{ "siteKey": "<public key from the tracker snippet>",
  "version": "web@1.4.2",
  "commit": "9f3c2ab",            // optional, 4 to 64 of A-Z a-z 0-9 . _ -
  "environment": "production",     // optional
  "deployedAt": "2026-11-09T10:00:00Z" }   // optional; within the last 90 days, not in the future
```

- **Auth.** Create a *deploy key* under Organization & Team > API tokens ("Generate Deploy Key"). It carries
  only the `write:deploys` scope: it cannot read analytics or call anything else. The public `siteKey` is
  *not* a credential (it is visible in page source); it only names the site, which must belong to the key's workspace.
- **Idempotent.** The same `(site, version, environment)` returns the first row with `created: false`
  (HTTP 200); a new one returns 201. Safe to retry from CI.
- **Errors.** 400 invalid body or date, 401 missing or bad key, 403 key lacks the scope, 404 unknown
  `siteKey` in this workspace (same answer for another workspace's site).
- Stored in Postgres `site_releases` (migration `0007`), one row per deploy, kept until the site is deleted.

CI example:

```sh
curl -fsS -X POST "$TRACKME_URL/api/v1/deploys" \
  -H "Authorization: Bearer $TRACKME_DEPLOY_KEY" -H "Content-Type: application/json" \
  -d "{\"siteKey\":\"$TRACKME_SITE_KEY\",\"version\":\"$GIT_TAG\",\"commit\":\"$GIT_SHA\"}"
```

## Rollback

`node infra/aiven/migrate-clickhouse.mjs --down` undoes the newest ClickHouse migration using
`infra/migrations/clickhouse/down/<same name>`. Postgres rollbacks are in `infra/migrations/postgres/down/`
(run by hand with psql; drizzle has no down command). Both are meant for a bad release, not routine use.
