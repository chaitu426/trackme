"use client";

import { PillTabs } from "@/components/motion/primitives";
import * as React from "react";
import { inputCompactClass, NativeSelect } from "@/components/ui/field";
import { ModalFrame } from "@/components/ui/dialog";
import { AlertCircle, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  EMPTY_SEGMENT,
  isCompleteCondition,
  type BehaviorCondition,
  type ProfileCondition,
  type SegmentDefinition,
} from "@/lib/segment-schema";

export interface SegmentPreview {
  total: number;
  capped: boolean;
  profiles: { distinctId: string; name: string | null; email: string | null }[];
}

export interface SavedSegment {
  id: string;
  name: string;
  definition: SegmentDefinition;
}

const FIELDS: { key: ProfileCondition["field"]; label: string }[] = [
  { key: "trait", label: "Trait" },
  { key: "lastSeen", label: "Last active" },
  { key: "firstSeen", label: "First seen" },
  { key: "sessions", label: "Sessions" },
  { key: "events", label: "Events" },
  { key: "email", label: "Email" },
];

function blankCondition(field: ProfileCondition["field"]): ProfileCondition {
  switch (field) {
    case "trait":
      return { field, key: "", op: "eq", value: "" };
    case "lastSeen":
      return { field, op: "within", days: 7 };
    case "firstSeen":
      return { field, op: "within", days: 30 };
    case "sessions":
      return { field, op: "gte", value: 2 };
    case "events":
      return { field, op: "gte", value: 10 };
    case "email":
      return { field, op: "exists" };
  }
}

const input = inputCompactClass;
const select = "";

export function SegmentBuilder({
  siteId,
  traitKeys,
  onClose,
  onSaved,
}: {
  siteId: string;
  traitKeys: string[];
  onClose: () => void;
  onSaved: (segment: SavedSegment) => void;
}) {
  const [name, setName] = React.useState("");
  const [definition, setDefinition] = React.useState<SegmentDefinition>({
    ...EMPTY_SEGMENT,
    conditions: [blankCondition("trait")],
  });
  const [preview, setPreview] = React.useState<SegmentPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  const nameRef = React.useRef<HTMLInputElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  React.useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  // Only complete rules are sent, so the live count never fails on a half-typed condition.
  const runnable = React.useMemo<SegmentDefinition>(
    () => ({
      ...definition,
      conditions: definition.conditions.filter(isCompleteCondition),
      behavior: definition.behavior.filter((b) => b.target.trim().length > 0),
    }),
    [definition]
  );
  const hasRules = runnable.conditions.length + runnable.behavior.length > 0;
  const incomplete = definition.conditions.length !== runnable.conditions.length || definition.behavior.length !== runnable.behavior.length;

  React.useEffect(() => {
    if (!hasRules) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const controller = new AbortController();
    setPreviewing(true);
    const timer = setTimeout(() => {
      fetch(`/api/v1/sites/${siteId}/segments/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ definition: runnable }),
      })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.message || body.detail || "Could not count matches");
          setPreview(body as SegmentPreview);
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setPreviewError(err instanceof Error ? err.message : "Could not count matches");
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [runnable, hasRules, siteId]);

  const setCondition = (i: number, next: ProfileCondition) =>
    setDefinition((d) => ({ ...d, conditions: d.conditions.map((c, idx) => (idx === i ? next : c)) }));
  const setBehavior = (i: number, patch: Partial<BehaviorCondition>) =>
    setDefinition((d) => ({ ...d, behavior: d.behavior.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) }));

  const valid = name.trim().length > 0 && hasRules && !incomplete;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), definition: runnable }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(body.message || body.detail || "Could not save the segment.");
        return;
      }
      onSaved(body.segment as SavedSegment);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalFrame onClose={onClose} labelledBy="segment-dialog-title" onSubmit={submit} dismissible={!saving}>
        <datalist id="segment-trait-keys">
          {traitKeys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>

        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] p-5">
          <div>
            <h2 id="segment-dialog-title" className="text-sm font-medium text-zinc-50">
              New segment
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">A saved group of people, kept up to date as they change.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <div className="space-y-2">
            <label htmlFor="segment-name" className="text-xs font-medium text-zinc-400">
              Name
            </label>
            <input
              id="segment-name"
              ref={nameRef}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pro users who never checked out"
              className={`${input} w-full`}
            />
            {touched && !name.trim() && <p className="text-xs text-[#e5484d]">Give the segment a name</p>}
          </div>

          {/* Who */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium text-zinc-400">Who</h3>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                Match
                <PillTabs kind="radio" size="sm" label="Match mode" value={definition.match} onChange={(m) => setDefinition((d) => ({ ...d, match: m }))} items={[{ id: "all", label: "all" }, { id: "any", label: "any" }]} />
                of these
              </div>
            </div>

            {definition.conditions.length === 0 && <p className="text-xs text-zinc-600">No profile rules: everyone is included.</p>}
            {definition.conditions.map((c, i) => (
              <ConditionRow
                key={i}
                condition={c}
                onChange={(next) => setCondition(i, next)}
                onRemove={() => setDefinition((d) => ({ ...d, conditions: d.conditions.filter((_, idx) => idx !== i) }))}
                invalid={touched && !isCompleteCondition(c)}
              />
            ))}
            {definition.conditions.length < 10 && (
              <button
                type="button"
                onClick={() => setDefinition((d) => ({ ...d, conditions: [...d.conditions, blankCondition("trait")] }))}
                className="inline-flex items-center gap-1 text-xs font-medium text-zinc-200 hover:text-zinc-100"
              >
                <Plus className="h-4 w-4" /> Add rule
              </button>
            )}
          </section>

          {/* Behaviour */}
          <section className="space-y-3">
            <h3 className="text-xs font-medium text-zinc-400">
              And behaviour <span className="font-normal normal-case tracking-normal text-zinc-600">all must hold</span>
            </h3>
            {definition.behavior.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.015] p-3">
                <NativeSelect aria-label="Did or did not" value={b.op} onChange={(e) => setBehavior(i, { op: e.target.value as BehaviorCondition["op"] })} className={select}>
                  <option value="did" className="bg-zinc-900">Did</option>
                  <option value="did_not" className="bg-zinc-900">Never did</option>
                </NativeSelect>
                <NativeSelect aria-label="Page or event" value={b.kind} onChange={(e) => setBehavior(i, { kind: e.target.value as BehaviorCondition["kind"] })} className={select}>
                  <option value="pageview" className="bg-zinc-900">visit page</option>
                  <option value="custom_event" className="bg-zinc-900">trigger event</option>
                </NativeSelect>
                <input
                  aria-label="Page path or event name"
                  value={b.target}
                  onChange={(e) => setBehavior(i, { target: e.target.value })}
                  placeholder={b.kind === "pageview" ? "/checkout" : "purchase_completed"}
                  className={`${input} min-w-[140px] flex-1 font-mono`}
                />
                <span className="text-xs text-zinc-500">in the last</span>
                <NativeSelect aria-label="Time window" value={b.days} onChange={(e) => setBehavior(i, { days: Number(e.target.value) })} className={select}>
                  {[7, 30, 90, 365].map((d) => (
                    <option key={d} value={d} className="bg-zinc-900">
                      {d} days
                    </option>
                  ))}
                </NativeSelect>
                <button
                  type="button"
                  aria-label="Remove behaviour rule"
                  onClick={() => setDefinition((d) => ({ ...d, behavior: d.behavior.filter((_, idx) => idx !== i) }))}
                  className="rounded p-2 text-zinc-500 hover:text-[#e5484d]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {definition.behavior.length < 4 && (
              <button
                type="button"
                onClick={() =>
                  setDefinition((d) => ({ ...d, behavior: [...d.behavior, { op: "did_not", kind: "pageview", target: "", days: 30 }] }))
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-zinc-200 hover:text-zinc-100"
              >
                <Plus className="h-4 w-4" /> Add behaviour
              </button>
            )}
          </section>

          {/* Live count */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4" aria-live="polite">
            {!hasRules ? (
              <p className="text-xs text-zinc-500">Add a rule to see who matches.</p>
            ) : previewError ? (
              <p className="flex items-center gap-2 text-xs text-[#e5484d]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {previewError}
              </p>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-medium tabular-nums text-zinc-50">
                      {preview ? `${preview.total.toLocaleString()}${preview.capped ? "+" : ""}` : "–"}
                    </span>
                    <span className="text-xs text-zinc-500">{preview?.total === 1 ? "person matches" : "people match"}</span>
                    {previewing && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
                  </p>
                  {incomplete && <p className="mt-1 text-xs text-zinc-600">Rules that are not filled in yet are ignored.</p>}
                </div>
                {preview && preview.profiles.length > 0 && (
                  <ul className="min-w-0 space-y-0.5 text-right">
                    {preview.profiles.slice(0, 4).map((p) => (
                      <li key={p.distinctId} className="truncate text-xs text-zinc-400">
                        {p.name || p.email || p.distinctId}
                      </li>
                    ))}
                    {preview.total > 4 && <li className="text-xs text-zinc-600">and {(preview.total - 4).toLocaleString()} more</li>}
                  </ul>
                )}
              </div>
            )}
          </div>

          {saveError && (
            <p className="flex items-center gap-2 rounded-lg border border-[#e5484d]/20 bg-[#e5484d]/10 px-3 py-2 text-xs text-[#e5484d]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {saveError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] p-4">
          <button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-xs font-medium text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || (touched && !valid)}
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-zinc-100 px-4 text-xs font-medium text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Saving…" : "Save segment"}
          </button>
        </div>
    </ModalFrame>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  invalid,
}: {
  condition: ProfileCondition;
  onChange: (next: ProfileCondition) => void;
  onRemove: () => void;
  invalid: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${invalid ? "border-[#e5484d]/30 bg-[#e5484d]/[0.04]" : "border-white/[0.07] bg-white/[0.015]"}`}>
      <NativeSelect
        aria-label="Rule type"
        value={condition.field}
        onChange={(e) => onChange(blankCondition(e.target.value as ProfileCondition["field"]))}
        className={select}
      >
        {FIELDS.map((f) => (
          <option key={f.key} value={f.key} className="bg-zinc-900">
            {f.label}
          </option>
        ))}
      </NativeSelect>

      {condition.field === "trait" && (
        <>
          <input
            aria-label="Trait name"
            list="segment-trait-keys"
            value={condition.key}
            onChange={(e) => onChange({ ...condition, key: e.target.value })}
            placeholder="plan"
            className={`${input} w-28 font-mono`}
          />
          <NativeSelect aria-label="Operator" value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as typeof condition.op })} className={select}>
            <option value="eq" className="bg-zinc-900">is</option>
            <option value="neq" className="bg-zinc-900">is not</option>
            <option value="contains" className="bg-zinc-900">contains</option>
            <option value="gt" className="bg-zinc-900">is greater than</option>
            <option value="lt" className="bg-zinc-900">is less than</option>
            <option value="exists" className="bg-zinc-900">is set</option>
            <option value="missing" className="bg-zinc-900">is not set</option>
          </NativeSelect>
          {condition.op !== "exists" && condition.op !== "missing" && (
            <input
              aria-label="Value"
              value={condition.value ?? ""}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder="pro"
              className={`${input} min-w-[100px] flex-1`}
            />
          )}
        </>
      )}

      {(condition.field === "lastSeen" || condition.field === "firstSeen") && (
        <>
          <NativeSelect aria-label="Operator" value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as "within" | "before" })} className={select}>
            <option value="within" className="bg-zinc-900">in the last</option>
            <option value="before" className="bg-zinc-900">more than</option>
          </NativeSelect>
          <input
            aria-label="Days"
            type="number"
            min={1}
            max={3650}
            value={condition.days}
            onChange={(e) => onChange({ ...condition, days: Math.max(1, Math.min(3650, Number(e.target.value) || 1)) })}
            className={`${input} w-20`}
          />
          <span className="text-xs text-zinc-500">{condition.op === "within" ? "days" : "days ago"}</span>
        </>
      )}

      {(condition.field === "sessions" || condition.field === "events") && (
        <>
          <NativeSelect aria-label="Operator" value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as "gte" | "lte" })} className={select}>
            <option value="gte" className="bg-zinc-900">at least</option>
            <option value="lte" className="bg-zinc-900">at most</option>
          </NativeSelect>
          <input
            aria-label="Count"
            type="number"
            min={0}
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: Math.max(0, Number(e.target.value) || 0) })}
            className={`${input} w-24`}
          />
        </>
      )}

      {condition.field === "email" && (
        <>
          <NativeSelect aria-label="Operator" value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as "exists" | "missing" | "contains" })} className={select}>
            <option value="exists" className="bg-zinc-900">is set</option>
            <option value="missing" className="bg-zinc-900">is not set</option>
            <option value="contains" className="bg-zinc-900">contains</option>
          </NativeSelect>
          {condition.op === "contains" && (
            <input
              aria-label="Value"
              value={condition.value ?? ""}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder="@company.com"
              className={`${input} min-w-[120px] flex-1`}
            />
          )}
        </>
      )}

      <button type="button" aria-label="Remove rule" onClick={onRemove} className="ml-auto rounded p-2 text-zinc-500 hover:text-[#e5484d]">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
