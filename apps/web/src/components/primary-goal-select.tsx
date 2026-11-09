"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectDropdown } from "@/components/ui/select-dropdown";

/** Which goal Release Impact judges conversion on. Saved on the site; unset means the first enabled goal. */
export function PrimaryGoalSelect({
  siteId,
  goals,
  current,
}: {
  siteId: string;
  goals: Array<{ id: string; name: string }>;
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(current ?? "");
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(next: string) {
    setValue(next);
    setState("saving");
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryGoalId: next || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
      router.refresh();
    } catch {
      setValue(current ?? "");
      setState("error");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4 text-zinc-300" /> Release conversion goal
        </CardTitle>
        <CardDescription>The goal Release Impact compares before and after a deploy. Without a choice it uses your first enabled goal.</CardDescription>
      </CardHeader>
      {goals.length === 0 ? (
        <p className="text-xs text-zinc-500">No goals yet. Create one under Goals &amp; Events.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <SelectDropdown
            ariaLabel="Conversion goal"
            value={value}
            options={[{ value: "", label: "First enabled goal" }, ...goals.map((g) => ({ value: g.id, label: g.name }))]}
            onChange={(next) => void save(next)}
            disabled={state === "saving"}
            className="w-64"
          />
          <span role="status" className="text-xs text-zinc-500">
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Could not save. Try again." : ""}
          </span>
        </div>
      )}
    </Card>
  );
}
