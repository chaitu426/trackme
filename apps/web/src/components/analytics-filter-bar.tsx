"use client";

import * as React from "react";
import Link from "next/link";
import { X, Monitor, Smartphone, Tablet, Globe2, ChevronDown, Check } from "lucide-react";
import { countryName } from "@/lib/countries";
import { FlagImage } from "@/components/ui/flag-image";
import type { RangeKey } from "@/lib/date-range";

type Country = { code: string; visitors: number };

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Monitor className="w-3.5 h-3.5" />,
  mobile: <Smartphone className="w-3.5 h-3.5" />,
  tablet: <Tablet className="w-3.5 h-3.5" />,
};

const RANGE_LABELS: Record<RangeKey, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
};

export function AnalyticsFilterBar({
  range,
  country,
  device,
  countries,
  devices,
}: {
  range: RangeKey;
  country?: string;
  device?: string;
  countries: Country[];
  devices: string[];
}) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [countryOpen, setCountryOpen] = React.useState(false);
  const [deviceOpen, setDeviceOpen] = React.useState(false);
  const countryRef = React.useRef<HTMLDivElement>(null);
  const deviceRef = React.useRef<HTMLDivElement>(null);

  const hasFilters = Boolean(country || device);
  const selectedCountry = countries.find((c) => c.code === country);

  // Close on outside click
  React.useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (countryRef.current && !countryRef.current.contains(e.target as Node)) setCountryOpen(false);
      if (deviceRef.current && !deviceRef.current.contains(e.target as Node)) setDeviceOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function navigate(newCountry?: string, newDevice?: string) {
    const params = new URLSearchParams({ range });
    if (newCountry) params.set("country", newCountry);
    if (newDevice) params.set("device", newDevice);
    window.location.search = params.toString();
  }

  return (
    <form ref={formRef} className="flex flex-wrap items-center gap-2" action="" method="get">
      {/* Range pills */}
      <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-xs font-medium text-zinc-400 gap-0.5">
        {(["24h", "7d", "30d"] as RangeKey[]).map((option) => (
          <Link
            key={option}
            href={`?range=${option}${country ? `&country=${country}` : ""}${device ? `&device=${device}` : ""}`}
            className={`rounded-[5px] px-3 py-1.5 transition-colors font-medium ${
              option === range
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "hover:bg-white/[0.04] hover:text-zinc-300 text-zinc-500"
            }`}
          >
            {RANGE_LABELS[option]}
          </Link>
        ))}
      </div>
      <input type="hidden" name="range" value={range} />

      {/* Country dropdown */}
      <div ref={countryRef} className="relative">
        <button
          type="button"
          onClick={() => { setCountryOpen(!countryOpen); setDeviceOpen(false); }}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            country
              ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
              : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.14] hover:bg-white/[0.04]"
          }`}
        >
          {selectedCountry
            ? <FlagImage code={selectedCountry.code} size={16} className="shrink-0" />
            : <Globe2 className="w-3.5 h-3.5" />}
          <span className="max-w-[120px] truncate">
            {selectedCountry ? countryName(selectedCountry.code) : "Country"}
          </span>
          <ChevronDown className={`w-3 h-3 transition-transform ${countryOpen ? "rotate-180" : ""}`} />
        </button>

        {countryOpen && (
          <div className="absolute left-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-white/[0.08] bg-zinc-950 p-1 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6)] overflow-hidden">
            <DropItem
              label="All countries"
              isSelected={!country}
              onClick={() => { navigate(undefined, device); setCountryOpen(false); }}
            />
            <div className="my-1 h-px bg-white/[0.06]" />
            <div className="max-h-52 overflow-y-auto">
              {countries.map((item) => (
                <DropItem
                  key={item.code}
                  label={countryName(item.code)}
                  badge={item.visitors.toLocaleString()}
                  isSelected={country === item.code}
                  flag={item.code}
                  onClick={() => { navigate(item.code, device); setCountryOpen(false); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Device dropdown */}
      <div ref={deviceRef} className="relative">
        <button
          type="button"
          onClick={() => { setDeviceOpen(!deviceOpen); setCountryOpen(false); }}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            device
              ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
              : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.14] hover:bg-white/[0.04]"
          }`}
        >
          {device && DEVICE_ICONS[device] ? DEVICE_ICONS[device] : <Monitor className="w-3.5 h-3.5" />}
          <span className="capitalize">{device ?? "Device"}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${deviceOpen ? "rotate-180" : ""}`} />
        </button>

        {deviceOpen && (
          <div className="absolute left-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-white/[0.08] bg-zinc-950 p-1 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6)]">
            <DropItem
              label="All devices"
              isSelected={!device}
              onClick={() => { navigate(country, undefined); setDeviceOpen(false); }}
            />
            <div className="my-1 h-px bg-white/[0.06]" />
            {devices.map((item) => (
              <DropItem
                key={item}
                label={item}
                icon={DEVICE_ICONS[item]}
                isSelected={device === item}
                capitalize
                onClick={() => { navigate(country, item); setDeviceOpen(false); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <Link
          href={`?range=${range}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-[11px] font-medium text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200 hover:border-white/[0.14]"
        >
          <X className="h-3 w-3" /> Clear
        </Link>
      )}
    </form>
  );
}

function DropItem({
  label,
  badge,
  icon,
  flag,
  isSelected,
  onClick,
  capitalize: cap = false,
}: {
  label: string;
  badge?: string;
  icon?: React.ReactNode;
  flag?: string;
  isSelected: boolean;
  onClick: () => void;
  capitalize?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
        isSelected
          ? "bg-white/[0.08] text-zinc-100 font-semibold"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      }`}
    >
      <span className={`flex items-center gap-2 min-w-0 ${cap ? "capitalize" : ""}`}>
        {flag && <FlagImage code={flag} size={16} className="shrink-0" />}
        {!flag && icon && <span className="shrink-0 text-zinc-500">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        {badge && (
          <span className="font-mono text-[10px] text-zinc-600 tabular-nums">{badge}</span>
        )}
        {isSelected && <Check className="w-3 h-3 text-blue-400" />}
      </span>
    </button>
  );
}
