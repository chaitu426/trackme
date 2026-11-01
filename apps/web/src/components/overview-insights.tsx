"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { GeoGlobe } from "@/components/geo-globe";
import { formatNumber } from "@/lib/format";

type Item = { name: string; visitors: number; pageviews: number; percentage: number };

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={`rounded-[5px] px-3 py-1 text-xs font-medium transition-colors ${
            tab.id === value ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The visitor globe. Clicking it opens the Geography page (`href`) for the full breakdown;
 * nothing is filtered on this page.
 */
export function LocationsCard({
  countries,
  range,
  href,
}: {
  countries: Item[];
  range: string;
  href: string;
}) {
  const router = useRouter();
  const countryItems = countries.filter((c) => /^[A-Z]{2}$/.test(c.name));

  return (
    <Card className="reveal">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3 text-left">
        <div>
          <CardTitle>
            Locations
          </CardTitle>
          <CardDescription>{formatNumber(countryItems.length)} countries with visitors</CardDescription>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          Geography <ArrowUpRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <div className="pt-3">
        <GeoGlobe countries={countryItems} range={range} onSelect={() => router.push(href)} height={400} />
      </div>
    </Card>
  );
}

const label = (name: string) => (name ? name.charAt(0).toUpperCase() + name.slice(1) : name);

/** Device type, browser and operating system breakdowns behind one set of tabs. */
export function DevicesCard({ devices, browsers, systems }: { devices: Item[]; browsers: Item[]; systems: Item[] }) {
  const [tab, setTab] = useState<"device" | "browser" | "os">("device");
  const items = { device: devices, browser: browsers, os: systems }[tab];

  return (
    <Card className="reveal">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3 text-left">
        <div>
          <CardTitle>
            Devices
          </CardTitle>
          <CardDescription>What visitors browse on</CardDescription>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "device", label: "Device" },
            { id: "browser", label: "Browser" },
            { id: "os", label: "OS" },
          ]}
        />
      </CardHeader>
      <div className="pt-2">
        <RankingList
          pageSize={8}
          items={items
            .filter((i) => i.name && !i.name.startsWith("("))
            .map((i) => ({
              name: label(i.name),
              value: i.visitors,
              percentage: i.percentage,
            }))}
          empty="No device data in this range yet."
          valueFormatter={formatNumber}
        />
      </div>
    </Card>
  );
}
