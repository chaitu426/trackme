"use client";

import { MenuPanel } from "@/components/ui/menu-panel";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Monitor, Smartphone, Tablet, Globe2, ChevronDown, Check } from "lucide-react";
import { countryName } from "@/lib/countries";
import { FlagImage } from "@/components/ui/flag-image";
import { RangeSwitcher } from "@/components/range-switcher";
import type { RangeKey } from "@/lib/date-range";

type Country = { code: string; visitors: number };

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Monitor className="w-3.5 h-3.5" />,
  mobile: <Smartphone className="w-3.5 h-3.5" />,
  tablet: <Tablet className="w-3.5 h-3.5" />,
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
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
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
    startTransition(() => router.push(`?${params.toString()}`));
  }

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2"
      action=""
      method="get"
      aria-busy={isPending}
    >
      {/* Range pills */}
      <RangeSwitcher
        range={range}
        extraQuery={`${country ? `&country=${country}` : ""}${device ? `&device=${device}` : ""}`}
      />
      <input type="hidden" name="range" value={range} />

      {/* Country dropdown */}
      <div ref={countryRef} className="relative">
        <button
          type="button"
          onClick={() => { setCountryOpen(!countryOpen); setDeviceOpen(false); }}
          className={`flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
            country
              ? "border-white/[0.25] bg-white/[0.07] text-zinc-100"
              : "border-border text-zinc-400 hover:border-white/[0.16] hover:text-zinc-100"
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

        <MenuPanel open={countryOpen} className="left-0 top-full mt-2 w-56 overflow-hidden p-1">
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
        </MenuPanel>
      </div>

      {/* Device dropdown */}
      <div ref={deviceRef} className="relative">
        <button
          type="button"
          onClick={() => { setDeviceOpen(!deviceOpen); setCountryOpen(false); }}
          className={`flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
            device
              ? "border-white/[0.25] bg-white/[0.07] text-zinc-100"
              : "border-border text-zinc-400 hover:border-white/[0.16] hover:text-zinc-100"
          }`}
        >
          {device && DEVICE_ICONS[device] ? DEVICE_ICONS[device] : <Monitor className="w-3.5 h-3.5" />}
          <span className="capitalize">{device ?? "Device"}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${deviceOpen ? "rotate-180" : ""}`} />
        </button>

        <MenuPanel open={deviceOpen} className="left-0 top-full mt-2 w-44 p-1">
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
        </MenuPanel>
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <Link
          href={`?range=${range}`}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200 hover:border-white/[0.14]"
        >
          <X className="h-4 w-4" /> Clear
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
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
        isSelected
          ? "bg-white/[0.08] text-zinc-100 font-medium"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      }`}
    >
      <span className={`flex items-center gap-2 min-w-0 ${cap ? "capitalize" : ""}`}>
        {flag && <FlagImage code={flag} size={16} className="shrink-0" />}
        {!flag && icon && <span className="shrink-0 text-zinc-500">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {badge && (
          <span className="font-mono text-xs text-zinc-600 tabular-nums">{badge}</span>
        )}
        {isSelected && <Check className="w-3 h-3 text-zinc-200" />}
      </span>
    </button>
  );
}
