/**
 * Raise a toast from anywhere (a click handler, a fetch callback), without a hook or a provider in between.
 * The <Toaster /> mounted once in the root layout listens for the event. On the server, or before the toaster is mounted,
 * the call does nothing.
 */
export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before it leaves by itself. Errors stay longer. */
  duration?: number;
}

export const TOAST_EVENT = "trackme:toast";

export function toast(input: ToastInput | string): void {
  if (typeof window === "undefined") return;
  const detail: ToastInput = typeof input === "string" ? { title: input } : input;
  window.dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT, { detail }));
}

toast.success = (title: string, description?: string) => toast({ title, tone: "success", ...(description ? { description } : {}) });
toast.error = (title: string, description?: string) => toast({ title, tone: "error", ...(description ? { description } : {}) });

/** How long a toast stays: errors are read more slowly than confirmations. */
export function toastDuration(input: ToastInput): number {
  return input.duration ?? (input.tone === "error" ? 6000 : 3500);
}
