import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GlyphMeter } from "@/components/ui/glyph-meter";
import { PlanBadge } from "@/components/plan/plan-badge";
import type { WorkspaceUsage } from "@/lib/tenancy";

/** The month's events against the company's quota, in the same glyph meter the billing page uses. */
export function UsageQuotaCard({ usage, workspaceSlug }: { usage: WorkspaceUsage; workspaceSlug: string }) {
  const { plan, monthlyQuota, currentUsage, status, period } = usage;

  const badgeVariant = status === "exceeded" || status === "warning" ? "warning" : "success";
  const badgeText = status === "exceeded" ? "Quota exceeded" : status === "warning" ? "Near capacity (80% or more)" : "Healthy";

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              Event usage
              <PlanBadge plan={plan} />
            </CardTitle>
            <CardDescription>Events counted for {period}, shared by every workspace in the company.</CardDescription>
          </div>
          <Badge variant={badgeVariant}>{badgeText}</Badge>
        </div>
      </CardHeader>

      <div className="space-y-3">
        <GlyphMeter label="Events this month" value={currentUsage} limit={monthlyQuota} unit="events" cells={36} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span>Resets on the 1st of each month.</span>
          <Link href={`/${workspaceSlug}/settings/billing`} className="text-zinc-300 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60">
            Plan & billing
          </Link>
        </div>
      </div>
    </Card>
  );
}
