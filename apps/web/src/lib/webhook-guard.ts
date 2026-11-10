/**
 * Two small in-process helpers for the public payment webhook. Both are per server instance on purpose: they exist to keep a
 * flood of bad requests off the database, and a network round trip to Redis would defeat that.
 */

/** Counts rejected requests per caller in a window, and says when a caller should be turned away without any lookup. */
export function createFailureLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const seen = new Map<string, { count: number; resetAt: number }>();
  return {
    isBlocked(key: string): boolean {
      const e = seen.get(key);
      if (!e) return false;
      if (e.resetAt <= now()) {
        seen.delete(key);
        return false;
      }
      return e.count >= max;
    },
    recordFailure(key: string): void {
      const t = now();
      const e = seen.get(key);
      if (!e || e.resetAt <= t) {
        // Bound the map: a caller rotating addresses must not grow it without limit.
        if (seen.size > 10_000) seen.clear();
        seen.set(key, { count: 1, resetAt: t + windowMs });
      } else {
        e.count += 1;
      }
    },
  };
}

/** A tiny time-limited cache. A value older than `ttlMs` is dropped on read. */
export function createTtlCache<V>(ttlMs: number, now: () => number = Date.now) {
  const items = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key: string): V | undefined {
      const e = items.get(key);
      if (!e) return undefined;
      if (e.expiresAt <= now()) {
        items.delete(key);
        return undefined;
      }
      return e.value;
    },
    set(key: string, value: V): void {
      if (items.size > 5_000) items.clear();
      items.set(key, { value, expiresAt: now() + ttlMs });
    },
    /** Removes every entry the predicate selects (used when a secret is rotated or removed). */
    deleteWhere(match: (value: V) => boolean): void {
      for (const [k, e] of items) if (match(e.value)) items.delete(k);
    },
  };
}

/** Lets a recurring side effect run at most once per interval per key (the "last event received" stamp). */
export function createThrottle(intervalMs: number, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return (key: string): boolean => {
    const t = now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < intervalMs) return false;
    if (last.size > 5_000) last.clear();
    last.set(key, t);
    return true;
  };
}
