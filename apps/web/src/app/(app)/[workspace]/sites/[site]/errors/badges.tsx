import type { ErrorStatus } from "@trackme/contracts";

const LEVEL_STYLE: Record<string, string> = {
  fatal: "border-[#e5484d]/40 bg-[#e5484d]/15 text-[#e5484d]",
  error: "border-[#e5484d]/25 bg-[#e5484d]/10 text-[#e5484d]",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-400",
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
      <span className="rounded-md border border-[#e5484d]/30 bg-[#e5484d]/10 px-1.5 py-px text-[11px] font-medium text-[#e5484d]">
        Regressed{regressedIn ? ` in ${regressedIn}` : ""}
      </span>
    );
  }
  if (status === "resolved") {
    return <span className="rounded-md border border-[#4cc38a]/25 bg-[#4cc38a]/10 px-1.5 py-px text-[11px] font-medium text-[#4cc38a]">Resolved</span>;
  }
  if (status === "ignored") {
    return <span className="rounded-md border border-border bg-white/[0.04] px-1.5 py-px text-[11px] font-medium text-zinc-400">Ignored</span>;
  }
  return null;
}
