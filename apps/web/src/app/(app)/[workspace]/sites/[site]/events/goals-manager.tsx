"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GoalMetric } from "@trackme/analytics";

export function GoalsManager({
  siteId,
  initialGoals,
}: {
  siteId: string;
  initialGoals: GoalMetric[];
}) {
  const [goals, setGoals] = useState<GoalMetric[]>(initialGoals);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [type, setType] = useState<"pageview_rule" | "custom_event">("pageview_rule");
  const [pathPattern, setPathPattern] = useState("");
  const [eventName, setEventName] = useState("");
  const [targetValue, setTargetValue] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name,
        type,
        targetValue: targetValue ? Number(targetValue) : undefined,
      };

      if (type === "pageview_rule") {
        payload.pathPattern = pathPattern.startsWith("/") ? pathPattern : `/${pathPattern}`;
      } else {
        payload.eventName = eventName;
      }

      const res = await fetch(`/api/v1/sites/${siteId}/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { goal?: GoalMetric; detail?: string };
      if (!res.ok || !data.goal) {
        throw new Error(data.detail ?? "Failed to create conversion goal");
      }

      setGoals((prev) => [
        {
          ...data.goal!,
          conversions: 0,
          convertingVisitors: 0,
          conversionRate: 0,
        },
        ...prev,
      ]);

      setName("");
      setPathPattern("");
      setEventName("");
      setTargetValue("");
      setShowCreateForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create conversion goal");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(goalId: string) {
    if (!window.confirm("Are you sure you want to delete this conversion goal?")) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/goals/${goalId}`, {
        method: "DELETE",
      });

      const data = (await res.json()) as { success?: boolean; detail?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.detail ?? "Failed to delete conversion goal");
      }

      setGoals((prev) => prev.filter((g) => g.id !== goalId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete conversion goal");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle>Conversion Goals</CardTitle>
            <CardDescription>
              Measure high-value visitor milestones and track conversion rates across your funnel.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => setShowCreateForm((prev) => !prev)}
            variant={showCreateForm ? "secondary" : "primary"}
          >
            {showCreateForm ? "Cancel" : "+ New Goal"}
          </Button>
        </div>
      </CardHeader>

      <div className="space-y-4">
        {/* Create Form */}
        {showCreateForm ? (
          <form
            onSubmit={handleCreate}
            className="p-4 rounded-xl bg-[#090a0f] border border-blue-500/30 space-y-4 text-xs"
          >
            <div className="font-semibold text-white text-sm">Define New Conversion Goal</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 mb-1">Goal Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Visited Pricing or Demo Click"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#141824] border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Trigger Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as "pageview_rule" | "custom_event")}
                  className="w-full bg-[#141824] border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="pageview_rule">Pageview Rule (URL Path)</option>
                  <option value="custom_event">Custom Event (Action Trigger)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {type === "pageview_rule" ? (
                <div>
                  <label className="block text-slate-400 mb-1">Path Pattern</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. /pricing or /signup"
                    value={pathPattern}
                    onChange={(e) => setPathPattern(e.target.value)}
                    className="w-full bg-[#141824] border border-slate-700 rounded-lg p-2 text-white font-mono"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-slate-400 mb-1">Event Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. demo_button_clicked"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    className="w-full bg-[#141824] border border-slate-700 rounded-lg p-2 text-white font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">Optional Target Value ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 50"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="w-full bg-[#141824] border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>
            </div>

            {error ? <div className="text-red-400 text-xs">{error}</div> : null}

            <div className="flex justify-end space-x-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving..." : "Save Goal"}
              </Button>
            </div>
          </form>
        ) : null}

        {/* Goals List */}
        {goals.length === 0 ? (
          <p className="text-xs text-slate-500">
            No conversion goals defined yet. Create a goal to track conversion rates on key pages or events.
          </p>
        ) : (
          <div className="space-y-3">
            {goals.map((goal) => (
              <div
                key={goal.id}
                className="p-4 rounded-xl bg-[#141824] border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white text-sm">{goal.name}</span>
                    <Badge variant={goal.type === "pageview_rule" ? "default" : "warning"}>
                      {goal.type === "pageview_rule" ? "Pageview" : "Custom Event"}
                    </Badge>
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]">
                    Matching: {goal.pathPattern || goal.eventName}
                    {goal.targetValue ? ` • Target Value: $${goal.targetValue}` : ""}
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  <div className="text-right">
                    <div className="text-base font-extrabold text-white">
                      {goal.conversions.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                      Conversions
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-base font-extrabold text-emerald-400">
                      {goal.conversionRate}%
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                      Conv. Rate
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 px-2.5"
                    disabled={pending}
                    onClick={() => void handleDelete(goal.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
