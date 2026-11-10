import type { ErrorStatus } from "@trackme/contracts";

const LEVEL_STYLE: Record<string, string> = {
  fatal: "border-bad/40 bg-bad/15 text-bad",
  error: "border-bad/25 bg-bad/10 text-bad",
  warning: "border-warn/25 bg-warn/10 text-warn",
  info: "border-border bg-white/[0.04] text-zinc-300",
};

/** Level as a word, not only a colour, so it reads without colour vision. */
export function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[11px] font-medium capitalize ${LEVEL_STYLE[level] ?? LEVEL_STYLE.info}`}>
      {level}
    </span>
  );
}

/** Open issues show nothing extra; resolved, ignored and regressed ones say so in words. */
export function ErrorStatusChip({ status, regressedIn }: { status: ErrorStatus; regressedIn: string | null }) {
  if (regressedIn !== null) {
    return (
      <span className="rounded-md border border-bad/30 bg-bad/10 px-1.5 py-px text-[11px] font-medium text-bad">
        Regressed{regressedIn ? ` in ${regressedIn}` : ""}
      </span>
    );
  }
  if (status === "resolved") {
    return <span className="rounded-md border border-good/25 bg-good/10 px-1.5 py-px text-[11px] font-medium text-good">Resolved</span>;
  }
  if (status === "ignored") {
    return <span className="rounded-md border border-border bg-white/[0.04] px-1.5 py-px text-[11px] font-medium text-zinc-400">Ignored</span>;
  }
  return null;
}
