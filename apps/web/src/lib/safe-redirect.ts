/**
 * Where to send the user after sign-in, taken from the `next` query parameter, which anyone can craft.
 * Only a path on this site is acceptable. The checks that matter: it must start with a single "/" (not "//"),
 * and it must not contain a backslash, which browsers treat as "/" ("/\evil.com" navigates to evil.com), or
 * control characters, which URL parsers silently remove ("/\t/evil.com"). Anything else returns null and the
 * caller uses its default.
 */
export function safeNextPath(candidate: string | null | undefined): string | null {
  if (!candidate || candidate.length > 2048) return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  for (const ch of candidate) {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || code < 0x20 || code === 0x7f) return null;
  }
  try {
    const base = "https://base.invalid";
    const url = new URL(candidate, base);
    if (url.origin !== base) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
