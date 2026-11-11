import type { Answer, Turn } from "./types";

/** What the person was shown, as plain text: the model needs the figures and wording, not the structure. */
export function answerText(a: Answer): string {
  const parts: string[] = [];
  for (const b of a.blocks) {
    if (b.type === "text" || b.type === "callout") parts.push(b.text);
    else if (b.type === "stats") parts.push(b.items.map((i) => `${i.label}: ${i.value}${i.delta ? ` (${i.delta})` : ""}`).join("; "));
    else if (b.type === "bars") parts.push(`${b.title}: ${b.rows.map((r) => `${r.label} ${r.display}`).join(", ")}`);
    else if (b.type === "table") parts.push(`${b.title}: ${b.rows.slice(0, 5).map((r) => r.join(" | ")).join("; ")}`);
    else if (b.type === "spark") parts.push(`${b.title}: ${b.display}`);
  }
  if (a.limit) parts.push(a.limit);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 1_500);
}

/** The last few finished exchanges, oldest first, to send with the next question so a follow-up has something to refer to. */
export function historyFrom(turns: Turn[], max = 4): Array<{ question: string; answer: string }> {
  return turns
    .filter((t): t is Turn & { answer: Answer } => t.status === "done" && t.answer !== undefined)
    .map((t) => ({ question: t.question, answer: answerText(t.answer) }))
    .filter((t) => t.answer !== "")
    .slice(-max);
}
