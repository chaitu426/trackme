/**
 * The shape of an Ask conversation. The interface is built on these types first, against a demo engine, so the backend phase has a
 * contract to meet: whatever produces an `Answer` (a planner that picks sources, a query builder that runs them) fills this in,
 * and the interface needs no change.
 *
 * Design rule behind the shape: a number on screen is never free-standing. Every figure in an answer cites an `EvidenceItem`, and
 * an evidence item always says where the data came from, the exact query, the range, how many rows and how long it took.
 */

export type SourceId = "traffic" | "errors" | "payments" | "releases" | "people";

export const SOURCES: Array<{ id: SourceId; label: string; detail: string }> = [
  { id: "traffic", label: "Traffic", detail: "Pageviews, sessions, sources, countries, devices, Web Vitals" },
  { id: "errors", label: "Errors", detail: "Issues, occurrences, releases they appeared in" },
  { id: "payments", label: "Payments", detail: "Gateway events, failures, refunds, checkout sessions" },
  { id: "releases", label: "Releases", detail: "Deploys and what each one changed" },
  { id: "people", label: "People", detail: "Identified users and their timelines" },
];

export type RangeId = "24h" | "7d" | "30d" | "90d";
export const RANGES: Array<{ id: RangeId; label: string }> = [
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
];

/** What the agent may look at and how. Everything here is visible to the person and changeable by them. */
export interface AskScope {
  workspaceSlug: string;
  /** Domains of the sites in scope. Defaults to the site being viewed. */
  siteDomains: string[];
  range: RangeId;
  sources: Record<SourceId, boolean>;
  /** Hide names, emails and other identifiers in results shown and sent to the model. */
  piiMasked: boolean;
  /** Most rows one query may return. */
  maxRows: number;
  /** Standing context the person gives the agent: what the business is, what words mean, what matters. */
  instructions: string;
}

export interface EvidenceItem {
  /** 1-based; this is the number in the citation chip, [1]. */
  n: number;
  title: string;
  source: SourceId;
  /** The table or rollup read, so a technical reader knows how big and how fresh it is. */
  table: string;
  language: "sql";
  query: string;
  /** Human text for the range the query covered. */
  range: string;
  rows: number;
  ms: number;
  columns: string[];
  /** A few result rows, enough to check the answer against. */
  sample: Array<Array<string | number>>;
  /** The page that shows the same data, so the claim can be checked there. */
  openHref?: string;
  note?: string;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "stats"; items: Array<{ label: string; value: string; delta?: string; tone?: "up" | "down"; cite?: number }> }
  | { type: "bars"; title: string; rows: Array<{ label: string; display: string; value: number; cite?: number }> }
  | { type: "table"; title: string; columns: string[]; rows: string[][]; cite?: number }
  | { type: "spark"; title: string; points: number[]; display: string; cite?: number }
  | { type: "callout"; tone: "info" | "warn"; text: string };

export interface Step {
  id: string;
  /** What the agent is doing, in a plain phrase: "Reading the failure classifications". */
  label: string;
  detail?: string;
  /** When the step reads a table: its name and how many rows it returned, so the interface can show the call and count up to the result. */
  tool?: { table: string; rows: number };
  ms: number;
}

export type Confidence = "high" | "medium" | "low";

/**
 * The money trail: TrackMe's own idea. Because errors, releases, gateways, checkout sessions and payments live in one place, an
 * answer can follow a problem from its cause to the rupees it cost, link by link, each link citing its evidence.
 */
export interface TrailNode {
  kind: "release" | "error" | "gateway" | "funnel" | "money";
  title: string;
  detail: string;
  /** When it happened, in plain words. */
  at?: string;
  cite?: number;
}
export interface Trail {
  nodes: TrailNode[];
  /** The bottom line: what it cost, and how sure that figure is. */
  total: { value: string; label: string; basis: string };
}

/** A standing check the person can arm from an answer, so a question asked once keeps being asked. */
export interface WatchSpec {
  id: string;
  title: string;
  /** What is measured, in words: "Razorpay success rate". */
  metric: string;
  /** When it fires, in words: "falls below 70% over 15 minutes". */
  condition: string;
  /** The value now, for context. */
  now: string;
}

export interface Answer {
  steps: Step[];
  blocks: Block[];
  evidence: EvidenceItem[];
  /** What the answer takes for granted, stated so it can be challenged. */
  assumptions: string[];
  confidence: Confidence;
  /** Questions that follow naturally. */
  followups: string[];
  /** Things the person could do next with TrackMe, beyond answering. */
  ideas: Array<{ title: string; detail: string }>;
  /** Cause-to-rupees chain, when the answer is about something that cost money. */
  trail?: Trail;
  /** A monitor this answer suggests; arming it is one click. */
  watch?: WatchSpec;
  /** Set when the question could not be answered from the connected sources; says what could be. */
  limit?: string;
}

export interface Turn {
  id: string;
  question: string;
  status: "thinking" | "done";
  /** How many steps have been revealed so far (the demo reveals them one by one, as a real run would stream them). */
  shownSteps: number;
  /** The steps of the run in progress, known up front by the demo; a streaming backend would append them as they happen. */
  pending?: Step[];
  answer?: Answer;
  /** Why the run could not answer. Shown as is; there is no stand-in answer. */
  error?: string;
}

export type PanelView = "ask" | "history" | "configure";

export interface PastQuestion {
  id: string;
  question: string;
  at: string;
  page: string;
}

export const DEFAULT_SCOPE = (workspaceSlug: string, siteDomain: string | null): AskScope => ({
  workspaceSlug,
  siteDomains: siteDomain ? [siteDomain] : [],
  range: "30d",
  sources: { traffic: true, errors: true, payments: true, releases: true, people: false },
  piiMasked: true,
  maxRows: 1_000,
  instructions: "",
});
