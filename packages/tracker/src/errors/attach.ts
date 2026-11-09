import { scrubUrl } from "@trackme/contracts/scrub";
import type { ErrorPayload } from "@trackme/contracts";
import { createReporter, type Reporter } from "./reporter.js";

export interface ErrorsHost {
  /** Called with a finished, scrubbed report; the core wraps it in an event and queues it. */
  send(payload: ErrorPayload): void;
  /** The ingest endpoint. Requests to it are never recorded or reported, or a failing endpoint would report itself. */
  endpoint: string;
  /** Also report 4xx responses (5xx and network failures are always reported). */
  capture4xx?: boolean | undefined;
  /** Also report console.error calls. */
  captureConsole?: boolean | undefined;
}

const SESSION_KEY = "_gi_ec";

const sessionCounter = {
  get(): number {
    try {
      return Number(window.sessionStorage.getItem(SESSION_KEY)) || 0;
    } catch {
      return 0;
    }
  },
  set(count: number): void {
    try {
      window.sessionStorage.setItem(SESSION_KEY, String(count));
    } catch {
      // private mode: the cap then holds per page load only
    }
  },
};

/** A request's address without its query string or credentials: enough to read, nothing sensitive. */
function describeUrl(input: string): string {
  try {
    const url = new URL(scrubUrl(input), window.location.href);
    return url.origin === window.location.origin ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

/** `button#pay.primary "Pay now"`: what was clicked, never what was typed. */
function describeClick(target: Element): string | null {
  const el = target.closest("a,button,[role=button],input[type=button],input[type=submit],summary");
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  const id = el.id && /^[\w-]{1,30}$/.test(el.id) ? `#${el.id}` : "";
  const classes = Array.from(el.classList)
    .filter((name) => /^[\w-]{1,20}$/.test(name))
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join("");
  const label = (el.getAttribute("aria-label") || (tag === "input" ? "" : el.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return `${tag}${id}${classes}${label ? ` "${label}"` : ""}`;
}

/**
 * Starts capturing. Everything it patches is put back by stop(), and every handler swallows its own errors:
 * an observer of failures must not become one. fetch is wrapped without touching the caller's promise.
 */
export function createErrorCapture(host: ErrorsHost) {
  const reporter: Reporter = createReporter({
    send: host.send,
    origin: window.location.origin,
    session: sessionCounter,
  });
  const undo: Array<() => void> = [];
  const isOwn = (url: string) => url.startsWith(host.endpoint);

  const onRequest = (method: string, rawUrl: string, status: number, ms: number) => {
    try {
      if (isOwn(rawUrl)) return;
      const where = `${method} ${describeUrl(rawUrl)}`;
      reporter.addCrumb("fetch", `${where} ${status || "failed"} ${Math.round(ms)}ms`);
      if (status >= 500 || status === 0) {
        reporter.capture({ type: status === 0 ? "NetworkError" : "HttpError", message: `${where} ${status || "failed"}` });
      } else if (host.capture4xx && status >= 400) {
        reporter.capture({ type: "HttpError", message: `${where} ${status}`, level: "warning" });
      }
    } catch {
      // observing a request must never affect it
    }
  };

  const start = () => {
    const onError = (event: ErrorEvent) => {
      const error = event.error as Error | undefined;
      reporter.capture({
        type: error?.name || "Error",
        message: error?.message || event.message || "Unknown error",
        stack: error?.stack,
        ...(event.filename ? { frame: { file: scrubUrl(event.filename), line: event.lineno, col: event.colno } } : {}),
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      const error = reason instanceof Error ? reason : undefined;
      reporter.capture({
        type: error?.name || "UnhandledRejection",
        message: error?.message ?? (typeof reason === "string" ? reason : "Promise rejected"),
        stack: error?.stack,
      });
    };
    const onClick = (event: MouseEvent) => {
      const text = event.target instanceof Element ? describeClick(event.target) : null;
      if (text) reporter.addCrumb("click", text);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("click", onClick, true);
    undo.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("click", onClick, true);
    });

    if (typeof window.fetch === "function") {
      const original = window.fetch;
      const wrapped = function (this: unknown, ...args: Parameters<typeof fetch>) {
        const started = performance.now();
        let url = "";
        let method = "GET";
        try {
          // Reading the arguments must not throw: a bad call has to fail inside fetch, as it would without us.
          const request = args[0];
          url = typeof request === "string" ? request : request instanceof URL ? request.href : (request as Request).url;
          method = String(args[1]?.method || (request instanceof Request ? request.method : "GET")).toUpperCase();
        } catch {
          // keep the defaults
        }
        const result = original.apply(this, args);
        // Observe only; the caller still gets the original promise, with its own resolution and rejection.
        result.then(
          (response) => onRequest(method, url, response.status, performance.now() - started),
          () => onRequest(method, url, 0, performance.now() - started)
        );
        return result;
      };
      window.fetch = wrapped;
      undo.push(() => {
        if (window.fetch === wrapped) window.fetch = original;
      });
    }

    const xhr = window.XMLHttpRequest?.prototype;
    if (xhr) {
      const open = xhr.open;
      const send = xhr.send;
      const info = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
      xhr.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        info.set(this, { method: String(method).toUpperCase(), url: String(url) });
        return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
      } as typeof xhr.open;
      xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const started = performance.now();
        const meta = info.get(this);
        let aborted = false;
        this.addEventListener("abort", () => (aborted = true));
        this.addEventListener("loadend", () => {
          if (meta && !aborted) onRequest(meta.method, meta.url, this.status, performance.now() - started);
        });
        return send.call(this, body);
      };
      undo.push(() => {
        xhr.open = open;
        xhr.send = send;
      });
    }

    if (host.captureConsole) {
      const original = console.error;
      const wrapped = function (this: unknown, ...args: unknown[]) {
        original.apply(this, args);
        try {
          const first = args[0] instanceof Error ? args[0] : undefined;
          reporter.capture({
            type: first?.name || "ConsoleError",
            message: first?.message ?? args.map((a) => (typeof a === "string" ? a : String(a))).join(" ").slice(0, 1024),
            stack: first?.stack,
          });
        } catch {
          // never fail inside console.error
        }
      };
      console.error = wrapped;
      undo.push(() => {
        if (console.error === wrapped) console.error = original;
      });
    }
  };

  start();

  return {
    /** For errors the app catches itself: `captureException(err, { tags, level, fingerprint })`. */
    captureException(error: unknown, context?: { tags?: Record<string, string>; level?: ErrorPayload["level"]; fingerprint?: string }) {
      const err = error instanceof Error ? error : undefined;
      reporter.capture({
        type: err?.name || "Error",
        message: err?.message ?? (typeof error === "string" ? error : "Non-error value thrown"),
        stack: err?.stack,
        level: context?.level,
        fingerprint: context?.fingerprint,
        tags: context?.tags,
      });
    },
    captureMessage(message: string, level: ErrorPayload["level"] = "info") {
      reporter.capture({ type: "Message", message, level });
    },
    setTag: reporter.setTag,
    /** The tracker's router hook calls this on each route change. */
    navigated(path: string) {
      reporter.addCrumb("navigation", path);
    },
    stop() {
      for (const fn of undo.splice(0)) fn();
    },
  };
}

export type ErrorCapture = ReturnType<typeof createErrorCapture>;
