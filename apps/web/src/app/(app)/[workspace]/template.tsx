"use client";

import { motion } from "motion/react";

/**
 * Re-mounts on every navigation inside the signed-in app, so each page arrives with the same short fade. Opacity only: the
 * blocks inside a page already rise on their own, and one movement per page is enough.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="flex w-full flex-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}
