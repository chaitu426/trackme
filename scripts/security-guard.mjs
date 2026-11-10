#!/usr/bin/env node
/**
 * Fails the build when code reintroduces a pattern that caused a real vulnerability here (docs/operations/SECURITY_AUDIT.md).
 * It is deliberately simple text matching, fast enough to run on every push. Each rule names the finding it
 * guards, says why, and has an explicit allowlist: adding to a list is a reviewable decision, not an accident.
 *
 *   node scripts/security-guard.mjs        scans the repository, exit 1 on any violation
 *   node --test scripts/security-guard.test.mjs   unit tests of the rules
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const WEB = "apps/web/src/";
const isRoute = (p) => p.startsWith(`${WEB}app/api/`) && p.endsWith("/route.ts");
const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || p.endsWith("_test.go");
const isSource = (p) => /\.(ts|tsx|mjs|js|go)$/.test(p) && !isTest(p);

/** Routes that are public on purpose. Every other route must call an authorization helper. */
export const PUBLIC_ROUTES = new Set([
  "auth/login", "auth/logout", "auth/signup", "auth/session", "auth/otp/send", "auth/otp/verify",
  "internal/metrics", // authenticates itself with METRICS_TOKEN
  "v1/invites/accept", // authenticates with the emailed token; an existing account must also be signed in
  "security/csp-report", // browsers post violation reports without credentials; rate limited
]);

export const GUARDS = [
  "authenticateRequest", "requireSiteAccess", "requireMetricsAccess", "requireWorkspaceMember",
  "authorizeSite", "requireApiUser", "requireUser", "requireWorkspaceBySlug", "METRICS_TOKEN",
];

/** Files allowed to render HTML from a string; each holds build-time content, never user input. */
const INNER_HTML_ALLOWED = new Set([
  "apps/tracker-docs/src/components/code-block.tsx",
  "apps/tracker-docs/src/components/tabs-client.tsx",
]);

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, "an AWS access key id"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "a private key"],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/, "a Slack token"],
  [/ghp_[0-9A-Za-z]{30,}/, "a GitHub token"],
  [/sk_live_[0-9A-Za-z]{10,}/, "a live payment key"],
  [/hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9A-Za-z]+/, "a Slack webhook URL"],
];

/** A line can opt out of one rule with a trailing `// security-guard: allow <reason>`. */
const allowed = (line) => /security-guard:\s*allow\s+\S/.test(line);

function lines(text) {
  return text.split("\n").map((line, i) => ({ line, n: i + 1 }));
}

/** @type {Array<{id: string, finding: string, why: string, run: (file: {path: string, text: string}) => Array<{n: number, detail?: string}>}>} */
export const RULES = [
  {
    id: "client-ip",
    finding: "R3",
    why: "X-Forwarded-For's leftmost entries are written by the caller. Use getClientIp() (apps/web/src/lib/client-ip.ts), which takes the entry added by our own proxy.",
    run: ({ path, text }) =>
      path.startsWith(WEB) && isSource(path) && !path.endsWith("lib/client-ip.ts")
        ? lines(text).filter(({ line }) => /x-forwarded-for/i.test(line) && !allowed(line))
        : [],
  },
  {
    id: "no-secrets-in-logs",
    finding: "R2, H8",
    why: "One-time codes, tokens, secrets and passwords must never be logged: anyone who can read the logs can sign in.",
    run: ({ path, text }) =>
      isSource(path) && !path.startsWith("scripts/")
        ? lines(text).filter(
            ({ line }) =>
              /console\.(log|info|warn|error|debug)\(/.test(line) &&
              /\$\{\s*(?:code|otp|token|secret|password|passwordHash|signingSecret|apiKey|plaintext)\b|\b(?:OTP|CODE|TOKEN|SECRET|PASSWORD)\s*[:=]\s*\[?\s*\$\{/i.test(line) &&
              !allowed(line)
          )
        : [],
  },
  {
    id: "route-needs-authorization",
    finding: "R17, C1",
    why: "Every API route must call an authorization helper, or be added to PUBLIC_ROUTES on purpose (scripts/security-guard.mjs).",
    run: ({ path, text }) => {
      if (!isRoute(path)) return [];
      const name = path.slice(`${WEB}app/api/`.length, -"/route.ts".length);
      if (PUBLIC_ROUTES.has(name)) return [];
      return GUARDS.some((g) => text.includes(g)) ? [] : [{ n: 1, detail: `route "${name}" has no authorization call` }];
    },
  },
  {
    id: "outbound-requests-use-safe-fetch",
    finding: "H3",
    why: "A server-side fetch of a variable URL can be aimed at internal services. Use safePost() (apps/web/src/lib/safe-fetch.ts).",
    run: ({ path, text }) =>
      path.startsWith(WEB) && isSource(path) && !text.startsWith('"use client"') && !path.includes("/components/") && !path.includes("/hooks/") &&
      !path.endsWith("lib/safe-fetch.ts") && !/\/page\.tsx$|-client\.tsx$/.test(path)
        ? lines(text).filter(({ line }) => /\bfetch\(\s*[A-Za-z_]/.test(line) && !allowed(line))
        : [],
  },
  {
    id: "no-raw-html",
    finding: "H4",
    why: "dangerouslySetInnerHTML turns a string into live markup. Only the listed files may use it, and only for build-time content.",
    run: ({ path, text }) =>
      isSource(path) && !INNER_HTML_ALLOWED.has(path)
        ? lines(text).filter(({ line }) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write\(/.test(line) && !allowed(line))
        : [],
  },
  {
    id: "invite-token-never-selected",
    finding: "C1",
    why: "Invite tokens are only ever emailed. Reading the token column anywhere but the accept route risks returning it to a client again.",
    run: ({ path, text }) =>
      isSource(path) && !path.endsWith("invites/accept/route.ts")
        ? lines(text).filter(({ line }) => /workspaceInvites\.token\b/.test(line) && !allowed(line))
        : [],
  },
  {
    id: "no-weak-randomness-for-secrets",
    finding: "M1",
    why: "Math.random() is predictable. Codes, tokens and ids that protect anything must come from node:crypto.",
    run: ({ path, text }) =>
      /apps\/web\/src\/(lib\/(otp|session|session-store|invite-token|password|auth|login-challenge|signup-pending|secret-box)|app\/api\/auth\/)/.test(path) && isSource(path)
        ? lines(text).filter(({ line }) => /Math\.random\(/.test(line) && !allowed(line))
        : [],
  },
  {
    id: "no-dynamic-code",
    finding: "H4",
    why: "eval and new Function execute strings as code.",
    run: ({ path, text }) =>
      isSource(path) && !path.startsWith("scripts/")
        ? lines(text).filter(({ line }) => /(^|[^.\w])eval\((?!script)|new Function\(/.test(line) && !allowed(line))
        : [],
  },
  {
    id: "no-tls-verification-off",
    finding: "M3",
    why: "Disabling certificate verification makes every connection interceptable.",
    run: ({ path, text }) =>
      isSource(path)
        ? lines(text).filter(({ line }) => /InsecureSkipVerify:\s*true|rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/.test(line) && !allowed(line))
        : [],
  },
  {
    id: "no-committed-secrets",
    finding: "Secrets",
    why: "Keys and tokens in the repository are public to everyone who can read it, forever (git history).",
    run: ({ path, text }) =>
      /\.(lock|svg|png|jpg|ico)$/.test(path) || path.startsWith(".archify/")
        ? []
        : lines(text).flatMap(({ line, n }) => {
            const hit = SECRET_PATTERNS.find(([re]) => re.test(line));
            return hit && !allowed(line) ? [{ n, detail: `looks like ${hit[1]}` }] : [];
          }),
  },
];

/** Runs every rule over the given files. */
export function check(files) {
  const violations = [];
  for (const file of files) {
    // The guard's own source and tests quote the patterns they search for.
    if (/^scripts\/security-guard/.test(file.path)) continue;
    for (const rule of RULES) {
      for (const hit of rule.run(file)) {
        violations.push({ rule: rule.id, finding: rule.finding, why: rule.why, path: file.path, line: hit.n, detail: hit.detail ?? hit.line?.trim() });
      }
    }
  }
  return violations;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((p) => p && /\.(ts|tsx|mjs|js|go|json|ya?ml|env|example|md|sql)$/.test(p) || p.endsWith(".env.example"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = trackedFiles().flatMap((path) => {
    try {
      return [{ path, text: readFileSync(path, "utf8") }];
    } catch {
      return []; // deleted in the working tree but still listed
    }
  });
  const violations = check(files);
  if (violations.length === 0) {
    console.log(`security-guard: ${files.length} files, ${RULES.length} rules, no violations.`);
  } else {
    for (const v of violations) console.error(`${v.path}:${v.line}  [${v.rule} / ${v.finding}]  ${v.detail ?? ""}\n    ${v.why}`);
    console.error(`\nsecurity-guard: ${violations.length} violation(s). Fix them, or (if intentional) add a documented allowlist entry.`);
    process.exit(1);
  }
}
