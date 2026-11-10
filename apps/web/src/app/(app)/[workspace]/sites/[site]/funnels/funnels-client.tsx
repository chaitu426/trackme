"use client";

import { MatrixSpinner } from "@/components/ui/matrix-loader";
import { PillTabs } from "@/components/motion/primitives";
import { PageHeader } from "@/components/ui/page-header";
import * as React from "react";
import { inputCompactClass } from "@/components/ui/field";
import { AnimatePresence } from "motion/react";
import { ModalFrame } from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  TrendingDown,
  AlertCircle,
  X,
  ArrowUp,
  ArrowDown,
  Check,
  FileText,
  Zap,
  Filter,
  RefreshCw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FunnelInsightsPanel } from "./funnel-insights";
import type { FunnelAnalysisResult, FunnelStepDefinition, FunnelStepResult } from "@trackme/analytics";

export interface FunnelItem {
  id: string;
  name: string;
  description: string | null;
  steps: FunnelStepDefinition[];
  createdAt: string;
}

export interface FunnelSuggestions {
  paths: string[];
  events: string[];
}

interface FunnelsClientProps {
  site: { id: string; domain: string };
  initialFunnels: FunnelItem[];
  initialActiveFunnel: FunnelItem | null;
  initialAnalysis: FunnelAnalysisResult | null;
  initialAnalysisError?: string | null;
  /** Pages and custom events already seen on the site, for autocompleting step targets. */
  suggestions?: Promise<FunnelSuggestions>;
  /** Pages to start a new funnel from (e.g. a route picked on the Journeys page). Opens the create dialog. */
  prefillPaths?: string[];
}

const MAX_STEPS = 8;
const NAME_MAX = 100;

type StepDraft = Omit<FunnelStepDefinition, "order">;

const TEMPLATES: { id: string; label: string; hint: string; name: string; steps: StepDraft[] }[] = [
  {
    id: "signup",
    label: "Signup",
    hint: "Landing to account created",
    name: "Signup funnel",
    steps: [
      { name: "Landing page", type: "pageview", target: "/" },
      { name: "Pricing", type: "pageview", target: "/pricing" },
      { name: "Signup", type: "pageview", target: "/signup" },
      { name: "Account created", type: "custom_event", target: "account_created" },
    ],
  },
  {
    id: "checkout",
    label: "Checkout",
    hint: "Browse to purchase",
    name: "Checkout funnel",
    steps: [
      { name: "Product", type: "pageview", target: "/products" },
      { name: "Cart", type: "pageview", target: "/cart" },
      { name: "Checkout", type: "pageview", target: "/checkout" },
      { name: "Purchase", type: "custom_event", target: "purchase_completed" },
    ],
  },
  {
    id: "blank",
    label: "Blank",
    hint: "Start from scratch",
    name: "",
    steps: [
      { name: "", type: "pageview", target: "" },
      { name: "", type: "pageview", target: "" },
    ],
  },
];

const FUNNEL_WINDOWS = [7, 14, 30] as const;
const DEFAULT_DAYS = 30;

export function FunnelsClient({
  site,
  initialFunnels,
  initialActiveFunnel,
  initialAnalysis,
  initialAnalysisError = null,
  suggestions,
  prefillPaths = [],
}: FunnelsClientProps) {
  const [funnels, setFunnels] = React.useState<FunnelItem[]>(initialFunnels);
  const [activeFunnel, setActiveFunnel] = React.useState<FunnelItem | null>(initialActiveFunnel);
  const [analysis, setAnalysis] = React.useState<FunnelAnalysisResult | null>(initialAnalysis);
  const [analysisError, setAnalysisError] = React.useState<string | null>(initialAnalysisError);
  const [loadingAnalysis, setLoadingAnalysis] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(prefillPaths.length >= 2);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [days, setDays] = React.useState<number>(DEFAULT_DAYS);

  // Analyses fetched this session, keyed by funnel, so flipping between funnels is instant.
  // Refresh bypasses it (force); deleting a funnel drops its entry.
  const analysisCache = React.useRef(new Map<string, FunnelAnalysisResult>());
  React.useEffect(() => {
    if (initialActiveFunnel && initialAnalysis) analysisCache.current.set(`${initialActiveFunnel.id}:${DEFAULT_DAYS}`, initialAnalysis);
  }, [initialActiveFunnel, initialAnalysis]);

  async function loadFunnel(funnel: FunnelItem, force = false, windowDays = days) {
    setActiveFunnel(funnel);
    setConfirmDelete(false);
    setAnalysisError(null);
    const hit = force ? undefined : analysisCache.current.get(`${funnel.id}:${windowDays}`);
    if (hit) {
      setAnalysis(hit);
      setLoadingAnalysis(false);
      return;
    }
    setLoadingAnalysis(true);
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/funnels/${funnel.id}?days=${windowDays}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAnalysis(null);
        setAnalysisError(data.detail || data.message || "Analytics is temporarily unavailable. Retry in a moment.");
        return;
      }
      analysisCache.current.set(`${funnel.id}:${windowDays}`, data.analysis);
      setAnalysis(data.analysis);
    } catch {
      setAnalysis(null);
      setAnalysisError("Analytics is temporarily unavailable. Retry in a moment.");
    } finally {
      setLoadingAnalysis(false);
    }
  }

  async function handleDeleteFunnel(id: string) {
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/funnels/${id}`, { method: "DELETE" });
      if (res.ok) {
        for (const key of [...analysisCache.current.keys()]) if (key.startsWith(`${id}:`)) analysisCache.current.delete(key);
        const remaining = funnels.filter((f) => f.id !== id);
        setFunnels(remaining);
        setConfirmDelete(false);
        if (activeFunnel?.id === id) {
          const next = remaining[0] || null;
          setActiveFunnel(next);
          if (next) void loadFunnel(next);
          else setAnalysis(null);
        }
      }
    } catch {
      // leave the funnel in place; the user can try again
    }
  }

  function handleCreated(created: FunnelItem) {
    setFunnels((prev) => [created, ...prev]);
    setModalOpen(false);
    void loadFunnel(created);
  }

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Funnels" art="steps" actions={<button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#ededed] px-4 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors hover:bg-white"
        >
          <Plus className="h-4 w-4" />
          New funnel
        </button>}>
        See where visitors to <span className="font-mono text-zinc-300">{site.domain}</span> leave on the way to a goal
      </PageHeader>

      {/* Funnel selector */}
      {funnels.length > 1 && (
        <PillTabs
          kind="tabs"
          label="Funnels"
          value={activeFunnel?.id ?? ""}
          onChange={(id) => {
            const next = funnels.find((f) => f.id === id);
            if (next) void loadFunnel(next);
          }}
          items={funnels.map((f) => ({ id: f.id, label: <span className="flex items-center gap-2">{f.name}<span className="font-mono text-xs text-zinc-500">{f.steps.length}</span></span> }))}
        />
      )}

      {activeFunnel ? (
        <FunnelView
          siteId={site.id}
          funnel={activeFunnel}
          analysis={analysis}
          loading={loadingAnalysis}
          error={analysisError}
          confirmDelete={confirmDelete}
          onAskDelete={() => setConfirmDelete(true)}
          onCancelDelete={() => setConfirmDelete(false)}
          onDelete={() => void handleDeleteFunnel(activeFunnel.id)}
          onRefresh={() => void loadFunnel(activeFunnel, true)}
          days={days}
          onDaysChange={(next) => {
            setDays(next);
            void loadFunnel(activeFunnel, false, next);
          }}
        />
      ) : (
        <Card className="px-6 py-12">
          <div className="mx-auto max-w-md space-y-4 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-500">
              <Filter className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-zinc-200">No funnels yet</h3>
              <p className="text-xs leading-relaxed text-zinc-400">
                A funnel is an ordered list of pages or events. You will see how many sessions make it through each step, and exactly
                where the rest leave.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex h-8 items-center gap-2 rounded-lg bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-white"
            >
              <Plus className="h-4 w-4" />
              Create your first funnel
            </button>
          </div>
        </Card>
      )}

      <AnimatePresence>
        {modalOpen && (
          <CreateFunnelDialog
            siteId={site.id}
            suggestions={suggestions}
            prefillPaths={prefillPaths}
            onClose={() => setModalOpen(false)}
            onCreated={handleCreated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────────── Funnel view ───────────────────────────── */

function SummaryTile({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: string | undefined }) {
  return (
    <Card className="flex min-h-[104px] flex-col justify-between gap-2 p-4">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      <div>
        <p className={`text-[26px] font-medium leading-none tabular-nums ${accent ?? "text-zinc-50"}`}>{value}</p>
        <p className="mt-2 truncate text-xs text-zinc-500">{hint}</p>
      </div>
    </Card>
  );
}

function FunnelView({
  siteId,
  funnel,
  analysis,
  loading,
  error,
  confirmDelete,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onRefresh,
  days,
  onDaysChange,
}: {
  siteId: string;
  funnel: FunnelItem;
  analysis: FunnelAnalysisResult | null;
  loading: boolean;
  error: string | null;
  confirmDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  days: number;
  onDaysChange: (days: number) => void;
}) {
  const steps = analysis?.steps ?? [];
  const worst = steps.reduce<FunnelStepResult | null>(
    (acc, step, i) => (i > 0 && step.dropOffCount > 0 && (!acc || step.dropOffCount > acc.dropOffCount) ? step : acc),
    null
  );
  const worstPrev = worst ? steps.find((s) => s.order === worst.order - 1) : undefined;
  const hasTraffic = (analysis?.totalStarted ?? 0) > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
        <SummaryTile
          label="Entered"
          value={analysis ? analysis.totalStarted.toLocaleString() : "–"}
          hint={steps[0] ? `Reached “${steps[0].name}”` : "Visitors reaching step 1"}
        />
        <SummaryTile
          label="Completed"
          value={analysis ? analysis.totalCompleted.toLocaleString() : "–"}
          hint={steps.length ? `Reached “${steps[steps.length - 1]!.name}”` : "Visitors finishing every step"}
          accent="text-good"
        />
        <SummaryTile
          label="Conversion"
          value={analysis && hasTraffic ? `${analysis.overallConversionRate}%` : "–"}
          hint="Entered to completed"
          accent="text-zinc-200"
        />
        <SummaryTile
          label="Biggest drop-off"
          value={worst ? `${worst.dropOffRate}%` : "–"}
          hint={worst && worstPrev ? `${worstPrev.name} → ${worst.name}` : hasTraffic ? "No sessions lost" : "Needs traffic"}
          accent={worst ? "text-bad" : undefined}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 border-b border-white/[0.06] pb-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{funnel.name}</CardTitle>
            <CardDescription>
              {funnel.description || `${funnel.steps.length} steps, in order, counted per session over the last ${days} days`}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <div role="group" aria-label="Time window" className="mr-1 flex h-8 items-center gap-0.5 rounded-lg border border-white/[0.08] p-0.5">
              {FUNNEL_WINDOWS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days === d}
                  disabled={loading}
                  onClick={() => days !== d && onDaysChange(d)}
                  className={`h-full rounded-md px-2.5 text-xs transition-colors disabled:opacity-60 ${
                    days === d ? "bg-raised font-medium text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Recalculate funnel"
              title="Recalculate"
              className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1 rounded-md border border-bad/25 bg-bad/10 pl-2 text-xs text-bad">
                Delete?
                <button type="button" onClick={onDelete} className="px-2 py-1 font-medium hover:text-white">
                  Yes
                </button>
                <button type="button" onClick={onCancelDelete} className="px-2 py-1 text-zinc-400 hover:text-zinc-100">
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onAskDelete}
                aria-label="Delete funnel"
                title="Delete funnel"
                className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-bad/10 hover:text-bad"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardHeader>

        {loading ? (
          <div role="status" aria-busy="true" className="space-y-4 pt-4">
            <span className="sr-only">Calculating step conversions</span>
            {[100, 72, 48, 31].map((w) => (
              <div key={w} className="flex items-center gap-4">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-9 rounded-lg" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="mt-4 space-y-3 rounded-xl border border-dashed border-bad/30 bg-bad/5 p-8 text-center">
            <p className="text-xs text-bad">{error}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-md border border-white/[0.1] px-3 py-1 text-xs text-zinc-200 hover:bg-white/[0.05]"
            >
              Retry
            </button>
          </div>
        ) : steps.length > 0 ? (
          <ol className="pt-4">
            {steps.map((step, idx) => {
              const next = steps[idx + 1];
              const isWorst = next !== undefined && worst?.order === next.order;
              return (
                <li key={step.order}>
                  <StepRow step={step} first={idx === 0} last={idx === steps.length - 1} />
                  {next && <Transition next={next} highlight={isWorst} />}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-10 text-center text-xs text-zinc-500">No data for this period yet.</p>
        )}

        {!loading && !error && analysis && !hasTraffic && (
          <p className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-zinc-500">
            No session has reached step 1 in the last {days} days. Counts appear here as soon as someone does.
          </p>
        )}
      </Card>

      {!loading && !error && analysis && hasTraffic && steps.length >= 2 && (
        <FunnelInsightsPanel key={funnel.id} siteId={siteId} funnelId={funnel.id} analysis={analysis} days={days} />
      )}
    </div>
  );
}

function StepRow({ step, first, last }: { step: FunnelStepResult; first: boolean; last: boolean }) {
  const pct = Math.max(0, Math.min(100, step.conversionRateFromFirst));
  const isEvent = step.type !== "pageview";
  return (
    <div className="group flex items-center gap-4">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums ${
          last
            ? "border-good/30 bg-good/10 text-good"
            : "border-white/[0.1] bg-white/[0.04] text-zinc-300"
        }`}
      >
        {step.order}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-zinc-100">{step.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 truncate font-mono text-xs text-zinc-500">
              {isEvent ? <Zap className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {step.target}
            </span>
          </p>
          <p className="shrink-0 font-mono text-xs tabular-nums">
            <span className="font-medium text-zinc-100">{step.conversions.toLocaleString()}</span>
            <span className="ml-2 text-zinc-500">{first ? "entered" : `${step.conversionRateFromFirst}% of start`}</span>
          </p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className={`h-full rounded-full ${last ? "bg-good/70" : "bg-white/[0.07]"}`}
            style={{ width: `${step.conversions > 0 ? Math.max(pct, 1.5) : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Transition({ next, highlight }: { next: FunnelStepResult; highlight: boolean }) {
  return (
    <div className="flex items-center gap-4 py-2">
      <div className="flex w-8 shrink-0 justify-center" aria-hidden>
        <span className={`h-6 w-px ${highlight ? "bg-bad/40" : "bg-white/[0.1]"}`} />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-zinc-400">{next.conversionRateFromPrevious}% continue</span>
        {next.dropOffCount > 0 ? (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium ${
              highlight ? "bg-bad/15 text-bad ring-1 ring-bad/30" : "bg-white/[0.04] text-zinc-400"
            }`}
          >
            <TrendingDown className="h-4 w-4" />
            {next.dropOffCount.toLocaleString()} left ({next.dropOffRate}%)
          </span>
        ) : (
          <span className="text-zinc-600">no one left here</span>
        )}
        {highlight && <span className="text-xs font-medium text-bad">Biggest leak</span>}
      </div>
    </div>
  );
}

/* ───────────────────────────── Create dialog ───────────────────────────── */

function SuggestionLists({ promise }: { promise: Promise<FunnelSuggestions> }) {
  const { paths, events } = React.use(promise);
  return (
    <>
      <datalist id="funnel-paths">
        {paths.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="funnel-events">
        {events.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
    </>
  );
}

function normalizeTarget(type: StepDraft["type"], value: string): string {
  const trimmed = value.trim();
  if (type === "pageview" && trimmed && !trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed;
}

function CreateFunnelDialog({
  siteId,
  suggestions,
  prefillPaths,
  onClose,
  onCreated,
}: {
  siteId: string;
  suggestions: Promise<FunnelSuggestions> | undefined;
  prefillPaths: string[];
  onClose: () => void;
  onCreated: (funnel: FunnelItem) => void;
}) {
  const fromRoute = prefillPaths.length >= 2;
  const [template, setTemplate] = React.useState(fromRoute ? "blank" : "signup");
  const [name, setName] = React.useState(fromRoute ? "Route funnel" : TEMPLATES[0]!.name);
  const [description, setDescription] = React.useState(fromRoute ? "Built from a route on the Journeys page" : "");
  const [steps, setSteps] = React.useState<StepDraft[]>(
    fromRoute
      ? prefillPaths.slice(0, MAX_STEPS).map((path) => ({ name: path === "/" ? "Home" : path, type: "pageview" as const, target: path }))
      : TEMPLATES[0]!.steps
  );
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    nameRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTemplate(id);
    setName(t.name);
    setSteps(t.steps.map((s) => ({ ...s })));
    setTouched(false);
  }

  const update = (i: number, patch: Partial<StepDraft>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => setSteps((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  const add = () => setSteps((prev) => (prev.length >= MAX_STEPS ? prev : [...prev, { name: "", type: "pageview", target: "" }]));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });

  const nameError = !name.trim() ? "Give the funnel a name" : null;
  const stepErrors = steps.map((s, i) => {
    if (!s.name.trim()) return "Name this step";
    if (!s.target.trim()) return s.type === "pageview" ? "Enter a page path, like /pricing" : "Enter an event name";
    const prev = steps[i - 1];
    if (prev && prev.type === s.type && normalizeTarget(prev.type, prev.target) === normalizeTarget(s.type, s.target)) {
      return "Same as the previous step";
    }
    return null;
  });
  const valid = !nameError && stepErrors.every((e) => e === null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/funnels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          steps: steps.map((s, i) => ({
            order: i + 1,
            name: s.name.trim(),
            type: s.type,
            target: normalizeTarget(s.type, s.target),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.detail || data.message || "Could not create the funnel.");
        return;
      }
      onCreated(data.funnel as FunnelItem);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const input = inputCompactClass;

  return (
    <ModalFrame onClose={onClose} labelledBy="funnel-dialog-title" onSubmit={submit} dismissible={!saving}>
        {suggestions && (
          <React.Suspense fallback={null}>
            <SuggestionLists promise={suggestions} />
          </React.Suspense>
        )}

        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] p-5">
          <div>
            <h2 id="funnel-dialog-title" className="text-sm font-medium text-zinc-50">
              New funnel
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Visitors move through the steps in order. Pick a starting point, then adjust.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Templates */}
          <div className="grid grid-cols-3 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                aria-pressed={template === t.id}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  template === t.id
                    ? "border-white/[0.25] bg-white/[0.07]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
                }`}
              >
                <p className="text-xs font-medium text-zinc-100">{t.label}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{t.hint}</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="funnel-name" className="text-xs font-medium text-zinc-400">
                Name
              </label>
              <input
                id="funnel-name"
                ref={nameRef}
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="Onboarding and activation"
                className={input}
                aria-invalid={touched && !!nameError}
              />
              {touched && nameError && <p className="text-xs text-bad">{nameError}</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="funnel-desc" className="text-xs font-medium text-zinc-400">
                Description <span className="font-normal normal-case tracking-normal text-zinc-600">optional</span>
              </label>
              <input
                id="funnel-desc"
                value={description}
                maxLength={256}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="From landing to first project"
                className={input}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">
                Steps <span className="font-normal normal-case tracking-normal text-zinc-600">{steps.length} of {MAX_STEPS}</span>
              </span>
              <button
                type="button"
                onClick={add}
                disabled={steps.length >= MAX_STEPS}
                className="inline-flex items-center gap-1 text-xs font-medium text-zinc-200 transition-colors hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Add step
              </button>
            </div>

            <ol className="relative space-y-2 before:absolute before:bottom-6 before:left-[15px] before:top-6 before:w-px before:bg-white/[0.08]">
              {steps.map((s, i) => {
                const error = touched ? stepErrors[i] : null;
                return (
                  <li key={i} className="relative flex gap-3">
                    <span className="z-10 mt-3 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-card text-xs font-medium tabular-nums text-zinc-300">
                      {i + 1}
                    </span>
                    <div
                      className={`flex-1 space-y-2 rounded-xl border p-3 ${
                        error ? "border-bad/30 bg-bad/[0.04]" : "border-white/[0.07] bg-white/[0.015]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={`Step ${i + 1} name`}
                          value={s.name}
                          maxLength={NAME_MAX}
                          onChange={(e) => update(i, { name: e.target.value })}
                          placeholder="Step name"
                          className={`${input} flex-1`}
                        />
                        <PillTabs kind="radio" size="sm" label={`Step ${i + 1} type`} value={s.type} onChange={(type) => update(i, { type })} items={[{ id: "pageview", label: "Page" }, { id: "custom_event", label: "Event" }]} className="shrink-0" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={`Step ${i + 1} ${s.type === "pageview" ? "page path" : "event name"}`}
                          list={s.type === "pageview" ? "funnel-paths" : "funnel-events"}
                          value={s.target}
                          maxLength={256}
                          onChange={(e) => update(i, { target: e.target.value })}
                          onBlur={() => update(i, { target: normalizeTarget(s.type, s.target) })}
                          placeholder={s.type === "pageview" ? "/pricing" : "signup_completed"}
                          className={`${input} flex-1 font-mono`}
                        />
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={() => move(i, -1)}
                            disabled={i === 0}
                            aria-label={`Move step ${i + 1} up`}
                            className="rounded p-2 text-zinc-500 hover:text-zinc-200 disabled:opacity-25"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(i, 1)}
                            disabled={i === steps.length - 1}
                            aria-label={`Move step ${i + 1} down`}
                            className="rounded p-2 text-zinc-500 hover:text-zinc-200 disabled:opacity-25"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(i)}
                            disabled={steps.length <= 2}
                            aria-label={`Remove step ${i + 1}`}
                            className="rounded p-2 text-zinc-500 hover:text-bad disabled:opacity-25"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {!error && s.type === "pageview" && s.target.trim() && (
                        <p className="text-xs text-zinc-500">
                          {normalizeTarget(s.type, s.target) === "/"
                            ? "Matches every page, so this step is reached by any pageview."
                            : (
                              <>
                                Matches <span className="font-mono text-zinc-400">{normalizeTarget(s.type, s.target)}</span> and
                                every page that starts with it (for example{" "}
                                <span className="font-mono text-zinc-400">{normalizeTarget(s.type, s.target).replace(/\/$/, "")}/…</span>).
                              </>
                            )}
                        </p>
                      )}
                      {error && <p className="text-xs text-bad">{error}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Plain-language summary */}
          <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-xs leading-relaxed text-zinc-500">
            Counts sessions that{" "}
            {steps
              .filter((s) => s.target.trim())
              .map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && " then "}
                  <span className="font-mono text-zinc-300">
                    {s.type === "pageview" ? "view a page starting with " : "trigger "}
                    {normalizeTarget(s.type, s.target)}
                  </span>
                </React.Fragment>
              ))}
            {steps.every((s) => !s.target.trim()) && <span className="text-zinc-600">…add your steps above</span>}
            , in that order.
          </p>

          {saveError && (
            <p className="flex items-center gap-2 rounded-lg border border-bad/20 bg-bad/10 px-3 py-2 text-xs text-bad">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {saveError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] p-4">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg px-3 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || (touched && !valid)}
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-zinc-100 px-4 text-xs font-medium text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <MatrixSpinner /> : <Check className="h-4 w-4" />}
            {saving ? "Creating…" : "Create funnel"}
          </button>
        </div>
    </ModalFrame>
  );
}
