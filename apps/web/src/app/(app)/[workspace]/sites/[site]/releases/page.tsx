import Link from "next/link";
import { notFound } from "next/navigation";
import { Rocket } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { listReleases } from "@/lib/release-impact";
import { formatNumber, formatRelativeTime } from "@/lib/format";

export default async function ReleasesPage({ params }: { params: Promise<{ workspace: string; site: string }> }) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  const base = `/${workspace.slug}/sites/${site.domain}/releases`;

  let releases: Awaited<ReturnType<typeof listReleases>> = [];
  let failed = false;
  try {
    releases = await listReleases(site.id);
  } catch {
    failed = true;
  }

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Release Impact" art="steps">
        Did a deploy make <span className="font-mono text-zinc-300">{site.domain}</span> better or worse? Pick a release to compare its first hours with the
        build it replaced.
      </PageHeader>

      {failed ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-zinc-300">Releases are temporarily unavailable.</p>
          <p className="mt-1 text-xs text-zinc-500">Reload in a moment.</p>
        </Card>
      ) : releases.length === 0 ? (
        <Card className="mx-auto max-w-2xl space-y-4 py-10 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400">
            <Rocket className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-zinc-100">No releases yet</h3>
            <p className="mx-auto max-w-md text-xs leading-relaxed text-zinc-400">
              Tag each build with <code className="font-mono">data-release=&quot;web@1.4.2&quot;</code> in the tracker snippet. Once visitors arrive on two
              different releases, this page can compare them. Reporting the deploy from CI makes the start time exact.
            </p>
          </div>
          <div className="mx-auto flex max-w-xl items-center gap-2 rounded-lg border border-border bg-black/40 p-3 text-left">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-300">
              {`<script defer src="…/tracker.js" data-site="YOUR_SITE_KEY" data-endpoint="…" data-release="web@1.4.2"></script>`}
            </code>
            <CopyButton text={`data-release="web@1.4.2"`} variant="ghost" />
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="hidden grid-cols-[minmax(0,1fr)_140px_110px_90px] gap-4 border-b border-white/[0.06] px-5 py-3 text-xs text-zinc-500 md:grid">
            <span>Release</span>
            <span>Went live</span>
            <span className="text-right">Sessions (90d)</span>
            <span />
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {releases.map((item, i) => (
              <li key={item.release}>
                <Link
                  href={`${base}/${encodeURIComponent(item.release)}`}
                  className="grid grid-cols-1 gap-1 px-5 py-3.5 transition-colors hover:bg-white/[0.03] md:grid-cols-[minmax(0,1fr)_140px_110px_90px] md:items-center md:gap-4"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[13px] text-zinc-100">{item.release}</span>
                    {i === 0 && <span className="rounded border border-border px-1.5 py-px text-[11px] text-zinc-300">Latest</span>}
                    {item.commit && <span className="truncate font-mono text-xs text-zinc-500">{item.commit.slice(0, 8)}</span>}
                  </span>
                  <span className="text-xs text-zinc-400" title={new Date(item.at).toLocaleString()}>
                    {formatRelativeTime(item.at)}
                    <span className="ml-1 text-zinc-600">{item.source === "deploy" ? "· reported" : "· first session"}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-zinc-300 md:text-right">{formatNumber(item.sessions)}</span>
                  <span className="text-xs font-medium text-zinc-200 md:text-right">See impact</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
