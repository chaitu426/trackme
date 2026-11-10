import type { Answer, Block } from "./types";

function blockText(b: Block): string {
  switch (b.type) {
    case "text":
      return b.text;
    case "callout":
      return `> ${b.text}`;
    case "stats":
      return b.items.map((i) => `- ${i.label}: **${i.value}**${i.delta ? ` (${i.delta})` : ""}`).join("\n");
    case "bars":
      return `**${b.title}**\n${b.rows.map((r) => `- ${r.label}: ${r.display}`).join("\n")}`;
    case "table":
      return [`**${b.title}**`, `| ${b.columns.join(" | ")} |`, `| ${b.columns.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
    case "spark":
      return `**${b.title}**: ${b.display}`;
  }
}

/**
 * A finding as a case file: the question, the answer, the cause-to-money trail, every query behind it, and what it assumed. Plain
 * markdown that pastes into a ticket, a pull request or a chat and still shows its work. Built only from the answer, so it never
 * says more than the answer did.
 */
export function caseFile(question: string, a: Answer, meta: { site: string; range: string; at: Date }): string {
  const out: string[] = [`# ${question}`, `_${meta.site} · ${meta.range} · asked ${meta.at.toISOString().slice(0, 16).replace("T", " ")} UTC · ${a.confidence} confidence_`, ""];
  out.push(...a.blocks.map(blockText).flatMap((t) => [t, ""]));
  if (a.trail) {
    out.push("## Cause to cost", ...a.trail.nodes.map((n, i) => `${i + 1}. **${n.title}**${n.at ? ` (${n.at})` : ""}: ${n.detail}${n.cite ? ` [${n.cite}]` : ""}`));
    out.push("", `**${a.trail.total.value}** ${a.trail.total.label}. ${a.trail.total.basis}`, "");
  }
  if (a.assumptions.length > 0) out.push("## Assumptions", ...a.assumptions.map((s) => `- ${s}`), "");
  if (a.evidence.length > 0) {
    out.push("## Evidence");
    for (const e of a.evidence) out.push(`### [${e.n}] ${e.title}`, `${e.table} · ${e.range} · ${e.rows.toLocaleString("en-US")} rows · ${e.ms} ms`, "```sql", e.query, "```", "");
  }
  return out.join("\n").trimEnd() + "\n";
}

/** A ready-to-file ticket: a title, the impact in money, the evidence to start from. Short on purpose. */
export function ticketText(question: string, a: Answer): string {
  const t = a.trail;
  const lines = [t ? `${t.nodes.find((n) => n.kind === "error" || n.kind === "gateway" || n.kind === "release")?.title ?? question}: ${t.total.value} ${t.total.label}` : question, ""];
  if (t) lines.push("What happened", ...t.nodes.map((n) => `- ${n.title}${n.at ? ` (${n.at})` : ""}: ${n.detail}`), "", `Impact: ${t.total.value} ${t.total.label}. ${t.total.basis}`, "");
  if (a.evidence.length > 0) lines.push("Start from", ...a.evidence.map((e) => `- ${e.title} (${e.table}, ${e.range})`));
  return lines.join("\n").trimEnd() + "\n";
}
