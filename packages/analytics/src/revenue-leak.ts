import { compareRates } from "./stats.js";

/**
 * How much money an issue (an error group) is costing, from checkout sessions.
 *
 * Two numbers, deliberately both shown:
 *   associated   the sessions that saw the issue and did not pay, times the average order value. What was not collected from
 *                those sessions. An upper bound: some of them would not have paid anyway.
 *   incremental  how much lower the issue's sessions converted than comparable sessions without it, times the sessions, times
 *                the average order value. What the issue plausibly cost beyond normal drop-off. Zero when the issue's sessions
 *                converted as well as the others.
 * A figure is only published when there are enough sessions on both sides; below that the result is "too few" and carries no money.
 */
export const MIN_AFFECTED = 20;
export const MIN_CONTROL = 30;

export type Confidence = "high" | "medium" | "low";

export interface LeakInput {
  /** Checkout sessions in the window, and how many of them paid. */
  total: number;
  totalPaid: number;
  /** Of those, the sessions that saw the issue, and how many of them paid. */
  affected: number;
  affectedPaid: number;
  /** Average captured order value in minor units. */
  aovMinor: number;
}

export interface LeakEstimate {
  /** False when there were too few sessions to say anything. */
  enough: boolean;
  affectedConversion: number;
  controlConversion: number;
  associatedLossMinor: number;
  incrementalLossMinor: number;
  /** Two-sided p-value of the difference in conversion. */
  p: number;
  confidence: Confidence;
}

export function estimateLeak(i: LeakInput): LeakEstimate {
  const control = i.total - i.affected;
  const controlPaid = i.totalPaid - i.affectedPaid;
  const enough = i.affected >= MIN_AFFECTED && control >= MIN_CONTROL && i.aovMinor > 0;
  const affectedConversion = i.affected > 0 ? i.affectedPaid / i.affected : 0;
  const controlConversion = control > 0 ? controlPaid / control : 0;
  if (!enough) {
    return { enough: false, affectedConversion, controlConversion, associatedLossMinor: 0, incrementalLossMinor: 0, p: 1, confidence: "low" };
  }
  const associated = (i.affected - i.affectedPaid) * i.aovMinor;
  const gap = Math.max(0, controlConversion - affectedConversion);
  const incremental = gap * i.affected * i.aovMinor;
  const test = compareRates(controlPaid, control, i.affectedPaid, i.affected);
  const confidence: Confidence = gap > 0 && i.affected >= 100 && test.p < 0.01 ? "high" : gap > 0 && i.affected >= 30 && test.p < 0.05 ? "medium" : "low";
  return { enough: true, affectedConversion, controlConversion, associatedLossMinor: Math.round(associated), incrementalLossMinor: Math.round(incremental), p: test.p, confidence };
}
