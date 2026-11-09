"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { DrawCheck } from "@/components/motion/primitives";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-background px-6 text-center">
      <DrawCheck tone="bad" size={48} />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }} className="flex flex-col items-center">
        <h1 className="mt-6 text-[28px] font-medium leading-9 text-zinc-50">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-sm leading-5 text-zinc-400">This page could not be loaded. Try again, and if it keeps happening let us know.</p>
        {error.digest && <p className="mt-3 font-mono text-xs text-zinc-600">Ref {error.digest}</p>}
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </motion.div>
    </div>
  );
}
