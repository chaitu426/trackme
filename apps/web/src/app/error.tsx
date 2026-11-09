"use client";

import { motion } from "motion/react";
import { GlyphField } from "@trackme/landing";
import { Button } from "@/components/ui/button";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-background px-6 text-center">
      {/* The pulse picture: activity radiating from a point, the product's way of saying "something is happening here". */}
      <div className="relative h-40 w-64" aria-hidden="true">
        <GlyphField variant="pulse" cell={9} className="absolute inset-0 h-full w-full" />
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }} className="flex flex-col items-center">
        <p className="font-mono text-xs text-zinc-500">Something went wrong</p>
        <h1 className="mt-3 text-[28px] font-medium leading-9 text-zinc-50">This page could not be loaded</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-400">Nothing you did caused this, and your data is safe. Try again, and if it keeps happening let us know.</p>
        {error.digest && <p className="mt-3 font-mono text-xs text-zinc-600">Ref {error.digest}</p>}
        <Button className="mt-6" size="lg" onClick={reset}>
          Try again
        </Button>
      </motion.div>
    </div>
  );
}
