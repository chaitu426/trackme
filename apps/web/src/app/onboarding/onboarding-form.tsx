"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Globe,
  Code2,
  Radio,
  Users,
  Check,
  Copy,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Zap,
  Loader2,
  UserPlus,
  Trash2,
  Send,
  Link2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FirstEventVerifier } from "@/components/first-event-verifier";
import { useInviteManager } from "@/hooks/use-invite-manager";

type CreatedWorkspace = {
  workspace: { id: string; name: string; slug: string };
  site: { id: string; domain: string; publicKey: string };
  trackerScriptUrl: string;
  ingestionUrl: string;
};

interface InviteStatus {
  email: string;
  role: "member" | "admin" | "viewer";
  state: "pending" | "sending" | "sent" | "error";
  error?: string;
  inviteId?: string;
  token?: string;
  expiresAt?: string;
}

const STEPS = [
  { id: 1, label: "Organization", icon: Building2, desc: "Profile & Region" },
  { id: 2, label: "Website", icon: Globe, desc: "Connect domain" },
  { id: 3, label: "Tracking Code", icon: Code2, desc: "Install snippet" },
  { id: 4, label: "Verify Telemetry", icon: Radio, desc: "Live event check" },
  { id: 5, label: "Invite Team", icon: Users, desc: "Collaborate (optional)" },
] as const;

export function OnboardingForm() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Step 1: Org Data
  const [orgName, setOrgName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [dataResidency, setDataResidency] = useState("eu-central");

  // Step 2: Site Data
  const [domain, setDomain] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [currency, setCurrency] = useState("USD");

  // Creation State
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedWorkspace | null>(null);

  // Step 3: Snippet Tabs
  const [snippetTab, setSnippetTab] = useState<"html" | "nextjs" | "react" | "vue" | "gtm">("html");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Step 4: Verification
  const [testEventSent, setTestEventSent] = useState(false);
  const [sendingTestEvent, setSendingTestEvent] = useState(false);

  // Step 5: Team Invites (using shared hook)
  const inviteManager = useInviteManager(created?.workspace.id ?? null);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin" | "viewer">("member");
  const [inviteStatuses, setInviteStatuses] = useState<InviteStatus[]>([]);

  // Slug calculation
  const computedSlug = orgName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "my-organization";

  // Step 1 -> Step 2 validation
  function handleNextFromOrg() {
    if (!orgName.trim()) {
      setError("Please provide an organization or company name.");
      return;
    }
    setError(null);
    setCurrentStep(2);
  }

  // Step 2 -> Step 3: Create Workspace & Site
  async function handleCreateWorkspaceAndSite() {
    if (!domain.trim()) {
      setError("Please provide a valid website domain.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgName.trim(),
          domain: domain.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to create organization.");
      }

      setCreated(data);
      setCurrentStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error creating workspace.");
    } finally {
      setPending(false);
    }
  }

  // Snippet Generators
  function getSnippetContent(tab: typeof snippetTab) {
    if (!created) return "";
    const siteKey = created.site.publicKey;
    const ingestUrl = created.ingestionUrl;
    const trackerUrl = created.trackerScriptUrl;

    switch (tab) {
      case "nextjs":
        return `// app/layout.tsx (Next.js 13/14/15 App Router)\nimport Script from "next/script";\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <head>\n        <Script\n          defer\n          src="${trackerUrl}"\n          data-site="${siteKey}"\n          data-endpoint="${ingestUrl}"\n        />\n      </head>\n      <body>{children}</body>\n    </html>\n  );\n}`;
      case "react":
        return `// In your public/index.html or Vite main.tsx entry:\n<script\n  defer\n  src="${trackerUrl}"\n  data-site="${siteKey}"\n  data-endpoint="${ingestUrl}"\n></script>`;
      case "vue":
        return `<!-- Nuxt 3: nuxt.config.ts -->\nexport default defineNuxtConfig({\n  app: {\n    head: {\n      script: [\n        {\n          src: "${trackerUrl}",\n          defer: true,\n          "data-site": "${siteKey}",\n          "data-endpoint": "${ingestUrl}"\n        }\n      ]\n    }\n  }\n});`;
      case "gtm":
        return `<!-- Custom HTML Tag in Google Tag Manager -->\n<script\n  defer\n  src="${trackerUrl}"\n  data-site="${siteKey}"\n  data-endpoint="${ingestUrl}"\n></script>\n<!-- Trigger: All Pages (Page View) -->`;
      case "html":
      default:
        return `<!-- TrackMe Cookieless Telemetry (<2KB, zero cookies) -->\n<script\n  defer\n  src="${trackerUrl}"\n  data-site="${siteKey}"\n  data-endpoint="${ingestUrl}"\n></script>`;
    }
  }

  function handleCopySnippet() {
    navigator.clipboard.writeText(getSnippetContent(snippetTab));
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  }

  async function handleSendTestEvent() {
    if (!created) return;
    setSendingTestEvent(true);
    try {
      await fetch(created.ingestionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              type: "pageview",
              timestamp: Date.now(),
              url: `https://${created.site.domain}/welcome`,
              path: "/welcome",
              title: "Onboarding Verification",
              site_key: created.site.publicKey,
            },
          ],
        }),
      });
      setTestEventSent(true);
    } catch {
      // Ignore
    } finally {
      setSendingTestEvent(false);
    }
  }

  // ── Step 5: Invite helpers ────────────────────────────────────────────────

  function parseEmailList(raw: string): string[] {
    return raw
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@") && e.includes("."));
  }

  async function handleAddAndSendInvites(e: React.FormEvent) {
    e.preventDefault();
    if (!created || !inviteInput.trim()) return;

    const emails = parseEmailList(inviteInput);
    if (emails.length === 0) return;
    setInviteInput("");

    // Deduplicate
    const newEntries: InviteStatus[] = emails
      .filter((em) => !inviteStatuses.some((s) => s.email === em))
      .map((email) => ({ email, role: inviteRole, state: "sending" as const }));

    setInviteStatuses((prev) => [...prev, ...newEntries]);

    // Send all in parallel
    await Promise.all(
      newEntries.map(async (entry) => {
        const result = await inviteManager.sendInvite(entry.email, entry.role);
        setInviteStatuses((prev) =>
          prev.map((s) =>
            s.email === entry.email
              ? {
                  ...s,
                  state: (result.success ? "sent" : "error") as InviteStatus["state"],
                  ...(result.error !== undefined ? { error: result.error } : {}),
                  ...(result.invite?.id !== undefined ? { inviteId: result.invite.id } : {}),
                  ...(result.invite?.token !== undefined ? { token: result.invite.token } : {}),
                  ...(result.invite?.expiresAt !== undefined ? { expiresAt: result.invite.expiresAt } : {}),
                }
              : s
          )
        );
      })
    );
  }

  async function handleResend(status: InviteStatus) {
    if (!status.inviteId) return;
    setInviteStatuses((prev) =>
      prev.map((s) => (s.email === status.email ? { ...s, state: "sending" } : s))
    );
    const result = await inviteManager.resendInvite(status.inviteId, status.email, status.role);
    setInviteStatuses((prev) =>
      prev.map((s) =>
        s.email === status.email
          ? {
              ...s,
              state: (result.success ? "sent" : "error") as InviteStatus["state"],
              ...(result.error !== undefined ? { error: result.error } : {}),
              ...(result.invite?.id !== undefined ? { inviteId: result.invite.id } : {}),
              ...(result.invite?.token !== undefined ? { token: result.invite.token } : {}),
              ...(result.invite?.expiresAt !== undefined ? { expiresAt: result.invite.expiresAt } : {}),
            }
          : s
      )
    );
  }

  function handleRemoveInviteStatus(email: string) {
    setInviteStatuses((prev) => prev.filter((s) => s.email !== email));
  }

  // Complete Onboarding
  async function handleComplete() {
    if (!created) return;
    router.push(`/${created.workspace.slug}/overview`);
    router.refresh();
  }


  return (
    <div className="w-full max-w-2xl mx-auto rounded-3xl border border-white/[0.08] bg-zinc-950/90 p-7 sm:p-9 shadow-2xl backdrop-blur-xl">
      {/* Stepper Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {STEPS.map((s, idx) => {
            const isDone = currentStep > s.id;
            const isCurrent = currentStep === s.id;
            const Icon = s.icon;

            return (
              <div key={s.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold transition-all ${
                      isDone
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-xs"
                        : isCurrent
                        ? "bg-zinc-100 text-zinc-950 font-bold shadow-md"
                        : "bg-white/[0.04] text-zinc-500 border border-white/[0.06]"
                    }`}
                  >
                    {isDone ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span
                    className={`text-[10px] mt-1.5 hidden sm:block tracking-tight font-medium ${
                      isCurrent ? "text-zinc-200" : isDone ? "text-zinc-400" : "text-zinc-600"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`h-[1px] flex-1 mx-2 transition-all ${
                      currentStep > s.id ? "bg-emerald-500/30" : "bg-white/[0.06]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* STEP 1: ORGANIZATION */}
      {currentStep === 1 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-100">
              Create your organization
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Organizations isolate telemetry, permissions, domains, and team members.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Organization / Company Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Acme Corporation or Growth Studio"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none transition"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Workspace URL:{" "}
                <span className="font-mono text-zinc-400">trackme.app/{computedSlug}</span>
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Reporting Timezone
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="UTC">UTC (Coordinated Universal Time)</option>
                  <option value="America/New_York">America/New_York (EST/EDT)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                  <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Data Residency & Privacy
                </label>
                <select
                  value={dataResidency}
                  onChange={(e) => setDataResidency(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="eu-central">EU Central (100% GDPR Compliant)</option>
                  <option value="us-east">US East (Standard Privacy)</option>
                  <option value="ap-southeast">APAC Regional (Privacy-Safe)</option>
                </select>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="pt-2 flex justify-end">
            <Button
              onClick={handleNextFromOrg}
              className="h-10 text-xs font-semibold px-6 gap-2"
            >
              Continue to Website Setup
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: WEBSITE SETUP */}
      {currentStep === 2 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-100">
              Add your primary website
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Enter your main web domain. You can add unlimited websites later from organization settings.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Domain / Hostname <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="acmesaas.com or mycompany.io"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none transition"
              />
              <p className="text-[11px] text-zinc-500 mt-1">Enter domain without https:// or paths.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Display Label (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Marketing Site"
                  value={siteLabel}
                  onChange={(e) => setSiteLabel(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Currency for Goals & Revenue
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="INR">INR (₹)</option>
                  <option value="CAD">CAD ($)</option>
                  <option value="AUD">AUD ($)</option>
                </select>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="pt-2 flex justify-between items-center">
            <Button
              variant="outline"
              onClick={() => setCurrentStep(1)}
              className="h-10 text-xs border-white/10 text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
            <Button
              onClick={handleCreateWorkspaceAndSite}
              disabled={pending || !domain.trim()}
              className="h-10 text-xs font-semibold px-6 gap-2"
            >
              {pending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Provisioning…
                </>
              ) : (
                <>
                  Create & Get Tracking Code
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: SNIPPET INSTALLATION */}
      {currentStep === 3 && created && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-100">
              Install the tracking snippet
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Add this lightweight tag (&lt;2KB) to start capturing cookieless pageviews and sessions.
            </p>
          </div>

          {/* Framework tabs */}
          <div className="flex flex-wrap gap-1.5 border-b border-white/[0.08] pb-2">
            {[
              { id: "html", label: "HTML / Vanilla" },
              { id: "nextjs", label: "Next.js" },
              { id: "react", label: "React / Vite" },
              { id: "vue", label: "Vue / Nuxt" },
              { id: "gtm", label: "Google Tag Manager" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSnippetTab(tab.id as typeof snippetTab)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                  snippetTab === tab.id
                    ? "bg-white/[0.1] text-zinc-100 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Code display */}
          <div className="relative rounded-2xl border border-white/10 bg-zinc-900/90 p-4">
            <pre className="font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all pr-14 leading-relaxed">
              {getSnippetContent(snippetTab)}
            </pre>
            <button
              onClick={handleCopySnippet}
              className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/20 transition"
            >
              {copiedSnippet ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Key characteristics */}
          <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-zinc-400 pt-1">
            <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <span className="block font-semibold text-zinc-200">1.8 KB</span>
              <span>Zero bloat</span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <span className="block font-semibold text-zinc-200">0 Cookies</span>
              <span>No GDPR banner</span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <span className="block font-semibold text-zinc-200">Async</span>
              <span>Zero render-blocking</span>
            </div>
          </div>

          <div className="pt-2 flex justify-between items-center">
            <Button
              variant="outline"
              onClick={() => setCurrentStep(2)}
              className="h-10 text-xs border-white/10 text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
            <Button
              onClick={() => setCurrentStep(4)}
              className="h-10 text-xs font-semibold px-6 gap-2"
            >
              Verify Snippet Live
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: VERIFY TELEMETRY */}
      {currentStep === 4 && created && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-100">
              Live ingestion verification
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Checking telemetry stream for <span className="font-mono text-zinc-200">{created.site.domain}</span>.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6 space-y-5">
            <FirstEventVerifier siteId={created.site.id} />

            <div className="pt-3 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <span className="text-zinc-400">Want to test without deploying yet?</span>
              <button
                type="button"
                onClick={handleSendTestEvent}
                disabled={sendingTestEvent}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 font-medium transition"
              >
                {sendingTestEvent ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                {testEventSent ? "Test Event Dispatched ✓" : "Send Test Ping"}
              </button>
            </div>
          </div>

          <div className="pt-2 flex justify-between items-center">
            <Button
              variant="outline"
              onClick={() => setCurrentStep(3)}
              className="h-10 text-xs border-white/10 text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Snippet
            </Button>
            <Button
              onClick={() => setCurrentStep(5)}
              className="h-10 text-xs font-semibold px-6 gap-2"
            >
              Next: Invite Team (Optional)
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 5: TEAM INVITES */}
      {currentStep === 5 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-100">
              Invite your collaborators
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Paste one or multiple emails (comma or space separated). Invites are sent instantly — teammates get a magic link valid for 7 days.
            </p>
          </div>

          {/* Role selector */}
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {[
              { role: "admin", label: "Admin", color: "text-amber-400 border-amber-500/20 bg-amber-500/[0.06]", desc: "Full control" },
              { role: "member", label: "Member", color: "text-indigo-400 border-indigo-500/20 bg-indigo-500/[0.06]", desc: "Read & edit" },
              { role: "viewer", label: "Viewer", color: "text-sky-400 border-sky-500/20 bg-sky-500/[0.06]", desc: "Read only" },
            ].map((r) => (
              <button
                key={r.role}
                type="button"
                onClick={() => setInviteRole(r.role as typeof inviteRole)}
                className={`rounded-xl border px-3 py-2 text-left transition ${r.color} ${inviteRole === r.role ? "ring-1 ring-white/20" : "opacity-50 hover:opacity-80"}`}
              >
                <div className="font-semibold">{r.label}</div>
                <div className="text-zinc-500 mt-0.5">{r.desc}</div>
              </button>
            ))}
          </div>

          {/* Email input — supports bulk paste */}
          <form onSubmit={handleAddAndSendInvites} className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="alice@acme.com, bob@acme.com…"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none transition"
              />
              <Button type="submit" disabled={!inviteInput.trim() || !created} className="h-10 text-xs font-semibold px-5 gap-2 shrink-0">
                <Send className="w-3.5 h-3.5" />
                Send
              </Button>
            </div>
            <p className="text-[11px] text-zinc-600">
              Tip: paste multiple emails at once. Role applied:{" "}
              <span className="text-zinc-400 font-medium capitalize">{inviteRole}</span>
            </p>
          </form>

          {/* Live invite status list */}
          {inviteStatuses.length > 0 ? (
            <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/50 divide-y divide-white/[0.05] overflow-hidden">
              {inviteStatuses.map((s) => {
                const expiry = s.expiresAt ? inviteManager.getExpiryMeta(s.expiresAt) : null;
                return (
                  <div key={s.email} className="flex items-center justify-between px-4 py-3 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {s.state === "sending" && <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin shrink-0" />}
                      {s.state === "sent" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                      {s.state === "error" && <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                      <div className="min-w-0">
                        <span className="font-medium text-zinc-200 truncate block">{s.email}</span>
                        {s.state === "error" && <span className="text-rose-400">{s.error}</span>}
                        {s.state === "sent" && expiry && (
                          <span className={`flex items-center gap-1 mt-0.5 ${expiry.urgent ? "text-amber-400" : "text-zinc-500"}`}>
                            <Clock className="w-2.5 h-2.5" />{expiry.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                        s.role === "admin" ? "bg-amber-500/10 text-amber-400" :
                        s.role === "viewer" ? "bg-sky-500/10 text-sky-400" :
                        "bg-indigo-500/10 text-indigo-400"
                      }`}>{s.role}</span>
                      {s.state === "error" && (
                        <button type="button" onClick={() => handleResend(s)} className="text-zinc-500 hover:text-indigo-400 p-1 transition" title="Retry">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {s.state === "sent" && (s.token || s.inviteId) && (
                        <button
                          type="button"
                          onClick={() => inviteManager.copyInviteLink(s.token || s.inviteId!, s.inviteId || s.email)}
                          className="text-zinc-500 hover:text-zinc-300 p-1 transition"
                          title="Copy invite link"
                        >
                          {inviteManager.copiedToken === (s.inviteId || s.email)
                            ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                            : <Link2 className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <button type="button" onClick={() => handleRemoveInviteStatus(s.email)} className="text-zinc-600 hover:text-rose-400 p-1 transition" title="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-5 rounded-2xl border border-dashed border-white/10 text-center text-xs text-zinc-500">
              <UserPlus className="w-5 h-5 mx-auto mb-2 opacity-40" />
              No invites sent yet — add emails above or skip and invite from settings later.
            </div>
          )}

          <div className="pt-2 flex justify-between items-center">
            <Button variant="outline" onClick={() => setCurrentStep(4)} className="h-10 text-xs border-white/10 text-zinc-400 hover:text-zinc-200">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
            <Button onClick={handleComplete} className="h-10 text-xs font-semibold px-6 gap-2 bg-gradient-to-r from-emerald-500 to-indigo-600 hover:opacity-90 text-white">
              <Sparkles className="w-4 h-4" /> Launch Analytics Dashboard →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

