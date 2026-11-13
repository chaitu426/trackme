import { PLANS, type PlanLimits } from "@trackme/contracts";

/**
 * The Free and Pro comparison as text, built from the same table the server enforces so what the page promises and what
 * the app does cannot drift apart.
 */
export interface PlanRow {
  label: string;
  free: string;
  pro: string;
}

const count = (n: number | null, unit = ""): string => (n === null ? "Unlimited" : `${n.toLocaleString("en-US")}${unit}`);
const flag = (on: boolean): string => (on ? "Included" : "Not included");

export function planRows(plans: Record<"free" | "pro", PlanLimits> = PLANS): PlanRow[] {
  const f = plans.free;
  const p = plans.pro;
  const row = (label: string, a: string, b: string): PlanRow => ({ label, free: a, pro: b });
  return [
    row("Workspaces", count(f.workspaces), count(p.workspaces)),
    row("Websites", count(f.sites), count(p.sites)),
    row("Events per month", count(f.eventsPerMonth), count(p.eventsPerMonth)),
    row("Members (owner, admin, member)", count(f.members), count(p.members)),
    row("Viewers", count(f.viewers), count(p.viewers)),
    row("Teams and per-site access", flag(f.teams), flag(p.teams)),
    row("Data retention", `${f.retentionMonths} months`, `${p.retentionMonths} months`),
    row("Payments analytics", flag(f.paymentsAnalytics), flag(p.paymentsAnalytics)),
    row("Funnels / goals / segments", `${count(f.funnels)} / ${count(f.goals)} / ${count(f.segments)}`, `${count(p.funnels)} / ${count(p.goals)} / ${count(p.segments)}`),
    row("API keys", count(f.apiKeys), count(p.apiKeys)),
    row("Alert rules", count(f.alertRules), count(p.alertRules)),
    row("Alert channels", f.alertChannelTypes.length === 1 ? "Email only" : "All channels", p.alertChannelTypes.length === 1 ? "Email only" : "Email, Slack, Discord, webhook"),
    row("Ask questions per month", count(f.askPerMonth), count(p.askPerMonth)),
    row("Public dashboards", flag(f.publicDashboard), flag(p.publicDashboard)),
    row("Audit log", flag(f.auditLog), flag(p.auditLog)),
    row("Exports", f.fullExports ? "Full" : "CSV only", p.fullExports ? "Full" : "CSV only"),
  ];
}

/** The few things worth saying in an upgrade prompt: what Pro adds over the plan you are on. */
export function proHighlights(plans: Record<"free" | "pro", PlanLimits> = PLANS): string[] {
  const p = plans.pro;
  return [
    `Up to ${count(p.sites)} websites and ${count(p.workspaces)} workspaces`,
    `${count(p.eventsPerMonth)} events a month`,
    "Teams and per-site access",
    `${p.retentionMonths} months of history`,
    "Payments analytics, public dashboards, audit log",
  ];
}

/** What a plan card lists: the headline limits first, written from the same table the server enforces. */
export interface PlanCardCopy {
  id: "free" | "pro";
  name: string;
  tagline: string;
  features: string[];
}

export function planCards(plans: Record<"free" | "pro", PlanLimits> = PLANS): PlanCardCopy[] {
  const f = plans.free;
  const p = plans.pro;
  const sites = (n: number | null) => (n === null ? "Unlimited websites" : `${n} ${n === 1 ? "website" : "websites"}`);
  const spaces = (n: number | null) => (n === null ? "Unlimited workspaces" : `${n} ${n === 1 ? "workspace" : "workspaces"}`);
  return [
    {
      id: "free",
      name: "Free",
      tagline: "For one site and a small team getting started.",
      features: [
        `${sites(f.sites)}, ${spaces(f.workspaces)}`,
        `${count(f.eventsPerMonth)} events a month`,
        `${count(f.members)} members and ${count(f.viewers)} viewers`,
        `${f.retentionMonths} months of history`,
        `${count(f.askPerMonth)} Ask questions a month`,
        "Email alerts",
      ],
    },
    {
      id: "pro",
      name: "Pro",
      tagline: "For teams that need every view, with the right access for each person.",
      features: [
        `${sites(p.sites)}, ${spaces(p.workspaces)}`,
        `${count(p.eventsPerMonth)} events a month`,
        "Teams and per-site access",
        `${p.retentionMonths} months of history`,
        "Payments analytics and the money trail",
        `${count(p.askPerMonth)} Ask questions a month`,
        "Slack, Discord and webhook alerts",
        "Public dashboards, audit log, full exports",
      ],
    },
  ];
}
