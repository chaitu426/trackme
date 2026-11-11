import { test } from "node:test";
import assert from "node:assert/strict";
import { answerText, historyFrom } from "./history";
import type { Answer, Turn } from "./types";

const answer = (text: string): Answer => ({ steps: [], blocks: [{ type: "text", text }], evidence: [], assumptions: [], confidence: "high", followups: [], ideas: [] });

test("answerText flattens blocks to the words and figures the person saw", () => {
  const a: Answer = {
    ...answer("Visitors are up 12% [1]."),
    blocks: [
      { type: "text", text: "Visitors are up 12% [1]." },
      { type: "stats", items: [{ label: "Visitors", value: "12,400", delta: "+12%" }] },
      { type: "table", title: "Top pages", columns: ["page", "views"], rows: [["/", "900"], ["/pricing", "400"]] },
    ],
  };
  assert.equal(answerText(a), "Visitors are up 12% [1]. Visitors: 12,400 (+12%) Top pages: / | 900; /pricing | 400");
});

test("historyFrom keeps only finished turns, the latest four, oldest first", () => {
  const turns: Turn[] = [1, 2, 3, 4, 5].map((n) => ({ id: `t${n}`, question: `q${n}`, status: "done", shownSteps: 0, answer: answer(`a${n}`) }));
  turns.push({ id: "t6", question: "pending", status: "thinking", shownSteps: 0 });
  const h = historyFrom(turns);
  assert.deepEqual(h.map((x) => x.question), ["q2", "q3", "q4", "q5"]);
});
