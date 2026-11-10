import { createHash } from "node:crypto";
import type { ErrorPayload } from "@trackme/contracts";

/**
 * Error grouping. Two reports are the same issue when they have the same type, the same message once
 * the changing parts are stripped, and the same top in-app stack frames. Line and column numbers are
 * left out on purpose: they change with every minified build, while function and file names do not.
 */

const FRAMES_USED = 3;
const MESSAGE_USED = 200;

/** Replaces the parts of a message that differ between occurrences of the same bug. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>)]+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\d+(?:\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MESSAGE_USED);
}

/** `https://cdn.test/assets/app.3f2a.js?v=1` becomes `app.js`: the content hash in a bundle name changes per build. */
export function fileBasename(file: string): string {
  const path = file.split(/[?#]/)[0] ?? file;
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  return name.replace(/[.-][0-9a-f]{6,}(?=\.)/gi, "");
}

export function frameKeys(error: ErrorPayload): string[] {
  const frames = error.frames ?? [];
  const inApp = frames.filter((frame) => frame.inApp === true);
  return (inApp.length > 0 ? inApp : frames)
    .slice(0, FRAMES_USED)
    .map((frame) => `${frame.fn || "<anonymous>"}@${fileBasename(frame.file)}`);
}

/** The text a group is identified by, before hashing. A custom fingerprint from the SDK wins. */
export function fingerprintKey(error: ErrorPayload): string {
  if (error.fingerprint) return `custom|${error.fingerprint}`;
  return [error.type, normalizeMessage(error.message), ...frameKeys(error)].join("|");
}

/**
 * A 64-bit group id as a decimal string (ClickHouse UInt64). The site id is part of the hash, so the same
 * bug on two sites gets two ids and no id is shared across tenants.
 */
export function groupId(siteId: string, error: ErrorPayload): string {
  const digest = createHash("sha256").update(`${siteId}|${fingerprintKey(error)}`).digest();
  return digest.readBigUInt64BE(0).toString();
}

/** A one-line title for the issue list: the type and the message as the visitor's browser reported it. */
export function errorTitle(error: ErrorPayload): string {
  const message = error.message.replace(/\s+/g, " ").trim();
  return (message ? `${error.type}: ${message}` : error.type).slice(0, 200);
}
