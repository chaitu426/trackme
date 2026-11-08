# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately, not in a public issue. Include what you found, how to
reproduce it, and the impact you expect. We aim to acknowledge a report within two working days and to tell you
the outcome and timeline within seven.

**Reporting contact: not yet configured.** Before this project accepts outside reports, add a monitored address
here (and, ideally, serve it at `/.well-known/security.txt` following RFC 9116). An unmonitored mailbox is worse
than none, which is why this file does not invent one.

## What is covered by automation

The `security` job in `.github/workflows/ci.yml` runs on every push and pull request:

| Check | What it prevents |
|---|---|
| `scripts/security-guard.mjs` | Reintroducing patterns that caused real vulnerabilities: trusting `X-Forwarded-For`, logging codes or tokens, API routes without authorization, server-side `fetch` of a user-supplied URL, raw HTML injection, returning invite tokens, weak randomness for secrets, disabled TLS verification, committed secrets |
| `pnpm audit --prod --audit-level=high` | Shipping a production dependency with a known high or critical advisory |
| `govulncheck` | The same for the Go services |
| gitleaks | Secrets in the working tree or history |
| Dependabot | Dependencies drifting behind their fixes |

The findings these guard against, and the reasoning, are in `docs/SECURITY_AUDIT.md`.

## Operating the secrets

* Encryption keys can be rotated without downtime; see `scripts/rotate-secrets.ts`.
* A stored secret is never logged, returned by an API, or sent to a client.
* Session cookies are host-only unless `SESSION_COOKIE_SHARED_ACK=true` says otherwise.
