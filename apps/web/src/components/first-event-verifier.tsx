"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type FirstEventStatus = {
  received: boolean;
  firstEventAt: string | null;
  totalEvents: number;
};

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 40; // ~2 minutes

/**
 * Polls the real ingestion pipeline for a site's first event instead of
 * assuming installation succeeded once the snippet is shown.
 */
export function FirstEventVerifier({ siteId }: { siteId: string }) {
  const [status, setStatus] = useState<"waiting" | "received" | "timeout">("waiting");
  const attemptsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (cancelled) return;
      attemptsRef.current += 1;

      try {
        const response = await fetch(`/api/v1/sites/${siteId}/first-event`);
        if (response.ok) {
          const payload = (await response.json()) as FirstEventStatus;
          if (payload.received) {
            if (!cancelled) setStatus("received");
            return;
          }
        }
      } catch {
        // Transient network error — fall through and retry.
      }

      if (attemptsRef.current >= MAX_ATTEMPTS) {
        if (!cancelled) setStatus("timeout");
        return;
      }

      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [siteId]);

  if (status === "received") {
    return (
      <div
        className="rounded-xl p-4 flex items-center justify-between"
        style={{
          background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.25)",
        }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-emerald-300">First event received!</div>
            <div className="text-xs text-emerald-500 mt-0.5">Your tracker is installed correctly.</div>
          </div>
        </div>
        <Badge variant="success">Verified</Badge>
      </div>
    );
  }

  if (status === "timeout") {
    return (
      <div
        className="rounded-xl p-4 flex items-start gap-3"
        style={{
          background: "rgba(234,179,8,0.06)",
          border: "1px solid rgba(234,179,8,0.2)",
        }}
      >
        <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-amber-300">Still waiting for your first event</div>
          <div className="text-xs text-amber-500/80 mt-0.5">
            Double-check the snippet is installed, then visit your site — reopen this page to check again.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4 flex items-center gap-3"
      style={{
        background: "rgba(59,130,246,0.05)",
        border: "1px solid rgba(59,130,246,0.15)",
      }}
    >
      <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
      <div>
        <div className="text-sm font-semibold text-zinc-200">Waiting for your first event…</div>
        <div className="text-xs text-zinc-500 mt-0.5">Visit your website after installing the snippet above.</div>
      </div>
    </div>
  );
}
