"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Graticule,
  Sphere,
} from "react-simple-maps";
import { countryName } from "@/lib/countries";
import { FlagImage } from "@/components/ui/flag-image";
import { COUNTRY_COORDS } from "@/lib/country-coords";

// Natural Earth 110m world topojson (stable CDN)
const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ISO 3166-1 numeric → alpha-2 (deduplicated)
const NUMERIC_TO_ALPHA2: Record<number, string> = {
  4: "AF", 8: "AL", 12: "DZ", 24: "AO", 32: "AR", 36: "AU", 40: "AT",
  50: "BD", 52: "BB", 56: "BE", 68: "BO", 70: "BA", 76: "BR", 90: "SB",
  96: "BN", 100: "BG", 104: "MM", 108: "BI", 116: "KH", 120: "CM",
  124: "CA", 144: "LK", 152: "CL", 156: "CN", 170: "CO", 174: "KM",
  188: "CR", 191: "HR", 192: "CU", 196: "CY", 203: "CZ", 208: "DK",
  214: "DO", 218: "EC", 222: "SV", 231: "ET", 233: "EE", 242: "FJ",
  246: "FI", 250: "FR", 266: "GA", 276: "DE", 288: "GH", 300: "GR",
  320: "GT", 332: "HT", 340: "HN", 348: "HU", 356: "IN", 360: "ID",
  364: "IR", 368: "IQ", 372: "IE", 376: "IL", 380: "IT", 388: "JM",
  392: "JP", 398: "KZ", 400: "JO", 404: "KE", 408: "KP", 410: "KR",
  414: "KW", 417: "KG", 418: "LA", 422: "LB", 428: "LV", 434: "LY",
  440: "LT", 454: "MW", 458: "MY", 484: "MX", 499: "ME", 504: "MA",
  508: "MZ", 516: "NA", 528: "NL", 548: "VU", 554: "NZ", 558: "NI",
  566: "NG", 578: "NO", 586: "PK", 591: "PA", 598: "PG", 604: "PE",
  608: "PH", 616: "PL", 620: "PT", 626: "TL", 630: "PR", 634: "QA",
  642: "RO", 643: "RU", 646: "RW", 682: "SA", 686: "SN", 688: "RS",
  703: "SK", 704: "VN", 705: "SI", 706: "SO", 710: "ZA", 716: "ZW",
  724: "ES", 729: "SD", 752: "SE", 756: "CH", 760: "SY", 762: "TJ",
  764: "TH", 776: "TO", 780: "TT", 784: "AE", 788: "TN", 792: "TR",
  795: "TM", 800: "UG", 804: "UA", 807: "MK", 818: "EG", 826: "GB",
  834: "TZ", 840: "US", 858: "UY", 860: "UZ", 862: "VE", 882: "WS",
  887: "YE", 894: "ZM",
};


type CountryItem = {
  name: string;
  visitors: number;
  percentage: number;
};

/** Markets with visitors are white, brighter the busier they are, on a grey map. */
function interpolateColor(ratio: number): string {
  const v = Math.round(205 + ratio * 50);
  const a = 0.62 + ratio * 0.38;
  return `rgba(${v},${v},${v},${a})`;
}

export function AudienceMap({
  countries,
  selectedCountry,
  range,
}: {
  countries: CountryItem[];
  selectedCountry?: string;
  range: string;
}) {
  const [hoveredCountry, setHoveredCountry] = useState<CountryItem | null>(null);

  const countryMap = useMemo(
    () => new Map(countries.map((c) => [c.name, c])),
    [countries]
  );
  const maxVisitors = useMemo(
    () => Math.max(...countries.map((c) => c.visitors), 1),
    [countries]
  );

  const markered = useMemo(
    () => countries.filter((c) => COUNTRY_COORDS[c.name]),
    [countries]
  );

  return (
    <div className="relative w-full select-none overflow-hidden rounded-xl border border-white/[0.07] bg-sidebar">
      {/* Legend bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 text-xs">
        <div className="flex items-center gap-2 text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
          <span className="font-medium text-zinc-300">Audience Density</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">
            {markered.length} active markets
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-zinc-600">
          <span>Low</span>
          <div className="h-1 w-20 rounded-full bg-gradient-to-r from-[#555555]/40 via-[#828282]/70 to-[#adadad]" />
          <span>High</span>
        </div>
      </div>

      {/* Map canvas */}
      <div
        className="relative"
        onMouseLeave={() => setHoveredCountry(null)}
      >
        <ComposableMap
          projection="geoNaturalEarth1"
          projectionConfig={{ scale: 153, center: [0, 10] }}
          width={960}
          height={490}
          className="w-full"
          style={{ background: "transparent" }}
        >
          {/* Graticule grid */}
          <Graticule
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.6}
            step={[30, 30]}
          />

          {/* Ocean sphere */}
          <Sphere
            id="rsm-sphere"
            fill="#26262a"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={0.5}
          />

          {/* Country choropleth fills */}
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const numericId = parseInt(geo.id as string, 10);
                const alpha2 = NUMERIC_TO_ALPHA2[numericId];
                const countryData = alpha2 ? countryMap.get(alpha2) : undefined;
                const isSelected = alpha2 === selectedCountry;
                const isHovered = alpha2 === hoveredCountry?.name;

                let fill = "#5f5f66";
                let stroke = "rgba(255,255,255,0.14)";

                if (countryData) {
                  const ratio = countryData.visitors / maxVisitors;
                  if (isSelected) {
                    fill = "#ffffff";
                    stroke = "#ededed";
                  } else if (isHovered) {
                    fill = `rgba(255,255,255,${0.85 + ratio * 0.15})`;
                    stroke = "#ededed";
                  } else {
                    fill = interpolateColor(ratio);
                    stroke = "rgba(20,20,21,0.35)";
                  }
                } else if (isSelected) {
                  fill = "#8b8b92";
                  stroke = "#ededed";
                }

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={0.5}
                    style={{ outline: "none" }}
                    className="transition-colors duration-200 cursor-default"
                    onMouseEnter={() => {
                      if (countryData) setHoveredCountry(countryData);
                      else setHoveredCountry(null);
                    }}
                  />
                );
              })
            }
          </Geographies>

          {/* Pulsing dot markers for active countries */}
          {markered.map((country) => {
            const coords = COUNTRY_COORDS[country.name];
            if (!coords) return null;
            const ratio = country.visitors / maxVisitors;
            const r = Math.max(2.8, 2.8 + ratio * 5.2);
            const isSelected = country.name === selectedCountry;
            const isHovered = hoveredCountry?.name === country.name;

            return (
              <Link
                key={country.name}
                href={`?range=${range}&country=${country.name}`}
                onMouseEnter={() => setHoveredCountry(country)}
              >
                <Marker coordinates={coords}>
                  {/* Halo */}
                  <circle
                    r={r * 2.6}
                    fill={isSelected ? "rgba(173,173,173,0.18)" : "rgba(237,237,237,0.1)"}
                  />
                  {/* Main dot */}
                  <circle
                    r={r}
                    fill={isSelected ? "#ffffff" : isHovered ? "#ededed" : "#141415"}
                    stroke="#ededed"
                    strokeWidth={1.2}
                    className="transition-colors duration-150 cursor-pointer"
                  />
                  {/* Center spec */}
                  <circle
                    r={Math.max(1.2, r * 0.38)}
                    fill="white"
                    opacity={isSelected || isHovered ? 1 : 0.75}
                  />
                </Marker>
              </Link>
            );
          })}
        </ComposableMap>

        {/* Floating Tooltip */}
        {hoveredCountry && (
          <div
            className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-white/[0.12] bg-[#121212]/95 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl"
            style={{ minWidth: 180 }}
          >
            <div className="flex items-center gap-3">
              <FlagImage code={hoveredCountry.name} size={28} />
              <div>
                <p className="text-xs font-medium text-zinc-100">
                  {countryName(hoveredCountry.name)}
                </p>
                <p className="text-xs text-zinc-500 font-mono">
                  ISO: {hoveredCountry.name}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-2">
              <div>
                <p className="text-xs text-zinc-500">
                  Visitors
                </p>
                <p className="font-mono text-sm font-medium text-zinc-200">
                  {hoveredCountry.visitors.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">
                  Share
                </p>
                <p className="font-mono text-sm font-medium text-zinc-200">
                  {hoveredCountry.percentage.toFixed(1)}%
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-600">
              Click country dot to filter by region
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-xs text-zinc-500">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 opacity-60" />
          Click any dot to filter analytics by region
        </span>
        {selectedCountry && (
          <span className="font-mono text-zinc-200">
            Filtering: {countryName(selectedCountry)}
          </span>
        )}
      </div>
    </div>
  );
}
