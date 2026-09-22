import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WorkspaceUsage } from "@/lib/tenancy";

export function UsageQuotaCard({ usage }: { usage: WorkspaceUsage }) {
  const { plan, monthlyQuota, currentUsage, percentageUsed, status, period } = usage;

  const barColor =
    status === "exceeded"
      ? "bg-rose-500"
      : status === "warning"
      ? "bg-amber-400"
      : "bg-zinc-900";

  const badgeVariant =
    status === "exceeded" || status === "warning" ? "warning" : "success";

  const badgeText =
    status === "exceeded"
      ? "Quota Exceeded"
      : status === "warning"
      ? "Near Capacity (≥80%)"
      : "Healthy";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Plan Usage & Event Quota</CardTitle>
            <CardDescription>
              Telemetry ingested for current billing cycle — {period}
            </CardDescription>
          </div>
          <Badge variant={badgeVariant}>{badgeText}</Badge>
        </div>
      </CardHeader>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">
            Plan: <span className="text-zinc-800 font-semibold capitalize">{plan}</span>
          </span>
          <span className="font-mono font-semibold text-zinc-900">
            {currentUsage.toLocaleString()}{" "}
            <span className="text-zinc-400 font-normal">
              / {monthlyQuota.toLocaleString()} events ({percentageUsed}%)
            </span>
          </span>
        </div>

        {/* Progress Track */}
        <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200/60">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${Math.min(percentageUsed, 100)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>Synced from ClickHouse · Redis gate enforces limit</span>
          <span>Resets 1st of each month</span>
        </div>
      </div>
    </Card>
  );
}
