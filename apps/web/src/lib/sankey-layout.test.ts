import assert from "node:assert/strict";
import test from "node:test";
import { buildFlowGraph, buildSegmentTable, buildTrace } from "@trackme/analytics";
import { layoutSankey } from "./sankey-layout";

// 10 sessions: 6 go / -> /pricing, 3 go / -> /docs, 1 stops on /. Of the 6, 4 reach /signup and 2 stop.
const rows = [
  { step: 1, node: "/", next: "/pricing", sessions: 6 },
  { step: 1, node: "/", next: "/docs", sessions: 3 },
  { step: 1, node: "/", next: "", sessions: 1 },
  { step: 2, node: "/pricing", next: "/signup", sessions: 4 },
  { step: 2, node: "/pricing", next: "", sessions: 2 },
  { step: 2, node: "/docs", next: "", sessions: 3 },
  { step: 3, node: "/signup", next: "", sessions: 4 },
];

test("every session is accounted for in the flow graph", () => {
  const graph = buildFlowGraph(rows);
  assert.equal(graph.totalSessions, 10);
  const col = (step: number) => graph.nodes.filter((n) => n.step === step).reduce((s, n) => s + n.sessions, 0);
  assert.equal(col(1), 10);
  // column 2: the 9 who continued from / plus the 1 who exited after it
  assert.equal(col(2), 10);
});

test("pages beyond the per-column limit fold into one other node", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ step: 1, node: `/p${i}`, next: "", sessions: 10 - i }));
  const graph = buildFlowGraph(many, 3);
  const pages = graph.nodes.filter((n) => n.step === 1).map((n) => n.page);
  assert.equal(pages.length, 4);
  assert.ok(pages.includes("__other__"));
});

test("layout keeps nodes in a column from overlapping and inside the canvas", () => {
  const layout = layoutSankey(buildFlowGraph(rows));
  const byStep = new Map<number, typeof layout.nodes>();
  for (const n of layout.nodes) byStep.set(n.step, [...(byStep.get(n.step) ?? []), n]);
  for (const col of byStep.values()) {
    const sorted = [...col].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i]!.y >= sorted[i - 1]!.y + sorted[i - 1]!.h);
  }
  assert.ok(layout.nodes.every((n) => n.y + n.h <= layout.height));
  assert.ok(layout.links.length > 0);
});

test("trace reports reach, exits and detours per step", () => {
  const trace = buildTrace(
    ["/", "/pricing", "/signup"],
    [
      { k: 1, next: "/pricing", sessions: 6 },
      { k: 1, next: "/docs", sessions: 3 },
      { k: 1, next: "", sessions: 1 },
      { k: 2, next: "/signup", sessions: 4 },
      { k: 2, next: "", sessions: 2 },
      { k: 3, next: "", sessions: 4 },
    ]
  );
  assert.deepEqual(trace.map((s) => s.sessions), [10, 6, 4]);
  assert.equal(trace[0]!.exits, 1);
  assert.deepEqual(trace[0]!.deviations, [{ page: "/docs", sessions: 3 }]);
});

test("segment table shows each segment's share that viewed each page", () => {
  const table = buildSegmentTable(
    [
      { segment: "desktop", page: "/", sessions: 8 },
      { segment: "mobile", page: "/", sessions: 1 },
    ],
    [
      { segment: "desktop", sessions: 10 },
      { segment: "mobile", sessions: 4 },
    ]
  );
  assert.equal(table.rows[0]!.cells[0]!.pct, 80);
  assert.equal(table.rows[1]!.cells[0]!.pct, 25);
});
