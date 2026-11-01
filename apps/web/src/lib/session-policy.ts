export function sessionsValidAfterKey(userId: string): string {
  return `user:sva:${userId}`;
}

/** Tokens without iat are treated as issued at epoch so a later revoke-all still rejects them. */
export function issuedAtSeconds(iat: number | undefined | null): number {
  return typeof iat === "number" && Number.isFinite(iat) ? iat : 0;
}

export function isIssuedBeforeValidAfter(iat: number | undefined | null, validAfterUnixSeconds: number): boolean {
  return issuedAtSeconds(iat) < validAfterUnixSeconds;
}

export function parseValidAfterUnix(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
