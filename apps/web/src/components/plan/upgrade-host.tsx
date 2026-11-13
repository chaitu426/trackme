"use client";

import * as React from "react";
import Link from "next/link";
import { resourceLabel, type LimitedResource } from "@trackme/contracts";
import { Dialog } from "@/components/ui/dialog";
import { Button, buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { GlyphMeter } from "@/components/ui/glyph-meter";
import { PlanBadge } from "@/components/plan/plan-badge";
import { proHighlights } from "@/lib/plan-copy";
import { cn } from "@/lib/utils";

interface PlanProblem {
  code: string;
  detail: string;
  plan: { plan: string; resource: string; limit: number | null; current: number; upgradeTo: string | null };
}

const EXTRA_LABEL: Record<string, string> = { retention: "Months of history" };

function isPlanProblem(body: unknown): body is PlanProblem {
  const b = body as Partial<PlanProblem> | null;
  return !!b && (b.code === "PLAN_LIMIT" || b.code === "PLAN_FEATURE") && !!b.plan && typeof b.detail === "string";
}

/**
 * Turns any "your plan does not allow this" answer into the same upgrade prompt. It listens to the app's own API calls
 * and, when one comes back 402 with plan details, opens a dialog saying what was hit and what Pro adds. The call's own
 * error handling is untouched (the response is cloned, not consumed), so every form still shows its message too and no
 * individual form needs to know about plans.
 */
export function UpgradeHost({ workspaceSlug, canUpgrade }: { workspaceSlug: string; canUpgrade: boolean }) {
  const [problem, setProblem] = React.useState<PlanProblem | null>(null);

  React.useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof window.fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 402) {
        response
          .clone()
          .json()
          .then((body: unknown) => {
            if (isPlanProblem(body)) setProblem((open) => open ?? body);
          })
          .catch(() => {});
      }
      return response;
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, []);

  const close = () => setProblem(null);
  const limited = problem?.code === "PLAN_LIMIT" && problem.plan.limit !== null;
  const label = problem ? (EXTRA_LABEL[problem.plan.resource] ?? resourceLabel(problem.plan.resource as LimitedResource) ?? problem.plan.resource) : "";
  const canGoUp = canUpgrade && problem?.plan.upgradeTo === "pro";

  return (
    <Dialog
      open={problem !== null}
      onClose={close}
      title={problem?.code === "PLAN_FEATURE" ? "Available on Pro" : "You have reached your plan's limit"}
      description={problem?.detail ?? ""}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            Not now
          </Button>
          {canGoUp ? (
            <Link href={`/${workspaceSlug}/settings/billing`} onClick={close} className={cn(buttonBase, buttonVariants.primary, buttonSizes.sm)}>
              See plans
            </Link>
          ) : null}
        </div>
      }
    >
      {problem && (
        <div className="space-y-5">
          {limited && <GlyphMeter label={String(label)} value={problem.plan.current} limit={problem.plan.limit} />}
          {problem.plan.upgradeTo === "pro" ? (
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
                <PlanBadge plan="pro" /> adds
              </p>
              <ul className="space-y-1.5 font-mono text-xs leading-5 text-zinc-300">
                {proHighlights().map((line) => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden="true" className="text-zinc-500">
                      +
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
              {!canUpgrade && <p className="mt-3 text-xs text-zinc-500">Only the company owner can change the plan. Ask them to upgrade.</p>}
            </div>
          ) : (
            <p className="text-xs text-zinc-400">This is the highest plan, so the limit is a hard one. Remove something to make room.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
