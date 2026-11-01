/**
 * Generates a random UUIDv4 string
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const SESSION_KEY = "_gi_sid";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity
const PSEUDONYM_KEY = "_gi_pid";
const PSEUDONYM_TTL_MS = 24 * 60 * 60 * 1000; // rotate daily

/** Where a session came from, fixed when it starts (first external referrer and UTM tags). */
export type SessionSource = {
  referrer?: string;
  campaign?: Record<string, string>;
};

type StoredSession = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  src?: SessionSource;
};

type StoredPseudonym = {
  id: string;
  createdAt: number;
};

/**
 * Tabs of one browser share a session, as in GA4 and Plausible: opening a link in a new tab
 * is the same visit, not a second one. localStorage is shared by tabs; sessionStorage is the
 * fallback where it is blocked, which gives per-tab sessions.
 */
function sessionStore(): Storage {
  try {
    const ls = window.localStorage;
    ls.getItem(SESSION_KEY);
    return ls;
  } catch {
    return window.sessionStorage;
  }
}

/**
 * Where storage is blocked (sandboxed iframes, strict privacy modes) the session lives in
 * memory for the life of the page. Without it every event would mint a new session and
 * visitor, and each hit would count as a separate visit.
 */
let memorySession: StoredSession | null = null;
let memoryPseudonym: StoredPseudonym | null = null;

function fromMemory(now: number): StoredSession {
  if (!memorySession || now - memorySession.lastSeenAt > SESSION_TIMEOUT_MS) {
    memorySession = { id: generateUUID(), createdAt: now, lastSeenAt: now };
  }
  memorySession.lastSeenAt = now;
  return memorySession;
}

function readSession(store: Storage, now: number): StoredSession | null {
  const raw = store.getItem(SESSION_KEY);
  if (!raw) return null;
  let parsed: Partial<StoredSession>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredSession>;
  } catch {
    return null; // corrupt value: start a session, which overwrites it
  }
  if (!parsed?.id || typeof parsed.lastSeenAt !== "number") return null;
  if (now - parsed.lastSeenAt > SESSION_TIMEOUT_MS) return null;
  return {
    id: parsed.id,
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : now,
    lastSeenAt: now,
    ...(parsed.src ? { src: parsed.src } : {}),
  };
}

/**
 * Retrieves or creates the session ID, reset after 30 minutes of inactivity. Every call
 * counts as activity.
 */
export function getSessionId(): string {
  try {
    const store = sessionStore();
    const now = Date.now();
    const current = readSession(store, now) ?? { id: generateUUID(), createdAt: now, lastSeenAt: now };
    store.setItem(SESSION_KEY, JSON.stringify(current));
    return current.id;
  } catch {
    return fromMemory(Date.now()).id;
  }
}

/**
 * The source of the current session. `compute` runs once, when the session has none yet, so
 * every page of the visit is credited to the same referrer and campaign instead of only the
 * landing page (the internal links that follow carry neither).
 */
export function getSessionSource(compute: () => SessionSource): SessionSource {
  try {
    const store = sessionStore();
    const now = Date.now();
    const current = readSession(store, now) ?? { id: generateUUID(), createdAt: now, lastSeenAt: now };
    if (!current.src) current.src = compute();
    store.setItem(SESSION_KEY, JSON.stringify(current));
    return current.src;
  } catch {
    const current = fromMemory(Date.now());
    if (!current.src) current.src = compute();
    return current.src;
  }
}

/**
 * Retrieves or creates a rotating daily visitor pseudonym without persistent third-party cookies
 */
export function getVisitorPseudonym(): string {
  const now = Date.now();
  try {
    const raw = window.localStorage.getItem(PSEUDONYM_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredPseudonym;
      if (stored?.id && Date.now() - stored.createdAt < PSEUDONYM_TTL_MS) {
        return stored.id;
      }
    }
  } catch {
    // Fall through and mint a fresh pseudonym.
  }

  // Storage may have refused the last write: reuse the in-memory one while it is still fresh.
  if (memoryPseudonym && now - memoryPseudonym.createdAt < PSEUDONYM_TTL_MS) return memoryPseudonym.id;

  const stored: StoredPseudonym = { id: generateUUID(), createdAt: now };
  memoryPseudonym = stored;
  try {
    window.localStorage.setItem(PSEUDONYM_KEY, JSON.stringify(stored));
  } catch {
    // localStorage unavailable (private mode, quota) - pseudonym just won't persist across reloads.
  }
  return stored.id;
}


/** Forget the current session and visitor so the next event starts both afresh (used on logout). */
export function resetVisit(): void {
  memorySession = null;
  memoryPseudonym = null;
  try {
    sessionStore().removeItem(SESSION_KEY);
  } catch {
    // Nothing stored to remove.
  }
  try {
    window.localStorage.removeItem(PSEUDONYM_KEY);
  } catch {
    // Nothing stored to remove.
  }
}
