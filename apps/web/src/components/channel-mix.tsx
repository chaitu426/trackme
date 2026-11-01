import { Compass } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { CHANNEL_COLORS, CHANNEL_HINTS } from "@/lib/channels";

type Item = { name: string; visitors: number; pageviews: number; percentage: number };

/**
 * Where visitors came from, grouped into marketing channels. The bar shows each channel's
 * slice of all channel arrivals; the figure beside a channel is its share of unique visitors,
 * so the two can differ when the same visitor arrived through more than one channel.
 */
export function ChannelMix({ items, totalVisitors }: { items: Item[]; totalVisitors: number }) {
  const sum = items.reduce((acc, item) => acc + item.visitors, 0);

  return (
    <Card className="reveal">
      <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
        <div>
          <CardTitle>
            <Compass className="h-4 w-4 text-zinc-200" />
            Traffic channels
          </CardTitle>
          <CardDescription>How visitors reached the site, from referrer and campaign tags</CardDescription>
        </div>
        <span className="font-mono text-xs font-medium text-zinc-500">
          {formatNumber(totalVisitors)} visitors
        </span>
      </CardHeader>

      {items.length === 0 ? (
        <p className="py-10 text-center text-xs text-zinc-500">Channels appear once visitors arrive.</p>
      ) : (
        <div className="space-y-4 pt-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/[0.05]" role="img" aria-label="Share of visits by channel">
            {items.map((item) => (
              <span
                key={item.name}
                title={`${item.name}: ${formatNumber(item.visitors)} visitors`}
                className="h-full"
                style={{ width: `${sum > 0 ? (item.visitors / sum) * 100 : 0}%`, background: CHANNEL_COLORS[item.name] ?? "#71717a" }}
              />
            ))}
          </div>

          <ul className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.name} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.035]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CHANNEL_COLORS[item.name] ?? "#71717a" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-tight text-zinc-200">{item.name}</p>
                  <p className="truncate text-xs text-zinc-500">{CHANNEL_HINTS[item.name] ?? ""}</p>
                </div>
                <div className="shrink-0 text-right font-mono tabular-nums">
                  <p className="text-xs font-medium text-zinc-300">{formatNumber(item.visitors)}</p>
                  <p className="text-xs text-zinc-600">{item.percentage.toFixed(item.percentage >= 10 ? 0 : 1)}%</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
