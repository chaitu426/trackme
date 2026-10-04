"use client";

import * as React from "react";
import {
  Filter,
  Plus,
  Trash2,
  TrendingDown,
  ArrowRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FunnelAnalysisResult, FunnelStepDefinition } from "@trackme/analytics";

export interface FunnelItem {
  id: string;
  name: string;
  description: string | null;
  steps: FunnelStepDefinition[];
  createdAt: string;
}

interface FunnelsClientProps {
  site: { id: string; domain: string };
  initialFunnels: FunnelItem[];
  initialActiveFunnel: FunnelItem | null;
  initialAnalysis: FunnelAnalysisResult | null;
}

export function FunnelsClient({
  site,
  initialFunnels,
  initialActiveFunnel,
  initialAnalysis,
}: FunnelsClientProps) {
  const [funnels, setFunnels] = React.useState<FunnelItem[]>(initialFunnels);
  const [activeFunnel, setActiveFunnel] = React.useState<FunnelItem | null>(initialActiveFunnel);
  const [analysis, setAnalysis] = React.useState<FunnelAnalysisResult | null>(initialAnalysis);
  const [loadingAnalysis, setLoadingAnalysis] = React.useState(false);

  // Create modal state
  const [modalOpen, setModalOpen] = React.useState(false);
  const [funnelName, setFunnelName] = React.useState("");
  const [funnelDesc, setFunnelDesc] = React.useState("");
  const [steps, setSteps] = React.useState<FunnelStepDefinition[]>([
    { order: 1, name: "Landing Page", type: "pageview", target: "/" },
    { order: 2, name: "Pricing Page", type: "pageview", target: "/pricing" },
    { order: 3, name: "Signup Attempt", type: "pageview", target: "/signup" },
    { order: 4, name: "Account Created", type: "custom_event", target: "account_created" },
  ]);
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  async function loadFunnel(funnel: FunnelItem) {
    setActiveFunnel(funnel);
    setLoadingAnalysis(true);
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/funnels/${funnel.id}`);
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
      }
    } catch {
      // ignore
    } finally {
      setLoadingAnalysis(false);
    }
  }

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        order: prev.length + 1,
        name: `Step ${prev.length + 1}`,
        type: "pageview",
        target: "/",
      },
    ]);
  }

  function removeStep(index: number) {
    if (steps.length <= 2) return;
    setSteps((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((s, idx) => ({ ...s, order: idx + 1 }))
    );
  }

  function updateStep(index: number, patch: Partial<FunnelStepDefinition>) {
    setSteps((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, ...patch } : s))
    );
  }

  async function handleCreateFunnel(e: React.FormEvent) {
    e.preventDefault();
    if (!funnelName.trim()) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/v1/sites/${site.id}/funnels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: funnelName.trim(),
          description: funnelDesc.trim() || undefined,
          steps,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.detail || data.message || "Failed to create funnel.");
        return;
      }

      const created: FunnelItem = data.funnel;
      setFunnels((prev) => [created, ...prev]);
      setModalOpen(false);
      setFunnelName("");
      setFunnelDesc("");
      loadFunnel(created);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteFunnel(id: string) {
    if (!confirm("Are you sure you want to delete this funnel?")) return;
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/funnels/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const remaining = funnels.filter((f) => f.id !== id);
        setFunnels(remaining);
        if (activeFunnel?.id === id) {
          const next = remaining[0] || null;
          setActiveFunnel(next);
          if (next) loadFunnel(next);
          else setAnalysis(null);
        }
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
              <Filter className="h-4 w-4" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              Conversion Funnels & Drop-offs
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Measure step-by-step customer progression, discover friction points, and boost conversion rates.
          </p>
        </div>

        <Button
          onClick={() => setModalOpen(true)}
          className="text-xs font-semibold gap-1.5 h-9 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Create Funnel
        </Button>
      </div>

      {/* Funnel Selector Tabs */}
      {funnels.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-white/[0.08]">
          {funnels.map((f) => (
            <button
              key={f.id}
              onClick={() => loadFunnel(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition shrink-0 flex items-center gap-2 ${
                activeFunnel?.id === f.id
                  ? "bg-white/10 text-zinc-100 border border-white/20"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
              }`}
            >
              <span>{f.name}</span>
              <span className="text-[10px] text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded">
                {f.steps.length} steps
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Active Funnel View */}
      {activeFunnel ? (
        <div className="space-y-6">
          {/* Funnel Header Card */}
          <div className="p-5 rounded-2xl border border-white/[0.08] bg-zinc-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-100">{activeFunnel.name}</h2>
                <button
                  type="button"
                  onClick={() => handleDeleteFunnel(activeFunnel.id)}
                  className="text-zinc-500 hover:text-rose-400 p-1 transition"
                  title="Delete Funnel"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {activeFunnel.description && (
                <p className="text-xs text-zinc-400 mt-0.5">{activeFunnel.description}</p>
              )}
            </div>

            {analysis && (
              <div className="flex items-center gap-6 shrink-0">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Total Started</span>
                  <span className="text-lg font-bold text-zinc-200">
                    {analysis.totalStarted.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Completed</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {analysis.totalCompleted.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Overall Conversion</span>
                  <span className="text-lg font-bold text-indigo-400">
                    {analysis.overallConversionRate}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {loadingAnalysis ? (
            <div className="p-12 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              Calculating step conversions from ClickHouse…
            </div>
          ) : analysis && analysis.steps.length > 0 ? (
            <div className="space-y-4">
              {analysis.steps.map((step, idx) => {
                const isLast = idx === analysis.steps.length - 1;
                const nextStep = !isLast ? analysis.steps[idx + 1] : null;

                return (
                  <div key={step.order} className="space-y-3">
                    {/* Step Card */}
                    <div className="p-4 rounded-2xl border border-white/[0.08] bg-zinc-950/80 hover:border-white/15 transition space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 text-[11px] font-bold">
                            {step.order}
                          </div>
                          <div>
                            <span className="font-semibold text-zinc-100">{step.name}</span>
                            <span className="font-mono text-[10px] text-zinc-500 ml-2">
                              {step.type === "pageview" ? "Page: " : "Event: "}
                              {step.target}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <span className="font-medium text-zinc-200">
                            {step.conversions.toLocaleString()} visitors
                          </span>
                          <span className="font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded text-[11px]">
                            {step.conversionRateFromFirst}% of start
                          </span>
                        </div>
                      </div>

                      {/* Visual Progress Bar */}
                      <div className="w-full bg-white/[0.04] h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(2, Math.min(100, step.conversionRateFromFirst))}%` }}
                        />
                      </div>
                    </div>

                    {/* Drop-off connector */}
                    {nextStep && (
                      <div className="flex items-center justify-between px-6 py-1 text-xs">
                        <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
                          <ArrowRight className="w-3.5 h-3.5" />
                          <span>Transition to Step {nextStep.order}</span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="text-emerald-400 font-medium">
                            {nextStep.conversionRateFromPrevious}% converted
                          </span>
                          {nextStep.dropOffCount > 0 && (
                            <span className="text-rose-400 font-medium flex items-center gap-1 bg-rose-500/10 px-2 py-0.5 rounded">
                              <TrendingDown className="w-3 h-3" />
                              -{nextStep.dropOffCount.toLocaleString()} ({nextStep.dropOffRate}% drop-off)
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-zinc-500 rounded-2xl border border-dashed border-white/10">
              No conversion data available for this date range yet.
            </div>
          )}
        </div>
      ) : (
        <div className="p-12 text-center space-y-3 rounded-2xl border border-white/[0.08] bg-zinc-950/80">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-500 mx-auto">
            <Filter className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-200">No Funnels Created Yet</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
            Create multi-step funnels to map out user drop-off points between landing pages, onboarding steps, and checkout milestones.
          </p>
          <Button onClick={() => setModalOpen(true)} className="text-xs font-semibold gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Create First Funnel
          </Button>
        </div>
      )}

      {/* Create Funnel Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-100">Create Conversion Funnel</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Define an ordered sequence of page views or custom events.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFunnel} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Funnel Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Onboarding & Activation Funnel"
                  value={funnelName}
                  onChange={(e) => setFunnelName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Tracks landing visitors through first created project"
                  value={funnelDesc}
                  onChange={(e) => setFunnelDesc(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Steps Builder */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300">Funnel Steps (Min 2)</label>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Step
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {steps.map((s, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.02] flex items-center gap-2 text-xs"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-bold shrink-0">
                        {idx + 1}
                      </span>

                      <input
                        type="text"
                        required
                        placeholder="Step Name"
                        value={s.name}
                        onChange={(e) => updateStep(idx, { name: e.target.value })}
                        className="w-1/3 rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
                      />

                      <select
                        value={s.type}
                        onChange={(e) => updateStep(idx, { type: e.target.value as "pageview" | "custom_event" })}
                        className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 cursor-pointer"
                      >
                        <option value="pageview">Page Path</option>
                        <option value="custom_event">Custom Event</option>
                      </select>

                      <input
                        type="text"
                        required
                        placeholder={s.type === "pageview" ? "/pricing" : "signup_completed"}
                        value={s.target}
                        onChange={(e) => updateStep(idx, { target: e.target.value })}
                        className="flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs font-mono text-zinc-100"
                      />

                      {steps.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeStep(idx)}
                          className="text-zinc-500 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {saveError && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {saveError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalOpen(false)}
                  className="text-xs font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="text-xs font-semibold gap-1.5"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {isSaving ? "Creating…" : "Save Funnel"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
