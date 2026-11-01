import type { EventProperties } from "@trackme/contracts";

type Track = (name: string, properties: EventProperties) => void;

const DOWNLOAD_EXTENSIONS = new Set([
  "pdf", "zip", "gz", "tar", "rar", "7z", "dmg", "exe", "msi", "pkg", "apk", "deb",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "mp3", "mp4", "mov", "wav", "epub",
]);

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** True when one host is the other or a subdomain of it, ignoring a leading "www.". */
export function isSameSite(host: string, base: string): boolean {
  const h = bareHost(host);
  const b = bareHost(base);
  return h === b || h.endsWith(`.${b}`) || b.endsWith(`.${h}`);
}

export function downloadExtension(pathname: string): string | null {
  const name = pathname.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return DOWNLOAD_EXTENSIONS.has(ext) ? ext : null;
}

/**
 * Describes a link click worth recording: a file download, or a link that leaves the site.
 * Link text is left out on purpose: it can hold names or other personal data.
 */
export function describeLink(
  href: string,
  currentHost: string
): { name: "file_download" | "outbound_click"; properties: EventProperties } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const ext = downloadExtension(url.pathname);
  if (ext) {
    return {
      name: "file_download",
      properties: { file: (url.pathname.split("/").pop() ?? "").slice(0, 128), ext, host: url.hostname.slice(0, 128) },
    };
  }
  if (!isSameSite(url.hostname, currentHost)) {
    return {
      name: "outbound_click",
      properties: { url: `${url.origin}${url.pathname}`.slice(0, 256), host: url.hostname.slice(0, 128) },
    };
  }
  return null;
}

/** Records outbound link clicks and file downloads. `flush` runs because the page may be about to unload. */
export function listenForLinkClicks(track: Track, flush: () => void): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const anchor =
      target && typeof target.closest === "function" ? (target.closest("a[href]") as HTMLAnchorElement | null) : null;
    if (!anchor) return;
    const described = describeLink(anchor.href, window.location.hostname);
    if (!described) return;
    track(described.name, described.properties);
    flush();
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onClick, true);
  };
}

const DEPTHS = [25, 50, 75, 100] as const;

/** Furthest scroll depth reached on a page, reported once per quarter. `reset` starts a new page. */
export function listenForScrollDepth(track: Track): { reset: () => void; stop: () => void } {
  const sent = new Set<number>();
  let frame: number | null = null;

  const measure = () => {
    frame = null;
    const doc = document.documentElement;
    const total = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
    // A page that fits on the screen has no scrolling to report.
    if (total <= window.innerHeight * 1.2) return;
    const depth = ((window.scrollY + window.innerHeight) / total) * 100;
    for (const mark of DEPTHS) {
      // 100% is reached a few pixels short of the very bottom on most browsers.
      if (depth >= (mark === 100 ? 98 : mark) && !sent.has(mark)) {
        sent.add(mark);
        track("scroll_depth", { depth: mark });
      }
    }
  };
  const onScroll = () => {
    if (frame === null) frame = window.requestAnimationFrame(measure);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  return {
    reset: () => sent.clear(),
    stop: () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    },
  };
}
