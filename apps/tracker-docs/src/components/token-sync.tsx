"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { PLACEHOLDERS, STORAGE_KEY, type PlaceholderKey } from "@/lib/site";

export type Setup = Partial<Record<PlaceholderKey, string>>;
export const SETUP_EVENT = "trackme-docs-setup";

export function readSetup(): Setup {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Setup) : {};
  } catch {
    return {};
  }
}

export function writeSetup(setup: Setup): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // The values still apply for this visit.
  }
  window.dispatchEvent(new CustomEvent(SETUP_EVENT, { detail: setup }));
}

/** Rewrite every placeholder in the page's code samples with the reader's values. */
function apply(setup: Setup): void {
  const pairs = (Object.keys(PLACEHOLDERS) as PlaceholderKey[]).map(
    (key) => [PLACEHOLDERS[key], setup[key]?.trim() || PLACEHOLDERS[key]] as const
  );

  document.querySelectorAll<HTMLElement>(".code-body span").forEach((span) => {
    if (span.childElementCount > 0) return;
    const original = span.dataset.orig ?? span.textContent ?? "";
    if (!pairs.some(([placeholder]) => original.includes(placeholder))) return;

    span.dataset.orig = original;
    let next = original;
    for (const [placeholder, value] of pairs) next = next.split(placeholder).join(value);
    if (span.textContent !== next) span.textContent = next;
  });
}

/**
 * Keeps code samples in step with the "Your setup" menu. Runs on load, when the
 * values change, and after navigation or a tab switch brings new code on screen.
 */
export function TokenSync() {
  const pathname = usePathname();

  React.useEffect(() => {
    const run = () => apply(readSetup());
    run();

    const onSetup = (event: Event) => apply((event as CustomEvent<Setup>).detail ?? {});
    window.addEventListener(SETUP_EVENT, onSetup);

    let frame = 0;
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(run);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener(SETUP_EVENT, onSetup);
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
