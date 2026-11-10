import { scrubUrl } from "@trackme/contracts/scrub";

export interface Frame {
  fn?: string;
  file: string;
  line?: number;
  col?: number;
  inApp?: boolean;
}

const MAX_FRAMES = 50;
const NOT_A_FILE = /^(?:<anonymous>|\[native code\]|native|eval|undefined)?$/;

/**
 * Turns an Error's `stack` into frames, innermost first. Reads the two real-world formats:
 *   V8 (Chrome, Edge, Node):   "    at fn (https://x/app.js:10:5)"  /  "    at https://x/app.js:10:5"
 *   Firefox and Safari:        "fn@https://x/app.js:10:5"           /  "@https://x/app.js:10:5"
 * Lines that are not frames (the "TypeError: message" header, "[native code]") are skipped. Linear in the
 * stack's length; stops at 50 frames. A frame is the app's own code when it comes from this page's origin
 * and not from node_modules.
 */
export function parseStack(stack: string | undefined, origin: string): Frame[] {
  const frames: Frame[] = [];
  if (!stack) return frames;

  for (const raw of stack.split("\n")) {
    if (frames.length >= MAX_FRAMES) break;
    let line = raw.trim();
    let fn = "";
    let location = "";

    if (line.startsWith("at ")) {
      line = line.slice(3).replace(/^async /, "");
      const open = line.endsWith(")") ? line.indexOf(" (") : -1;
      fn = open > 0 ? line.slice(0, open) : "";
      location = open > 0 ? line.slice(open + 2, -1) : line;
    } else {
      const at = line.indexOf("@");
      if (at < 0) continue;
      fn = line.slice(0, at);
      location = line.slice(at + 1);
    }

    const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(location);
    const file = match ? match[1]! : location;
    if (NOT_A_FILE.test(file)) continue;

    frames.push({
      ...(fn && fn !== "global code" ? { fn: fn.slice(0, 200) } : {}),
      file: scrubUrl(file).slice(0, 512),
      ...(match ? { line: Number(match[2]), ...(match[3] ? { col: Number(match[3]) } : {}) } : {}),
      inApp: file.startsWith(origin) && !file.includes("node_modules"),
    });
  }
  return frames;
}
