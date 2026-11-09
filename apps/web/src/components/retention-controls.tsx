"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SelectDropdown } from "@/components/ui/select-dropdown";
import { retentionHref, type RetentionView, type ViewChange } from "@/lib/retention-url";

const GRANULARITY = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
] as const;

/** Granularity, how a cohort starts, and what counts as coming back. The choice lives in the URL. */
export function RetentionControls({
  base,
  view,
  events,
  segments,
}: {
  base: string;
  view: RetentionView;
  events: string[];
  segments: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const go = (change: ViewChange) => startTransition(() => router.push(retentionHref(base, view, change)));
  const withCurrent = (current?: string) => (current && !events.includes(current) ? [current, ...events] : events);
  const options = (current: string | undefined, none: string) => [
    { value: "", label: none },
    ...withCurrent(current).map((name) => ({ value: name, label: name })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <SelectDropdown ariaLabel="Granularity" value={view.granularity} options={GRANULARITY} onChange={(granularity) => go({ granularity })} className="w-32" />
      <SelectDropdown
        ariaLabel="Cohort starts at"
        value={view.cohortEvent ?? ""}
        options={options(view.cohortEvent, "First visit")}
        onChange={(name) => go({ cohortEvent: name || undefined })}
        className="w-44"
      />
      <SelectDropdown
        ariaLabel="Counts as returning"
        value={view.returnEvent ?? ""}
        options={options(view.returnEvent, "Any activity")}
        onChange={(name) => go({ returnEvent: name || undefined })}
        className="w-44"
      />
      <SelectDropdown
        ariaLabel="Segment"
        value={view.segment ?? ""}
        options={[{ value: "", label: "Everyone identified" }, ...segments.map((s) => ({ value: s.id, label: s.name }))]}
        onChange={(id) => go({ segment: id || undefined })}
        className="w-48"
      />
    </div>
  );
}
