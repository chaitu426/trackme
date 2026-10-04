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

// Country centroid coordinates [lng, lat]
const COUNTRY_COORDS: Record<string, [number, number]> = {
  US: [-98.5, 39.8], CA: [-106.3, 56.1], MX: [-102.5, 23.6],
  BR: [-51.9, -14.2], AR: [-63.6, -38.4], CL: [-71.5, -35.6],
  CO: [-74.2, 4.5], PE: [-75.0, -9.1], VE: [-66.6, 8.0], UY: [-55.7, -32.5],
  BO: [-64.9, -16.3], EC: [-77.4, -1.8], PY: [-58.4, -23.4],
  GB: [-3.4, 55.3], IE: [-8.2, 53.4], FR: [2.2, 46.2], DE: [10.4, 51.1],
  ES: [-3.7, 40.4], IT: [12.5, 41.8], NL: [5.2, 52.1], BE: [4.4, 50.5],
  CH: [8.2, 46.8], AT: [14.5, 47.5], SE: [18.6, 60.1], NO: [8.4, 60.4],
  FI: [25.7, 61.9], DK: [9.5, 56.2], PL: [19.1, 51.9], CZ: [15.4, 49.8],
  RO: [24.9, 45.9], GR: [21.8, 39.0], TR: [35.2, 38.9], UA: [31.1, 48.3],
  PT: [-8.2, 39.3], RU: [65.0, 58.0], HU: [19.5, 47.1], SK: [19.6, 48.7],
  HR: [16.4, 45.1], RS: [21.0, 44.0], SI: [14.9, 46.1], BG: [25.0, 42.7],
  EE: [25.0, 58.6], LV: [24.9, 56.8], LT: [23.9, 55.2],
  NG: [8.6, 9.0], ZA: [22.9, -30.5], EG: [30.8, 26.8], KE: [37.9, -0.02],
  GH: [-1.0, 7.9], MA: [-7.0, 31.7], ET: [40.5, 9.1], TZ: [35.0, -6.4],
  MZ: [35.5, -18.7], ZW: [29.2, -20.0], ZM: [27.8, -13.1], CM: [12.3, 5.7],
  SN: [-14.4, 14.5], SD: [30.2, 12.8], TN: [9.5, 33.8], DZ: [3.0, 28.0],
  LY: [17.2, 26.3],
  IN: [78.9, 20.5], PK: [69.3, 30.3], BD: [90.3, 23.6], AE: [53.8, 23.4],
  SA: [45.0, 23.8], IL: [34.8, 31.0], SG: [103.8, 1.35], MY: [101.9, 4.2],
  TH: [100.9, 15.8], VN: [108.2, 14.0], PH: [121.7, 12.8], ID: [113.9, -0.78],
  CN: [104.1, 35.8], JP: [138.2, 36.2], KR: [127.7, 35.9], TW: [120.9, 23.6],
  HK: [114.1, 22.3], AU: [133.7, -25.2], NZ: [174.8, -40.9],
  KZ: [66.9, 48.0], UZ: [63.9, 41.3], IR: [53.7, 32.4], IQ: [43.7, 33.2],
  JO: [36.2, 31.2], LB: [35.5, 33.9], QA: [51.2, 25.4], KW: [47.5, 29.3],
  DO: [-70.1, 18.9], GT: [-90.2, 15.7], HN: [-86.2, 15.2],
  CR: [-84.0, 9.7], PA: [-80.0, 8.4],
};

type CountryItem = {
  name: string;
  visitors: number;
  percentage: number;
};

function interpolateColor(ratio: number): string {
  const r = Math.round(30 + ratio * 30);
  const g = Math.round(60 + ratio * 100);
  const b = Math.round(140 + ratio * 115);
  const a = 0.25 + ratio * 0.75;
  return `rgba(${r},${g},${b},${a})`;
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
    <div className="relative w-full select-none overflow-hidden rounded-xl border border-white/[0.07] bg-[#070810]">
      {/* Legend bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5 text-[11px]">
        <div className="flex items-center gap-2 text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_6px_#60a5fa]" />
          <span className="font-medium text-zinc-300">Audience Density</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">
            {markered.length} active markets
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-zinc-600">
          <span>Low</span>
          <div className="h-1 w-20 rounded-full bg-gradient-to-r from-[#1e3c8c]/40 via-[#2d6fd6]/70 to-[#60a5fa]" />
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
            stroke="rgba(255,255,255,0.035)"
            strokeWidth={0.6}
            step={[30, 30]}
          />

          {/* Ocean sphere */}
          <Sphere
            id="rsm-sphere"
            fill="#080a14"
            stroke="rgba(255,255,255,0.06)"
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

                let fill = "#0e1020";
                let stroke = "rgba(255,255,255,0.07)";

                if (countryData) {
                  const ratio = countryData.visitors / maxVisitors;
                  if (isSelected) {
                    fill = `rgba(96,165,250,${0.45 + ratio * 0.3})`;
                    stroke = "#93c5fd";
                  } else if (isHovered) {
                    fill = `rgba(147,197,253,${0.35 + ratio * 0.3})`;
                    stroke = "#60a5fa";
                  } else {
                    fill = interpolateColor(ratio);
                    stroke = "rgba(100,160,255,0.2)";
                  }
                } else if (isSelected) {
                  fill = "rgba(96,165,250,0.15)";
                  stroke = "#60a5fa";
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
                    fill={isSelected ? "rgba(96,165,250,0.18)" : "rgba(59,130,246,0.1)"}
                    className={isSelected ? "animate-ping" : ""}
                  />
                  {/* Main dot */}
                  <circle
                    r={r}
                    fill={isSelected ? "#93c5fd" : isHovered ? "#60a5fa" : "#3b82f6"}
                    stroke="#080a14"
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
            className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-white/[0.12] bg-[#0c0d18]/95 px-4 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl"
            style={{ minWidth: 180 }}
          >
            <div className="flex items-center gap-2.5">
              <FlagImage code={hoveredCountry.name} size={28} />
              <div>
                <p className="text-xs font-semibold text-zinc-100">
                  {countryName(hoveredCountry.name)}
                </p>
                <p className="text-[10px] text-zinc-500 font-mono">
                  ISO: {hoveredCountry.name}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-2">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Visitors
                </p>
                <p className="font-mono text-sm font-bold text-blue-400">
                  {hoveredCountry.visitors.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Share
                </p>
                <p className="font-mono text-sm font-bold text-zinc-200">
                  {hoveredCountry.percentage.toFixed(1)}%
                </p>
              </div>
            </div>
            <p className="mt-1.5 text-[9px] text-zinc-600">
              Click country dot to filter by region
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 opacity-60" />
          Click any dot to filter analytics by region
        </span>
        {selectedCountry && (
          <span className="font-mono text-blue-400">
            Filtering: {countryName(selectedCountry)}
          </span>
        )}
      </div>
    </div>
  );
}
