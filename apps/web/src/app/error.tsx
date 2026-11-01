"use client";

import { AlertTriangle } from "lucide-react";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-background px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h1 className="mt-4 text-xl font-bold tracking-tight text-zinc-50">Something went wrong</h1>
      <p className="mt-1.5 max-w-sm text-xs text-zinc-400">
        We could not load this page. Try again, and if it keeps happening let us know.
      </p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-zinc-500">Ref: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex h-9 items-center rounded-md bg-zinc-100 px-4 text-xs font-medium text-zinc-950 transition-colors hover:bg-white"
      >
        Try again
      </button>
    </div>
  );
}
