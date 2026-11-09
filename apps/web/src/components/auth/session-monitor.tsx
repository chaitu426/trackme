"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clock, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const CHECK_EVERY_MS = 3 * 60 * 1000;
const WARN_BELOW_MINUTES = 15;

/** Warns when the sign-in is about to end and offers to extend it. Quiet until fifteen minutes remain. */
export function SessionMonitor() {
  const [remainingMinutes, setRemainingMinutes] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        if (data.authenticated && typeof data.remainingSeconds === "number") {
          const mins = Math.floor(data.remainingSeconds / 60);
          setRemainingMinutes(mins);
          // A session that was extended elsewhere should be able to warn again later.
          if (mins > 20) setDismissed(false);
        }
      } catch {
        // The next check will try again.
      }
    }
    void check();
    const interval = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(interval);
  }, []);

  async function extend() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/auth/session", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setRemainingMinutes(Math.floor((data.remainingSeconds || 86400) / 60));
        setDismissed(true);
      }
    } catch {
      // The warning stays, so the person can try again.
    } finally {
      setRefreshing(false);
    }
  }

  const show = remainingMinutes !== null && remainingMinutes <= WARN_BELOW_MINUTES && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          className="fixed bottom-4 left-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-border bg-raised p-4 shadow-float"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <Clock className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-50">Your session is ending</p>
            <p className="mt-0.5 text-xs leading-5 text-zinc-400">
              You will be signed out in {remainingMinutes! <= 1 ? "less than a minute" : `${remainingMinutes} minutes`}.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={extend} loading={refreshing}>
                {!refreshing && <RefreshCw />}
                Stay signed in
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
            </div>
          </div>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="press -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 hover:text-zinc-100">
            <X className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
