import { classifyFailure, DEFAULT_RULES, rulesVersion, type FailureRule } from "@trackme/payments";

/** A failed payment that has not been classified yet. */
export interface PendingFailure {
  workspaceId: string;
  siteId: string;
  paymentId: string;
  orderId: string;
  gateway: string;
  method: string;
  amountMinor: number;
  currency: string;
  code: string;
  userRef: string;
  failedAtMs: number;
  /** When the payment started, or null when the start was never seen. */
  startedAtMs: number | null;
}

export interface Outcome {
  siteId: string;
  gateway: string;
  atMs: number;
  paid: boolean;
}

export interface ErrorHit {
  siteId: string;
  sessionHash: string;
  atMs: number;
}

export interface ClassifiedRow {
  workspaceId: string;
  siteId: string;
  paymentId: string;
  orderId: string;
  gateway: string;
  method: string;
  amountMinor: number;
  currency: string;
  code: string;
  userRef: string;
  failedAtMs: number;
  category: string;
  ruleId: string;
  rulesVersion: string;
  sessionError: boolean;
  gatewayRate: number;
  gatewayVolume: number;
  secondsToFail: number;
}

/** Everything the job needs from the database, so the decisions can be tested without one. */
export interface ClassifierDeps {
  fetchPending(limit: number, lookbackHours: number): Promise<PendingFailure[]>;
  /** The browser session each order belongs to (from the checkout events). Keys are `${siteId}:${orderId}`. */
  fetchSessions(failures: PendingFailure[]): Promise<Map<string, string>>;
  fetchErrors(pairs: Array<{ siteId: string; sessionHash: string }>, fromMs: number, toMs: number): Promise<ErrorHit[]>;
  fetchOutcomes(pairs: Array<{ siteId: string; gateway: string }>, fromMs: number, toMs: number): Promise<Outcome[]>;
  save(rows: ClassifiedRow[]): Promise<void>;
  /** Hands the classified failures to whatever follows up (a mailer, a WhatsApp sender). Best effort: it never fails the job. */
  emit?(rows: ClassifiedRow[]): Promise<void>;
}

/** An error counts as related when it came in the two minutes before the payment failed. */
export const SESSION_ERROR_WINDOW_MS = 2 * 60_000;
/** The gateway's success rate is read from the ten minutes before and five minutes after the failure. */
export const RATE_BEFORE_MS = 10 * 60_000;
export const RATE_AFTER_MS = 5 * 60_000;
export const BATCH_SIZE = 500;

/**
 * Classifies up to one batch of failed payments that have no classification yet, and stores the results. Returns how many were
 * classified. Safe to run again at any time: a payment that is already classified is not picked up, and storing the same
 * payment twice leaves one row.
 */
export async function classifyPending(
  deps: ClassifierDeps,
  options: { rules?: readonly FailureRule[]; lookbackHours?: number; limit?: number } = {}
): Promise<number> {
  const rules = options.rules ?? DEFAULT_RULES;
  const pending = await deps.fetchPending(options.limit ?? BATCH_SIZE, options.lookbackHours ?? 72);
  if (pending.length === 0) return 0;

  const sessionOf = await deps.fetchSessions(pending);
  const times = pending.map((f) => f.failedAtMs);
  const lo = Math.min(...times);
  const hi = Math.max(...times);

  const pairs = [...new Set(pending.map((f) => (sessionOf.has(`${f.siteId}:${f.orderId}`) ? `${f.siteId}|${sessionOf.get(`${f.siteId}:${f.orderId}`)}` : "")).filter(Boolean))].map((p) => {
    const [siteId, sessionHash] = p.split("|") as [string, string];
    return { siteId, sessionHash };
  });
  const errors = pairs.length > 0 ? await deps.fetchErrors(pairs, lo - SESSION_ERROR_WINDOW_MS, hi) : [];

  const gatewayPairs = [...new Set(pending.map((f) => `${f.siteId}|${f.gateway}`))].map((p) => {
    const [siteId, gateway] = p.split("|") as [string, string];
    return { siteId, gateway };
  });
  const outcomes = await deps.fetchOutcomes(gatewayPairs, lo - RATE_BEFORE_MS, hi + RATE_AFTER_MS);

  const version = rulesVersion(rules);
  const rows = pending.map((f): ClassifiedRow => {
    const session = sessionOf.get(`${f.siteId}:${f.orderId}`);
    const sameSessionErrors = session
      ? errors.filter((e) => e.siteId === f.siteId && e.sessionHash === session && e.atMs >= f.failedAtMs - SESSION_ERROR_WINDOW_MS && e.atMs <= f.failedAtMs).length
      : 0;
    const near = outcomes.filter((o) => o.siteId === f.siteId && o.gateway === f.gateway && o.atMs >= f.failedAtMs - RATE_BEFORE_MS && o.atMs <= f.failedAtMs + RATE_AFTER_MS);
    const volume = near.length;
    const rate = volume > 0 ? near.filter((o) => o.paid).length / volume : null;
    const secondsToFail = f.startedAtMs === null ? null : Math.max(0, (f.failedAtMs - f.startedAtMs) / 1000);
    const { category, ruleId } = classifyFailure(
      { gateway: f.gateway, method: f.method, code: f.code, context: { gateway: f.gateway, method: f.method, sameSessionErrors, gatewaySuccessRate: rate, gatewayVolume: volume, secondsToFail } },
      rules
    );
    return {
      workspaceId: f.workspaceId,
      siteId: f.siteId,
      paymentId: f.paymentId,
      orderId: f.orderId,
      gateway: f.gateway,
      method: f.method,
      amountMinor: f.amountMinor,
      currency: f.currency,
      code: f.code,
      userRef: f.userRef,
      failedAtMs: f.failedAtMs,
      category,
      ruleId,
      rulesVersion: version,
      sessionError: sameSessionErrors > 0,
      gatewayRate: rate ?? -1,
      gatewayVolume: volume,
      secondsToFail: secondsToFail ?? -1,
    };
  });
  await deps.save(rows);
  // After the rows are safely stored. A failing hand-off must not undo or repeat the classification.
  if (deps.emit) await deps.emit(rows).catch(() => undefined);
  return rows.length;
}
