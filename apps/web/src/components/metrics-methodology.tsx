/**
 * Short, honest methodology notes for dashboard surfaces.
 * Privacy-first analytics undercounts vs identity-heavy tools (GA) by design.
 */
export function MetricsMethodology() {
  return (
    <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-400">
      <summary className="cursor-pointer select-none font-medium text-zinc-200">
        How these metrics are calculated
      </summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
        <li>
          <span className="text-zinc-200">Visitors</span> are unique browsers in the selected period,
          identified by a pseudonym that rotates every 24 hours. Someone who returns on several days
          counts once per day, which keeps the data cookieless and unlinkable.
        </li>
        <li>
          <span className="text-zinc-200">Sessions</span> are one visit, shared by all tabs of a browser,
          and end after 30 minutes of inactivity. Multi-device journeys are separate sessions by design.
        </li>
        <li>
          <span className="text-zinc-200">Bounce rate</span> = share of sessions that were not engaged. A
          session is engaged when the visitor viewed two or more pages, was active for 10 seconds or
          more, or triggered an event. <span className="text-zinc-200">Session duration</span> is
          the time a visitor was actively using the page (tab visible, input within the last 30 seconds),
          not the time between the first and last click.
        </li>
        <li>
          <span className="text-zinc-200">Channels and sources</span> are credited to the visit, not each
          page: the first outside referrer and campaign tags decide it, and moving between your own pages
          never counts as a source. A source&apos;s share is of all unique visitors, so a list can add up
          to more than 100% when someone arrived through several sources.
        </li>
        <li>
          Known bots are excluded. Ad blockers, ITP, Safari/Brave, and DNT/consent gates{" "}
          <span className="text-zinc-200">systematically undercount</span> vs Google Analytics —
          that is expected for privacy-first measurement.
        </li>
        <li>
          Web vitals use Google&apos;s web-vitals library, so LCP, CLS, INP, FCP, and TTFB follow the same
          rules as Chrome&apos;s reports and are summarised as the 75th percentile. Sample counts vary by
          metric and browser.
        </li>
      </ul>
    </details>
  );
}
