/**
 * Active time on the page: time the tab is visible and the visitor has done something in the
 * last IDLE_MS (move, click, scroll, type, touch). A tab left open in the background, or a
 * page nobody is touching, stops counting, so the figure is time spent, not time open.
 */
const IDLE_MS = 30_000;
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"] as const;

export class EngagementClock {
  private segmentStart: number | null;
  private lastActivity: number;
  /** Active time already measured but not yet taken: a tab hide closes its segment ahead of the report. */
  private banked = 0;
  private readonly onActivity = () => {
    this.lastActivity = Date.now();
  };
  private readonly onVisibility = () => {
    const now = Date.now();
    if (document.visibilityState === "hidden") {
      // The page reports on this same event; keep the time for that report instead of losing it.
      this.banked += this.take(now);
      this.segmentStart = null;
    } else if (this.segmentStart === null) {
      this.segmentStart = now;
      this.lastActivity = now;
    }
  };

  constructor() {
    const now = Date.now();
    this.lastActivity = now;
    this.segmentStart = document.visibilityState === "hidden" ? null : now;
    for (const type of ACTIVITY) window.addEventListener(type, this.onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Milliseconds of active time since the last call. */
  public take(now = Date.now()): number {
    const banked = this.banked;
    this.banked = 0;
    if (this.segmentStart === null) return banked;
    const elapsed = now - this.segmentStart;
    const allowed = this.lastActivity + IDLE_MS - this.segmentStart;
    this.segmentStart = now;
    return banked + Math.max(0, Math.min(elapsed, allowed));
  }

  public stop(): void {
    for (const type of ACTIVITY) window.removeEventListener(type, this.onActivity, { capture: true });
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
