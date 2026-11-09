"use client";

import { MatrixSpinner } from "@/components/ui/matrix-loader";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, RotateCcw } from "lucide-react";
import type { ErrorAction, ErrorStatus } from "@trackme/contracts";

const BUTTON =
  "inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50";

/** Resolve, resolve-in-next-release, ignore and reopen for one issue. Viewers see no buttons: the API also refuses them. */
export function ErrorStatusActions({
  siteId,
  groupId,
  status,
  canEdit,
}: {
  siteId: string;
  groupId: string;
  status: ErrorStatus;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<ErrorAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!canEdit) return null;

  async function run(action: ErrorAction) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/errors/${groupId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? "Could not update the issue");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the issue");
    } finally {
      setBusy(null);
    }
  }

  const spinner = (action: ErrorAction) => (busy === action ? <MatrixSpinner /> : null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "open" ? (
        <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void run("reopen")}>
          {spinner("reopen") ?? <RotateCcw className="h-3.5 w-3.5" />}
          Reopen
        </button>
      ) : (
        <>
          <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void run("resolve")}>
            {spinner("resolve") ?? <Check className="h-3.5 w-3.5 text-[#4cc38a]" />}
            Resolve
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={busy !== null}
            title="Old versions still in the wild may keep raising it; it reopens only if a newer release does"
            onClick={() => void run("resolve_next_release")}
          >
            {spinner("resolve_next_release")}
            Resolve in next release
          </button>
          <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void run("ignore")}>
            {spinner("ignore") ?? <EyeOff className="h-3.5 w-3.5" />}
            Ignore
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="text-xs text-[#e5484d]">
          {error}
        </span>
      )}
    </div>
  );
}
