"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SelectDropdown } from "@/components/ui/select-dropdown";
import { RangeSwitcher } from "@/components/range-switcher";
import { errorsHref, filtersWithoutRange, type ErrorFilters, type FilterChange } from "@/lib/errors-url";

const STATUS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
] as const;
const LEVEL = [
  { value: "", label: "Any level" },
  { value: "fatal", label: "Fatal" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];
const SORT = [
  { value: "last_seen", label: "Last seen" },
  { value: "events", label: "Most events" },
  { value: "users", label: "Most users" },
] as const;

/** Filters live in the URL, so a view can be shared and the back button works. Changing one resets paging. */
export function ErrorFilterBar({
  base,
  filters,
  releases,
  environments,
}: {
  base: string;
  filters: ErrorFilters;
  releases: string[];
  environments: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const go = (change: FilterChange) => startTransition(() => router.push(errorsHref(base, filters, change)));
  const options = (all: string[], label: string) => [
    { value: "", label },
    ...all.map((value) => ({ value, label: value })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <SelectDropdown
        ariaLabel="Status"
        value={filters.status}
        options={STATUS}
        onChange={(status) => go({ status })}
        className="w-32"
      />
      <SelectDropdown
        ariaLabel="Release"
        value={filters.release ?? ""}
        options={options(releases, "Any release")}
        onChange={(release) => go({ release: release || undefined })}
        className="w-40"
      />
      <SelectDropdown
        ariaLabel="Environment"
        value={filters.environment ?? ""}
        options={options(environments, "Any environment")}
        onChange={(environment) => go({ environment: environment || undefined })}
        className="w-40"
      />
      <SelectDropdown
        ariaLabel="Level"
        value={filters.level ?? ""}
        options={LEVEL}
        onChange={(level) => go({ level: level || undefined })}
        className="w-32"
      />
      <SelectDropdown ariaLabel="Sort by" value={filters.sort} options={SORT} onChange={(sort) => go({ sort })} className="w-36" />
      <RangeSwitcher range={filters.range} extraQuery={filtersWithoutRange(filters)} />
    </div>
  );
}
