/**
 * Short, honest methodology notes for dashboard surfaces.
 * Privacy-first analytics undercounts vs identity-heavy tools (GA) by design.
 */
export function MetricsMethodology() {
  return (
    <details className="rounded-lg border border-slate-800 bg-[#0f121d] px-4 py-3 text-sm text-slate-400">
      <summary className="cursor-pointer select-none font-medium text-slate-300">
        How these metrics are calculated
      </summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
        <li>
          <span className="text-slate-300">Visitors</span> are{" "}
          <code className="text-xs text-slate-400">uniqExact</code> over the selected period using a
          rotating daily pseudonym (localStorage). Returning users across days count once in the
          range — we never sum daily uniques.
        </li>
        <li>
          <span className="text-slate-300">Sessions</span> use a{" "}
          <code className="text-xs text-slate-400">sessionStorage</code> id (ends when the tab
          closes). Multi-device and overnight journeys are separate sessions by design.
        </li>
        <li>
          <span className="text-slate-300">Bounce rate</span> = share of sessions with exactly one
          pageview. <span className="text-slate-300">Duration</span> = time between first and last
          event in a session (heuristic, not wall-clock engagement). Ranges over 48h read bounce /
          duration from daily engagement rollups; short windows query raw events.
        </li>
        <li>
          Known bots are excluded. Ad blockers, ITP, Safari/Brave, and DNT/consent gates{" "}
          <span className="text-slate-300">systematically undercount</span> vs Google Analytics —
          that is expected for privacy-first measurement.
        </li>
        <li>
          Web vitals report LCP, CLS, INP, FCP, and TTFB when the browser supports each observer —
          sample counts vary by metric and client.
        </li>
      </ul>
    </details>
  );
}
