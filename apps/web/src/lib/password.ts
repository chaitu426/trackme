import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { AppError } from "@trackme/contracts";

const KEY_LENGTH = 64;

/**
 * scrypt at N=2^16, r=8, p=2 (64 MiB per hash), one of the combinations OWASP lists as equivalent to its
 * recommended minimum. Node's default (N=2^14, about 16 MiB) is a quarter of that and is what older hashes use.
 * The parameters are stored inside each hash, so they can be raised later without invalidating anything:
 * `needsRehash` tells the login route to upgrade a hash the next time its owner signs in.
 */
const COST = { N: 2 ** 16, r: 8, p: 2 } as const;
const MAXMEM = 256 * 1024 * 1024;

function derive(password: string, salt: string, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { maxmem: MAXMEM, ...opts }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Hashing is deliberately expensive, and it runs on libuv's small thread pool. Unbounded, a flood of sign-in
 * attempts from many addresses would occupy every thread and starve unrelated work (DNS, file reads, other
 * crypto). So at most MAX_ACTIVE hashes run at once (256 MiB at the outside), up to MAX_WAITING more wait, and
 * anything beyond that is refused with 503 instead of queuing without limit.
 */
const MAX_ACTIVE = 4;
const MAX_WAITING = 64;
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) {
    if (waiting.length >= MAX_WAITING) throw new AppError(503, "AUTH_BUSY", "Sign-in is busy. Please try again in a moment.");
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    active++;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); // the slot passes to the next waiter
    else active--;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await withSlot(() => derive(password, salt, COST));
  return `scrypt2:${COST.N}:${COST.r}:${COST.p}:${salt}:${derived.toString("hex")}`;
}

type Parsed = { N: number; r: number; p: number; salt: string; hash: string };

function parse(stored: string): Parsed | null {
  const parts = stored.split(":");
  if (parts[0] === "scrypt2" && parts.length === 6) {
    const [, N, r, p, salt, hash] = parts;
    const n = { N: Number(N), r: Number(r), p: Number(p) };
    // Bound what a stored value can ask of the server, in case a row is ever tampered with.
    if (!(n.N >= 2 ** 14 && n.N <= 2 ** 20 && n.r >= 1 && n.r <= 16 && n.p >= 1 && n.p <= 8) || !salt || !hash) return null;
    return { ...n, salt, hash };
  }
  if (parts[0] === "scrypt" && parts.length === 3 && parts[1] && parts[2]) {
    // Legacy format: Node's defaults (N=16384, r=8, p=1).
    return { N: 16384, r: 8, p: 1, salt: parts[1], hash: parts[2] };
  }
  return null;
}

/** True when the stored hash uses weaker parameters (or an older format) than hashPassword does now. */
export function needsRehash(stored: string): boolean {
  const p = parse(stored);
  return !p || p.N !== COST.N || p.r !== COST.r || p.p !== COST.p;
}

/** Well-formed but matches nothing: verifying against it costs a real scrypt run at the current cost. */
const DUMMY_HASH = `scrypt2:${COST.N}:${COST.r}:${COST.p}:${"00".repeat(16)}:${"00".repeat(KEY_LENGTH)}`;

/** Spend the time a real password check would, so "no such account" is not faster than "wrong password". */
export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const p = parse(storedHash);
  if (!p) return false;
  const derived = await withSlot(() => derive(password, p.salt, { N: p.N, r: p.r, p: p.p }));
  const expected = Buffer.from(p.hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
