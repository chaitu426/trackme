type BreakdownItem = {
  name: string;
  visitors: number;
  pageviews: number;
  percentage: number;
};

/** Compact vertical intensity bars — used when a list isn't preferred. */
export function AnalyticsSignal({ items }: { items: BreakdownItem[] }) {
  const visibleItems = items.slice(0, 8);
  const maxPageviews = Math.max(...visibleItems.map((item) => item.pageviews), 1);

  if (!visibleItems.length) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-zinc-500">
        Page attention will appear once traffic arrives.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 pb-3 pt-4">
      <div className="flex h-[160px] items-end justify-between gap-1.5">
        {visibleItems.map((item, index) => {
          const height = Math.max(8, Math.round((item.pageviews / maxPageviews) * 100));
          return (
            <div key={item.name} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="relative flex flex-1 items-end justify-center">
                <div className="pointer-events-none absolute bottom-full mb-2 hidden w-max max-w-[150px] rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-200 shadow-float group-hover:block">
                  {item.name}: {item.pageviews.toLocaleString()} pageviews
                </div>
                <div
                  className="w-full max-w-6 rounded-sm bg-blue-500/80"
                  style={{ height: `${height}%` }}
                  title={item.name}
                />
              </div>
              <span className="mt-2 truncate text-center font-mono text-[9px] text-zinc-600">
                {shortLabel(item.name, index)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortLabel(path: string, index: number): string {
  if (path === "/") return "home";
  const label = path.replace(/^\//, "").split("/")[0] || `page ${index + 1}`;
  return label.length > 8 ? `${label.slice(0, 7)}…` : label;
}
