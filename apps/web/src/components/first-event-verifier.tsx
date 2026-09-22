"use client";

import { useEffect, useRef, useState } from "react";
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
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-emerald-300">First event received!</div>
          <div className="text-xs text-emerald-400/80">Your tracker is installed correctly.</div>
        </div>
        <Badge variant="success">Verified</Badge>
      </div>
    );
  }

  if (status === "timeout") {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="text-sm font-semibold text-amber-300">Still waiting for your first event</div>
        <div className="text-xs text-amber-400/80">
          Double-check the snippet is installed, then visit your site — reopen this page to check again.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-[#141824] p-4 flex items-center space-x-3">
      <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
      <div>
        <div className="text-sm font-semibold text-white">Waiting for your first event…</div>
        <div className="text-xs text-slate-400">Visit your website after installing the snippet above.</div>
      </div>
    </div>
  );
}
