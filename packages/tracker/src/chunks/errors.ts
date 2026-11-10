import { createErrorCapture } from "../errors/attach.js";

// Entry for the standalone error-capture chunk: hands the API to the loader (lazy.ts) on its own script tag.
const self = document.currentScript as (HTMLScriptElement & { _gi?: unknown }) | null;
if (self) self._gi = { createErrorCapture };
