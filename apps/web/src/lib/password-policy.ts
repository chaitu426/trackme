import { createHash } from "node:crypto";
import { AppError } from "@trackme/contracts";

/**
 * Password rules, following NIST SP 800-63B: length matters, composition rules do not, and a password that
 * is common or known from a breach is refused. Used wherever a new password is chosen.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// A short list of the passwords attackers try first; the breach check below covers the long tail.
const COMMON = new Set(
  [
    "password", "password1", "password123", "123456789012", "qwertyuiopas", "1q2w3e4r5t6y", "letmein12345",
    "welcome12345", "admin1234567", "iloveyou1234", "changeme1234", "trustno1trustno1", "passwordpassword",
    "qwerty123456", "abc123abc123", "000000000000", "111111111111", "123456123456", "p@ssw0rd1234",
    "password!234", "sunshine1234", "football1234", "monkey123456", "dragon123456", "master123456",
  ].map((p) => p.toLowerCase())
);

/** The first problem with a candidate password, or null if it is acceptable. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common.";
  if (new Set(lower).size < 5) return "That password is too repetitive.";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Do not include your email address in your password.";
  const name = context.name?.toLowerCase().replace(/\s+/g, "");
  if (name && name.length >= 4 && lower.replace(/\s+/g, "").includes(name)) return "Do not include your name in your password.";
  return null;
}

/**
 * True if the password appears in the Have I Been Pwned corpus. Uses the k-anonymity range API: only the
 * first five hex characters of the SHA-1 leave this server, never the password or its full hash. If the
 * service is unreachable the check passes (fail open): signing up must not depend on a third party.
 */
export async function isPwnedPassword(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [hash, count] = line.trim().split(":");
      return hash === suffix && Number(count) > 0; // padded entries have a count of 0
    });
  } catch {
    return false;
  }
}

/** Throws a 400 `WEAK_PASSWORD` unless the password is acceptable. */
export async function assertAcceptablePassword(password: string, context: { email?: string; name?: string } = {}): Promise<void> {
  const problem = passwordProblem(password, context);
  if (problem) throw new AppError(400, "WEAK_PASSWORD", problem);
  if (await isPwnedPassword(password)) {
    throw new AppError(400, "WEAK_PASSWORD", "That password has appeared in a data breach. Choose a different one.");
  }
}
