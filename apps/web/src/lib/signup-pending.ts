import { getRedis } from "./redis";

/**
 * A sign-up that has not been confirmed yet. Until the emailed code is entered no `users` row exists, so
 * nobody can pre-register an address they do not control, and a second sign-up for the same address simply
 * replaces the first. The password hash lives here for at most 15 minutes and is applied only at the moment
 * the mailbox owner proves control (see api/auth/otp/verify).
 */
export interface PendingSignup {
  name: string;
  passwordHash: string;
}

const TTL_SECONDS = 15 * 60;
const key = (email: string) => `signup_pending:${email.toLowerCase()}`;

export async function savePendingSignup(email: string, pending: PendingSignup): Promise<void> {
  await getRedis("state").set(key(email), JSON.stringify(pending), "EX", TTL_SECONDS);
}

export async function hasPendingSignup(email: string): Promise<boolean> {
  return (await getRedis("state").exists(key(email))) === 1;
}

/** Reads and removes the pending sign-up in one step, so a code can complete a sign-up only once. */
export async function takePendingSignup(email: string): Promise<PendingSignup | null> {
  const raw = await getRedis("state").getdel(key(email));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSignup>;
    return typeof parsed.name === "string" && typeof parsed.passwordHash === "string"
      ? { name: parsed.name, passwordHash: parsed.passwordHash }
      : null;
  } catch {
    return null;
  }
}
