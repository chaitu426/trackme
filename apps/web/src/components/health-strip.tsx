import { cn } from "@/lib/utils";

export interface StripBucket {
  startMs: number;
  paid: number;
  failed: number;
}

/** Colour by what the bucket's payments did. Quiet when healthy, so a bad stretch is the only thing that stands out. */
export function bucketTone(b: StripBucket): "empty" | "ok" | "warn" | "bad" {
  const total = b.paid + b.failed;
  if (total === 0) return "empty";
  const rate = b.paid / total;
  if (total >= 3 && rate < 0.5) return "bad";
  if (total >= 3 && rate < 0.85) return "warn";
  return "ok";
}

const TONE_CLASS = { empty: "bg-white/[0.05]", ok: "bg-zinc-400", warn: "bg-warn", bad: "bg-bad" } as const;
const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * The gateway's last six hours, one bar per five minutes. Height is how many payments finished, colour is how they went, so
 * a quiet night and an outage look different. Every bar has its own hover text and the strip has a text summary for screen readers.
 */
export function HealthStrip({ buckets }: { buckets: StripBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.paid + b.failed), 1);
  const bad = buckets.filter((b) => bucketTone(b) === "bad").length;
  return (
    <div>
      <div
        role="img"
        aria-label={`Last six hours in five-minute steps. ${bad === 0 ? "No stretch fell below half." : `${bad} five-minute stretches fell below half.`}`}
        className="flex h-12 items-end gap-[3px]"
      >
        {buckets.map((b) => {
          const total = b.paid + b.failed;
          const tone = bucketTone(b);
          return (
            <div
              key={b.startMs}
              title={total === 0 ? `${time(b.startMs)}: no payments` : `${time(b.startMs)}: ${b.paid} of ${total} succeeded`}
              className={cn("min-w-0 flex-1 rounded-[2px]", TONE_CLASS[tone])}
              style={{ height: total === 0 ? "12%" : `${Math.max(22, (total / max) * 100)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-zinc-600">
        <span>{time(buckets[0]?.startMs ?? 0)}</span>
        <span>now</span>
      </div>
    </div>
  );
}
