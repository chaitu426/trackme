import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ReleaseReport, ReportMetric, Unit } from "@trackme/analytics";
import { DEFAULT_RULES } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { loadReleaseReport, parseWindowHours, WINDOW_CHOICES } from "@/lib/release-impact";
import { formatNumber, formatRelativeTime } from "@/lib/format";

const VERDICT: Record<ReleaseReport["verdict"], { label: string; tone: string; summary: string }> = {
  healthy: { label: "Healthy", tone: "border-good/30 bg-good/[0.07] text-good", summary: "No measured metric got meaningfully worse." },
  watch: { label: "Watch", tone: "border-warn/30 bg-warn/[0.07] text-warn", summary: "Something moved the wrong way, but not by much. Look before you act." },
  regressed: { label: "Regressed", tone: "border-bad/30 bg-bad/[0.07] text-bad", summary: "A metric got clearly and measurably worse after this release." },
  collecting: { label: "Collecting data", tone: "border-border bg-white/[0.03] text-zinc-300", summary: "" },
};

function value(unit: Unit, n: number): string {
  if (unit === "percent") return `${(n * 100).toFixed(n >= 0.1 ? 1 : 2)}%`;
  if (unit === "ms") return `${Math.round(n).toLocaleString("en")} ms`;
  return n.toFixed(1);
}

function change(metric: ReportMetric): string {
  if (metric.worseBy === null) return "no baseline";
  const pct = Math.abs(metric.worseBy * 100);
  if (pct < 0.5) return "no change";
  return `${pct.toFixed(0)}% ${metric.worseBy > 0 ? "worse" : "better"}`;
}

function confidence(metric: ReportMetric): string {
  if (metric.p === null) return "not tested";
  if (metric.p < 0.01) return "clear";
  if (metric.p < 0.05) return "likely";
  return "could be noise";
}

export default async function ReleaseReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string; release: string }>;
  searchParams: Promise<{ hours?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain, release: rawRelease } = await params;
  const hours = parseWindowHours((await searchParams).hours);
  const release = decodeURIComponent(rawRelease);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  const base = `/${workspace.slug}/sites/${site.domain}`;

  let report: ReleaseReport | null;
  try {
    report = await loadReleaseReport(site.id, release, hours);
  } catch {
    return (
      <div className="stagger w-full space-y-5 text-left">
        <Card className="py-12 text-center">
          <p className="text-sm text-zinc-300">This report is temporarily unavailable.</p>
          <Link href={`${base}/releases/${encodeURIComponent(release)}`} className="mt-3 inline-block text-xs text-zinc-400 hover:text-zinc-100">Retry</Link>
        </Card>
      </div>
    );
  }
  if (!report) notFound();

  const v = VERDICT[report.verdict];
  const gate = DEFAULT_RULES.minSessions;
  const collecting =
    report.verdict === "collecting"
      ? report.comparable
        ? `Needs ${gate} sessions on each side before judging. ${report.release} has ${formatNumber(report.sessionsAfter)}${
            report.previousRelease ? `; ${report.previousRelease} had ${formatNumber(report.sessionsBefore)}` : ""
          }.`
        : "No earlier release was seen in the period before this deploy, so there is nothing to compare with."
      : null;

  return (
    <div className="w-full space-y-5 text-left">
      <Link href={`${base}/releases`} className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-3.5 w-3.5" /> All releases
      </Link>

      <PageHeader
        title={report.release}
        art="steps"
        actions={
          <div role="group" aria-label="Window" className="flex h-8 items-center gap-0.5 rounded-lg border border-border p-0.5 text-xs text-zinc-400">
            {WINDOW_CHOICES.map((choice) => (
              <Link
                key={choice}
                href={`?hours=${choice}`}
                aria-current={choice === hours ? "true" : undefined}
                className={`inline-flex h-full items-center rounded-md px-3 transition-colors ${choice === hours ? "bg-raised font-medium text-zinc-50" : "hover:text-zinc-100"}`}
              >
                {choice}h
              </Link>
            ))}
          </div>
        }
      >
        Went live {formatRelativeTime(report.deployedAt)}
        {report.previousRelease ? (
          <>
            , compared with <span className="font-mono text-zinc-300">{report.previousRelease}</span>
          </>
        ) : null}
      </PageHeader>

      <div role="status" className={`rounded-xl border px-5 py-4 ${v.tone}`}>
        <p className="text-sm font-semibold">{v.label}</p>
        <p className="mt-1 text-xs text-zinc-300">{collecting ?? v.summary}</p>
        {report.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-200">
            {report.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {report.rollbackSuggested && report.previousRelease && (
          <p className="mt-3 border-t border-border pt-3 text-xs text-zinc-200">
            If this is hurting users right now, rolling back to <span className="font-mono">{report.previousRelease}</span> is worth considering while you
            investigate. This comes from the numbers on this page, not from a diagnosis of the cause.
          </p>
        )}
      </div>

      {report.metrics.length > 0 && (
        <Card className="overflow-hidden px-0 pb-0">
          <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
            <CardTitle>Before and after</CardTitle>
            <CardDescription>
              The first {hours} hours of {report.release} ({formatNumber(report.sessionsAfter)} sessions, so far) against the same length of time before it
              went live on {report.previousRelease ?? "the previous build"} ({formatNumber(report.sessionsBefore)} sessions).
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th scope="col" className="px-5 py-3 font-medium">Metric</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Before</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">After</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Change</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Is it real?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {report.metrics.map((metric) => (
                  <tr key={metric.key}>
                    <th scope="row" className="px-5 py-3 text-left font-normal text-zinc-200">{metric.label}</th>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-zinc-400">{value(metric.unit, metric.before)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-zinc-100">{value(metric.unit, metric.after)}</td>
                    <td className={`px-3 py-3 text-right font-mono tabular-nums ${metric.worseBy !== null && metric.worseBy > 0.005 ? "text-bad" : "text-zinc-300"}`}>
                      {change(metric)}
                    </td>
                    <td className="px-5 py-3 text-right text-zinc-400" title={metric.p === null ? undefined : `p = ${metric.p.toExponential(1)}, n = ${metric.n}`}>
                      {confidence(metric)}
                      {metric.p !== null && <span className="ml-1 text-zinc-600">n={formatNumber(metric.n)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.baseline && (
            <p className="border-t border-white/[0.06] px-5 py-3 text-xs text-zinc-400">
              For comparison, in the same hours a week earlier (all releases, {formatNumber(report.baseline.sessions)} sessions),{" "}
              <span className="font-mono text-zinc-200">{(report.baseline.errorRate * 100).toFixed(report.baseline.errorRate >= 0.1 ? 1 : 2)}%</span> of sessions had an
              error. If this release&apos;s rate is close to that, the difference may be about the time of week, not the deploy.
            </p>
          )}
        </Card>
      )}

      {report.breakdown.length > 0 && (
        <Card className="overflow-hidden px-0 pb-0">
          <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
            <CardTitle>Where it got worse</CardTitle>
            <CardDescription>Groups with enough traffic where the share of sessions with an error clearly rose</CardDescription>
          </CardHeader>
          <ul className="divide-y divide-white/[0.05]">
            {report.breakdown.map((row) => (
              <li key={`${row.dimension}:${row.value}`} className="flex items-center justify-between gap-3 px-5 py-3 text-xs">
                <span className="text-zinc-200">
                  <span className="text-zinc-500">{row.dimension}</span> {row.value}
                </span>
                <span className="font-mono tabular-nums text-zinc-300">
                  {(row.rateBefore * 100).toFixed(1)}% → {(row.rateAfter * 100).toFixed(1)}%{row.ratio ? ` (${row.ratio.toFixed(1)}x)` : ""}
                  <span className="ml-2 text-zinc-600">{formatNumber(row.sessionsAfter)} sessions</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden px-0 pb-0">
          <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
            <CardTitle>New issues in this release</CardTitle>
            <CardDescription>Errors first seen after it went live</CardDescription>
          </CardHeader>
          {report.newIssues.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-zinc-500">No new issues.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {report.newIssues.slice(0, 8).map((issue) => (
                <li key={issue.groupId}>
                  <Link href={`${base}/errors/${issue.groupId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs text-zinc-200 hover:bg-white/[0.03]">
                    <span className="truncate">{issue.title}</span>
                    <span className="shrink-0 font-mono tabular-nums text-zinc-400">{formatNumber(issue.events)} events</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Regressions</CardTitle>
            <CardDescription>Resolved issues that came back in this release</CardDescription>
          </CardHeader>
          <p className="font-mono text-2xl tabular-nums text-zinc-50">{report.regressions}</p>
          {report.regressions > 0 && (
            <Link href={`${base}/errors?release=${encodeURIComponent(report.release)}`} className="mt-2 inline-block text-xs text-zinc-300 underline decoration-white/20 underline-offset-2 hover:decoration-white/60">
              See them in Error Tracking
            </Link>
          )}
        </Card>
      </div>

      <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-400">
        <summary className="cursor-pointer select-none font-medium text-zinc-200">How to read this</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
          <li>
            Sessions on this release in its first {hours} hours are compared with sessions on the previous release in the same amount of time just before. A
            deploy is not an experiment: time of day and weekday differ between the two windows, so treat Watch as a reason to look, not proof.
          </li>
          <li>
            No verdict is shown until each side has {gate} sessions. A metric must be both clearly different (p &lt; 0.01 for Regressed, 0.05 for Watch) and
            at least {DEFAULT_RULES.regressedMinChange * 100}% (Regressed) or {DEFAULT_RULES.watchMinChange * 100}% (Watch) worse, so a trivial change on a lot of traffic is not flagged.
          </li>
          <li>Rates use a two-proportion test and speeds a rank test (Mann-Whitney), which a few very slow visits cannot skew. Speeds are judged at the 75th percentile, as Core Web Vitals are.</li>
          <li>Several metrics are tested at once, so an occasional false alarm is possible; the size threshold keeps it rare.</li>
        </ul>
      </details>
    </div>
  );
}
