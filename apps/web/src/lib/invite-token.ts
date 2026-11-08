import { createHash, randomBytes } from "node:crypto";

/**
 * Invite tokens exist in exactly two places: the email sent to the invitee, and (as a SHA-256 hash) the
 * database. They are never returned by any API, so holding one proves control of the invited mailbox. The
 * 256-bit random value makes a fast unsalted hash sufficient; a database leak does not yield usable links.
 */
export const hashInviteToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashInviteToken(token) };
}
