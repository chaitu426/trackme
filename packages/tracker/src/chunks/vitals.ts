import { observeWebVitals } from "../vitals.js";

// Entry for the standalone web-vitals chunk: hands the API to the loader (lazy.ts) on its own script tag.
const self = document.currentScript as (HTMLScriptElement & { _gi?: unknown }) | null;
if (self) self._gi = { observeWebVitals };
