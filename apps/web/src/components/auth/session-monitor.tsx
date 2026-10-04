"use client";

import { useEffect, useState } from "react";
import { Clock, RefreshCw, X } from "lucide-react";

export function SessionMonitor() {
  const [remainingMinutes, setRemainingMinutes] = useState<number | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        if (data.authenticated && typeof data.remainingSeconds === "number") {
          const mins = Math.floor(data.remainingSeconds / 60);
          setRemainingMinutes(mins);
          // If more than 20 minutes remaining, reset dismissal
          if (mins > 20) {
            setWarningDismissed(false);
          }
        }
      } catch {
        // Silent fail
      }
    }

    checkSession();
    // Check every 3 minutes
    const interval = setInterval(checkSession, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleRefreshSession() {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/auth/session", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const mins = Math.floor((data.remainingSeconds || 86400) / 60);
        setRemainingMinutes(mins);
        setWarningDismissed(true);
      }
    } catch {
      // Ignore
    } finally {
      setIsRefreshing(false);
    }
  }

  // Only show warning if less than 15 minutes remain and not dismissed
  if (remainingMinutes === null || remainingMinutes > 15 || warningDismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full bg-amber-500/10 dark:bg-amber-950/40 border border-amber-500/30 backdrop-blur-md rounded-2xl p-4 shadow-xl flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
        <Clock className="w-4 h-4" />
      </div>
      <div className="flex-1 text-xs">
        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Session Expiring Soon</p>
        <p className="text-zinc-600 dark:text-zinc-400 mt-0.5">
          Your secure session will expire in{" "}
          <span className="font-bold text-amber-600 dark:text-amber-400">
            {remainingMinutes <= 1 ? "less than a minute" : `${remainingMinutes} minutes`}
          </span>
          .
        </p>
        <div className="flex items-center gap-2 mt-2.5">
          <button
            onClick={handleRefreshSession}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium text-[11px] hover:opacity-90 transition"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`} />
            Extend Session
          </button>
          <button
            onClick={() => setWarningDismissed(true)}
            className="px-2 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        onClick={() => setWarningDismissed(true)}
        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
