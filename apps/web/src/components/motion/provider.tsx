"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/**
 * One setting for every animation in the app. Springs with no bounce (this is a product people check numbers in, so nothing
 * overshoots), and `reducedMotion="user"` turns off movement for people who ask for less of it while keeping fades.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}>
      {children}
    </MotionConfig>
  );
}
