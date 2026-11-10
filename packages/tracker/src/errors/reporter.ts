import { scrubText } from "@trackme/contracts/scrub";
import type { ErrorPayload } from "@trackme/contracts";
import { parseStack } from "./stack.js";

type Level = NonNullable<ErrorPayload["level"]>;
type CrumbKind = "navigation" | "click" | "fetch" | "log";

export const MAX_CRUMBS = 20;
export const MAX_TAGS = 10;
/** The same issue is sent at most once per this long per page view. */
export const DEDUPE_MS = 10_000;
/** Hard cap on errors sent per browser session, so a render loop cannot flood the pipeline. */
export const SESSION_CAP = 50;
const MAX_REMEMBERED = 100;

export interface ReportInput {
  type: string;
  message: string;
  stack?: string | undefined;
  level?: Level | undefined;
  fingerprint?: string | undefined;
  tags?: Record<string, string> | undefined;
  /** Extra frame when there is no stack, e.g. the file and line of an ErrorEvent. */
  frame?: { file: string; line?: number; col?: number } | undefined;
}

export interface ReporterOptions {
  send(payload: ErrorPayload): void;
  /** The page's origin, to tell the app's own frames from library and third-party ones. */
  origin: string;
  now?: () => number;
  /** Errors already sent in this browser session (kept in sessionStorage by the caller). */
  session: { get(): number; set(count: number): void };
}

/**
 * Collects context and decides what is worth sending. Nothing here touches the page, so every rule is testable.
 * Nothing here throws either: the caller is a global error handler and must never raise a second error.
 */
export function createReporter(options: ReporterOptions) {
  const now = options.now ?? Date.now;
  const tags: Record<string, string> = {};
  const crumbs: Array<{ ts: number; k: CrumbKind; m: string }> = [];
  const lastSent = new Map<string, number>();

  return {
    /** Keeps the last MAX_CRUMBS actions leading up to an error. Text is scrubbed here, not later. */
    addCrumb(k: CrumbKind, text: string): void {
      try {
        crumbs.push({ ts: now(), k, m: scrubText(text).slice(0, 200) });
        if (crumbs.length > MAX_CRUMBS) crumbs.shift();
      } catch {
        // breadcrumbs are best-effort
      }
    },

    /** Tags travel with every later error. At most MAX_TAGS; a new key past the limit is ignored. */
    setTag(key: string, value: string): void {
      try {
        if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(key)) return;
        if (!(key in tags) && Object.keys(tags).length >= MAX_TAGS) return;
        tags[key] = scrubText(String(value)).slice(0, 200);
      } catch {
        // ignore
      }
    },

    /** Returns true when an error was sent, false when it was dropped as a repeat or over the session cap. */
    capture(input: ReportInput): boolean {
      try {
        const frames = parseStack(input.stack, options.origin);
        if (frames.length === 0 && input.frame) {
          frames.push({ ...input.frame, inApp: input.frame.file.startsWith(options.origin) });
        }

        const top = frames[0];
        const key = `${input.type}|${input.message.slice(0, 200)}|${top ? `${top.fn ?? ""}@${top.file}` : ""}`;
        const time = now();
        const previous = lastSent.get(key);
        if (previous !== undefined && time - previous < DEDUPE_MS) return false;

        const count = options.session.get();
        if (count >= SESSION_CAP) return false;

        lastSent.delete(key);
        lastSent.set(key, time);
        if (lastSent.size > MAX_REMEMBERED) lastSent.delete(lastSent.keys().next().value as string);
        options.session.set(count + 1);

        const merged = { ...tags, ...(input.tags ?? {}) };
        const tagEntries = Object.entries(merged).slice(0, MAX_TAGS);
        options.send({
          type: input.type.slice(0, 128) || "Error",
          message: scrubText(input.message).slice(0, 1024),
          level: input.level ?? "error",
          ...(input.fingerprint ? { fingerprint: input.fingerprint.slice(0, 128) } : {}),
          ...(frames.length > 0 ? { frames } : {}),
          ...(crumbs.length > 0 ? { breadcrumbs: crumbs.slice() } : {}),
          ...(tagEntries.length > 0
            ? { tags: Object.fromEntries(tagEntries.map(([k, v]) => [k, scrubText(String(v)).slice(0, 200)])) }
            : {}),
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export type Reporter = ReturnType<typeof createReporter>;
