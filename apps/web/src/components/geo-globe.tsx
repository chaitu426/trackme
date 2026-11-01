"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { COUNTRY_COORDS } from "@/lib/country-coords";
import { countryName } from "@/lib/countries";
import { formatNumber } from "@/lib/format";
import { FlagImage } from "@/components/ui/flag-image";

/** Shown while three.js and the country polygons download and the first frame is built. */
function GlobeLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0c0c0c]"
    >
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-zinc-300" />
      <div className="text-center">
        <p className="text-xs font-medium text-zinc-300">Loading globe</p>
        <p className="mt-0.5 text-xs text-zinc-600">Preparing the 3D map, this only takes a moment</p>
      </div>
    </div>
  );
}

// three.js and the country polygons are heavy and need the browser: their own chunk.
const World = dynamic(() => import("@/components/ui/globe").then((m) => m.World), {
  ssr: false,
  loading: () => <GlobeLoader />,
});

type CountryItem = { name: string; visitors: number; percentage: number };


const config = {
  pointSize: 3,
  globeColor: "#3a3a40",
  showAtmosphere: true,
  atmosphereColor: "#ededed",
  atmosphereAltitude: 0.14,
  emissive: "#303036",
  emissiveIntensity: 0.55,
  shininess: 0.6,
  polygonColor: "rgba(214,214,220,0.55)",
  ambientLight: "#d0d0d4",
  directionalLeftLight: "#f0f0f0",
  directionalTopLight: "#dedede",
  pointLight: "#c8c8c8",
  arcTime: 1400,
  arcLength: 0.9,
  rings: 1,
  maxRings: 3,
  autoRotate: true,
  autoRotateSpeed: 0.6,
};

/**
 * Visitors by country on a rotating globe: an arc from the busiest market to each of the others.
 * Hovering a country shows its numbers. Clicking one calls `onSelect` when given; the globe itself
 * never changes the URL, so picking a country here does not touch the page's filters.
 */
export function GeoGlobe({
  countries,
  selectedCountry,
  range,
  onSelect,
  height = 420,
}: {
  countries: CountryItem[];
  selectedCountry?: string | undefined;
  range: string;
  onSelect?: (code: string) => void;
  height?: number;
}) {
  const located = useMemo(() => countries.filter((c) => COUNTRY_COORDS[c.name]), [countries]);
  const hub = selectedCountry ? located.find((c) => c.name === selectedCountry) ?? located[0] : located[0];
  const byCode = useMemo(() => new Map(countries.map((c) => [c.name, c])), [countries]);
  const stats = useMemo(() => {
    const max = Math.max(...countries.map((c) => c.visitors), 1);
    return Object.fromEntries(countries.map((c) => [c.name, c.visitors / max]));
  }, [countries]);

  // No arcs between countries: the globe only tints and highlights markets.
  const arcs = useMemo(() => [], []);

  const globeConfig = useMemo(() => {
    const [lng, lat] = (hub ? COUNTRY_COORDS[hub.name] : undefined) ?? [0, 20];
    return { ...config, initialPosition: { lat, lng } };
  }, [hub]);

  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ code: string; x: number; y: number } | null>(null);

  const onHover = useCallback((code: string | null, clientX: number, clientY: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!code || !box) return setTip(null);
    setTip({ code, x: clientX - box.left, y: clientY - box.top });
  }, []);

  if (!hub) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-white/[0.08] bg-sidebar text-xs text-zinc-500"
        style={{ height }}
      >
        Location data will appear after your first visitors arrive.
      </div>
    );
  }

  const tipItem = tip ? byCode.get(tip.code) : undefined;

  return (
    <div
      ref={frame}
      className="relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-sidebar"
      style={{ height }}
    >
      <div className="absolute inset-0">
        <World
          data={arcs}
          globeConfig={globeConfig}
          countryStats={stats}
          activeCountry={selectedCountry ?? null}
          onCountryHover={onHover}
          {...(onSelect ? { onCountryClick: onSelect } : {})}
        />
      </div>
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/[0.1] bg-zinc-900/80 px-3 py-2 backdrop-blur">
        <p className="text-xs font-medium text-zinc-500">Busiest market</p>
        <p className="text-xs font-medium text-zinc-100">
          {countryName(hub.name)} <span className="font-mono text-zinc-400">· {formatNumber(hub.visitors)}</span>
        </p>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 text-xs text-zinc-500">
        {located.length} active markets · drag to rotate · hover a country
      </p>
      {selectedCountry && !onSelect && (
        <Link
          href={`?range=${range}`}
          className="absolute right-3 top-3 rounded-md border border-white/[0.1] bg-zinc-900/80 px-2 py-1 text-xs text-zinc-300 hover:text-white"
        >
          Show all markets
        </Link>
      )}

      {tip && (
        <div
          className="pointer-events-none absolute z-20 min-w-[160px] -translate-x-1/2 -translate-y-[115%] rounded-xl border border-white/[0.12] bg-[#121212]/95 px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          style={{ left: Math.min(Math.max(tip.x, 90), (frame.current?.clientWidth ?? 400) - 90), top: tip.y }}
        >
          <div className="flex items-center gap-2">
            <FlagImage code={tip.code} size={20} />
            <p className="text-xs font-medium text-zinc-100">{countryName(tip.code)}</p>
          </div>
          {tipItem ? (
            <div className="mt-2 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-2">
              <div>
                <p className="text-xs text-zinc-500">Visitors</p>
                <p className="font-mono text-sm font-medium text-zinc-200">{formatNumber(tipItem.visitors)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">Share</p>
                <p className="font-mono text-sm font-medium text-zinc-200">{tipItem.percentage.toFixed(1)}%</p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">No visitors in this range</p>
          )}
        </div>
      )}
    </div>
  );
}
