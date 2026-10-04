"use client";

import { useState } from "react";
import {
  Trash2,
  Edit2,
  Check,
  TrendingUp,
  Award,
  Zap,
  Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GoalMetric } from "@trackme/analytics";

type GoalItem = GoalMetric;

export function GoalsManager({
  siteId,
  initialGoals,
}: {
  siteId: string;
  initialGoals: GoalMetric[];
}) {
  const [goals, setGoals] = useState<GoalItem[]>(
    initialGoals.map((g) => ({ ...g, enabled: g.enabled ?? true }))
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [type, setType] = useState<"pageview_rule" | "custom_event">("pageview_rule");
  const [pathPattern, setPathPattern] = useState("");
  const [eventName, setEventName] = useState("");
  const [targetValue, setTargetValue] = useState("");

  // Edit states
  const [editName, setEditName] = useState("");
  const [editPattern, setEditPattern] = useState("");
  const [editTargetValue, setEditTargetValue] = useState("");

  // Summary stats
  const totalConversions = goals.reduce((acc, g) => acc + (g.conversions || 0), 0);
  const avgConvRate =
    goals.length > 0
      ? (goals.reduce((acc, g) => acc + (g.conversionRate || 0), 0) / goals.length).toFixed(1)
      : "0.0";
  const activeCount = goals.filter((g) => g.enabled !== false).length;

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
          enabled: true,
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

  async function handleToggleEnabled(goalId: string, currentEnabled: boolean) {
    const nextState = !currentEnabled;
    setGoals((prev) =>
      prev.map((g) => (g.id === goalId ? { ...g, enabled: nextState } : g))
    );

    try {
      await fetch(`/api/v1/sites/${siteId}/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextState }),
      });
    } catch {
      // Revert on error
      setGoals((prev) =>
        prev.map((g) => (g.id === goalId ? { ...g, enabled: currentEnabled } : g))
      );
    }
  }

  function startEditing(goal: GoalItem) {
    setEditingGoalId(goal.id);
    setEditName(goal.name);
    setEditPattern(goal.pathPattern || goal.eventName || "");
    setEditTargetValue(goal.targetValue ? String(goal.targetValue) : "");
  }

  async function handleSaveEdit(goalId: string, goalType: string) {
    setPending(true);
    try {
      const payload: Record<string, unknown> = {
        name: editName,
        targetValue: editTargetValue ? Number(editTargetValue) : null,
      };
      if (goalType === "pageview_rule") {
        payload.pathPattern = editPattern;
      } else {
        payload.eventName = editPattern;
      }

      const res = await fetch(`/api/v1/sites/${siteId}/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setGoals((prev) =>
          prev.map((g) =>
            g.id === goalId
              ? {
                  ...g,
                  name: editName,
                  pathPattern: goalType === "pageview_rule" ? editPattern : g.pathPattern,
                  eventName: goalType !== "pageview_rule" ? editPattern : g.eventName,
                  targetValue: editTargetValue ? Number(editTargetValue) : null,
                }
              : g
          )
        );
        setEditingGoalId(null);
      }
    } catch {
      // Ignore
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
    <div className="space-y-6">
      {/* Metric Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-4">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Conversions</span>
            <Award className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-zinc-100">
            {totalConversions.toLocaleString()}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">Across all active conversion rules</p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-4">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Avg. Conversion Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-emerald-400">
            {avgConvRate}%
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">Weighted conversion efficiency</p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-4">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Active Goals</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-zinc-100">
            {activeCount} / {goals.length}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">Monitoring and matching events</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Conversion Goals & Funnels</CardTitle>
              <CardDescription>
                Measure high-value visitor milestones, signup completions, and target values.
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
              className="space-y-4 rounded-xl border border-white/10 bg-zinc-900/60 p-5 text-xs"
            >
              <div className="text-sm font-semibold text-zinc-200">Define New Conversion Goal</div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-zinc-400 font-medium">Goal Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Completed Checkout or Demo Request"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 p-2.5 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-zinc-400 font-medium">Trigger Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as "pageview_rule" | "custom_event")}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 p-2.5 text-zinc-200 outline-none focus:border-indigo-500"
                  >
                    <option value="pageview_rule">Pageview Rule (URL Path)</option>
                    <option value="custom_event">Custom Event (JavaScript Trigger)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {type === "pageview_rule" ? (
                  <div>
                    <label className="mb-1 block text-zinc-400 font-medium">Path Pattern</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. /pricing, /thank-you, /checkout/*"
                      value={pathPattern}
                      onChange={(e) => setPathPattern(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-zinc-950 p-2.5 font-mono text-zinc-200 outline-none focus:border-indigo-500"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-zinc-400 font-medium">Event Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. signup_clicked, upgrade_plan"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-zinc-950 p-2.5 font-mono text-zinc-200 outline-none focus:border-indigo-500"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-zinc-400 font-medium">Target Revenue Value ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 99.00"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 p-2.5 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {error && <div className="text-rose-400 text-xs">{error}</div>}

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
                  {pending ? "Saving…" : "Create Goal"}
                </Button>
              </div>
            </form>
          ) : null}

          {/* Goals List */}
          {goals.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-xs text-zinc-400">
              No conversion goals defined yet. Create your first goal to measure key business milestones.
            </p>
          ) : (
            <div className="space-y-3">
              {goals.map((goal) => {
                const isEditing = editingGoalId === goal.id;
                const isEnabled = goal.enabled !== false;

                return (
                  <div
                    key={goal.id}
                    className={`flex flex-col justify-between gap-4 rounded-xl border p-4 text-xs transition-all md:flex-row md:items-center ${
                      isEnabled
                        ? "border-white/[0.08] bg-zinc-950/70"
                        : "border-white/[0.04] bg-white/[0.01] opacity-60"
                    }`}
                  >
                    {/* Goal info or edit mode */}
                    {isEditing ? (
                      <div className="flex-1 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Goal name"
                            className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
                          />
                          <input
                            type="text"
                            value={editPattern}
                            onChange={(e) => setEditPattern(e.target.value)}
                            placeholder="Path or event"
                            className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs font-mono text-zinc-100"
                          />
                          <input
                            type="number"
                            value={editTargetValue}
                            onChange={(e) => setEditTargetValue(e.target.value)}
                            placeholder="Target value ($)"
                            className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 pt-1">
                          <button
                            onClick={() => handleSaveEdit(goal.id, goal.type)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 text-white font-medium text-[11px]"
                          >
                            <Check className="w-3 h-3" /> Save
                          </button>
                          <button
                            onClick={() => setEditingGoalId(null)}
                            className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center space-x-2">
                          {/* Enable/Disable toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleEnabled(goal.id, isEnabled)}
                            title={isEnabled ? "Pause goal" : "Resume goal"}
                            className={`p-1 rounded-md transition ${
                              isEnabled
                                ? "text-emerald-400 hover:bg-emerald-500/10"
                                : "text-zinc-500 hover:bg-white/[0.04]"
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>

                          <span className="text-sm font-bold text-zinc-100">{goal.name}</span>
                          <Badge variant={goal.type === "pageview_rule" ? "default" : "warning"}>
                            {goal.type === "pageview_rule" ? "Pageview" : "Custom Event"}
                          </Badge>
                          {!isEnabled && (
                            <span className="text-[10px] uppercase font-semibold text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
                              Paused
                            </span>
                          )}
                        </div>

                        <div className="font-mono text-[11px] text-zinc-400">
                          Matching:{" "}
                          <span className="text-zinc-300">
                            {goal.pathPattern || goal.eventName}
                          </span>
                          {goal.targetValue ? ` • Target: $${goal.targetValue}` : ""}
                        </div>
                      </div>
                    )}

                    {/* Stats & Actions */}
                    <div className="flex items-center space-x-5">
                      <div className="text-right">
                        <div className="text-base font-extrabold text-zinc-100">
                          {(goal.conversions || 0).toLocaleString()}
                        </div>
                        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                          Conversions
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-base font-extrabold text-emerald-400">
                          {goal.conversionRate || 0}%
                        </div>
                        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                          Conv. Rate
                        </div>
                      </div>

                      {/* Edit button */}
                      <button
                        type="button"
                        onClick={() => startEditing(goal)}
                        className="text-zinc-400 hover:text-zinc-200 transition p-1"
                        title="Edit goal"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Delete button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-rose-500 hover:bg-rose-500/10 hover:text-rose-400"
                        disabled={pending}
                        onClick={() => void handleDelete(goal.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
