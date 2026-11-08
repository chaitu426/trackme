import { createHash, randomBytes } from "node:crypto";
import { getRedis } from "./redis";

/**
 * Binds the second login step to the first. After a correct password the server issues a one-time challenge
 * and emails a code; the code is accepted for a protected account only together with that challenge. Without
 * it, an attacker who can read the victim's mailbox still cannot sign in without also knowing the password,
 * and one who knows the password cannot sign in without the mailbox: both factors are required.
 */
const TTL_SECONDS = 10 * 60;
const key = (token: string) => `login_challenge:${createHash("sha256").update(token).digest("hex")}`;

export async function createLoginChallenge(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getRedis("state").set(key(token), userId, "EX", TTL_SECONDS);
  return token;
}

/** True when `token` is a live challenge issued to exactly this user. Does not consume it. */
export async function challengeMatches(token: string | undefined, userId: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  return (await getRedis("state").get(key(token))) === userId;
}

export async function consumeLoginChallenge(token: string): Promise<void> {
  await getRedis("state").del(key(token));
}
