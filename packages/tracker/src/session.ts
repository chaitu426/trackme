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
const PSEUDONYM_KEY = "_gi_pid";
const PSEUDONYM_TTL_MS = 24 * 60 * 60 * 1000; // rotate daily

type StoredPseudonym = {
  id: string;
  createdAt: number;
};

/**
 * Retrieves or creates a temporary session ID (stored only in sessionStorage, cleared on browser close)
 */
export function getSessionId(): string {
  try {
    let sid = window.sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = generateUUID();
      window.sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return generateUUID();
  }
}

/**
 * Retrieves or creates a rotating daily visitor pseudonym without persistent third-party cookies
 */
export function getVisitorPseudonym(): string {
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

  const id = generateUUID();
  try {
    const stored: StoredPseudonym = { id, createdAt: Date.now() };
    window.localStorage.setItem(PSEUDONYM_KEY, JSON.stringify(stored));
  } catch {
    // localStorage unavailable (private mode, quota) - pseudonym just won't persist across reloads.
  }
  return id;
}

