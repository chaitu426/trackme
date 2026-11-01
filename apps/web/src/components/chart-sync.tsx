"use client";

import * as React from "react";

interface ChartSync {
  /** Index of the bucket (hour or day) being hovered in any linked chart, or null. */
  index: number | null;
  set: (index: number | null) => void;
}

const SyncContext = React.createContext<ChartSync | null>(null);

/**
 * Links charts that plot the same buckets: hover a day on one and the same day lights up
 * on the others. Charts outside the provider behave as before.
 */
export function ChartSyncProvider({ children }: { children: React.ReactNode }) {
  const [index, set] = React.useState<number | null>(null);
  const value = React.useMemo(() => ({ index, set }), [index]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useChartSync(): ChartSync | null {
  return React.useContext(SyncContext);
}
