"use client";

import { useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Copy,
  ArrowRight,
  ArrowLeft,
  Zap,
  Loader2,
  UserPlus,
  Trash2,
  Send,
  RefreshCw,
  XCircle,
  Clock,
} from "lucide-react";
import { GlyphField } from "@trackme/landing";
import { FirstEventVerifier } from "@/components/first-event-verifier";
import { useInviteManager } from "@/hooks/use-invite-manager";
import { DrawCheck, Notice, PillTabs, StepPanel } from "@/components/motion/primitives";
import { inputClass } from "@/components/ui/field";

type CreatedWorkspace = {
  workspace: { id: string; name: string; slug: string };
  site: { id: string; domain: string; publicKey: string };
  trackerScriptUrl: string;
  /** SHA-384 Subresource Integrity hash of the pinned tracker file, or null when the build has none. */
  trackerScriptIntegrity: string | null;
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
  { id: 1, label: "Workspace", desc: "Name it" },
  { id: 2, label: "Website", desc: "Add your domain" },
  { id: 3, label: "Tag", desc: "Install the script" },
  { id: 4, label: "First event", desc: "Check it arrives" },
  { id: 5, label: "Team", desc: "Invite people, optional" },
] as const;

export function OnboardingForm({ existing }: { existing: { id: string; name: string; slug: string }[] }) {
  const router = useRouter();
  const [currentStep, setStep] = useState<number>(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [errorNonce, setErrorNonce] = useState(0);
  const setCurrentStep = (next: number) => {
    setDirection(next >= currentStep ? 1 : -1);
    setStep(next);
  };

  // Step 1: Org Data
  const [orgName, setOrgName] = useState("");

  // Step 2: Site Data
  const [domain, setDomain] = useState("");

  // Creation State
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedWorkspace | null>(null);

  // Step 3: Snippet Tabs
  const [snippetTab, setSnippetTab] = useState<"html" | "nextjs" | "react" | "vue" | "gtm">("html");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Step 4: Verification
  const [testEventSent, setTestEventSent] = useState(false);
  const [launching, setLaunching] = useState(false);
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
      setErrorNonce((n) => n + 1);
      return;
    }
    setError(null);
    setCurrentStep(2);
  }

  // Step 2 -> Step 3: Create Workspace & Site
  async function handleCreateWorkspaceAndSite() {
    if (!domain.trim()) {
      setError("Please provide a valid website domain.");
      setErrorNonce((n) => n + 1);
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
      setErrorNonce((n) => n + 1);
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
    // Pin the exact bytes: the browser refuses to run the script if it is not the file this hash describes.
    const sri = created.trackerScriptIntegrity;
    const htmlSri = sri ? `\n  integrity="${sri}"\n  crossorigin="anonymous"` : "";
    const reactSri = sri ? `\n          integrity="${sri}"\n          crossOrigin="anonymous"` : "";
    const nuxtSri = sri ? `\n          integrity: "${sri}",\n          crossorigin: "anonymous",` : "";

    switch (tab) {
      case "nextjs":
        return `// app/layout.tsx (Next.js 13/14/15 App Router)\nimport Script from "next/script";\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <head>\n        <Script\n          defer\n          src="${trackerUrl}"${reactSri}\n          data-site="${siteKey}"\n          data-endpoint="${ingestUrl}"\n        />\n      </head>\n      <body>{children}</body>\n    </html>\n  );\n}`;
      case "react":
        return `// In your public/index.html or Vite main.tsx entry:\n<script\n  defer\n  src="${trackerUrl}"${htmlSri}\n  data-site="${siteKey}"\n  data-endpoint="${ingestUrl}"\n></script>`;
      case "vue":
        return `<!-- Nuxt 3: nuxt.config.ts -->\nexport default defineNuxtConfig({\n  app: {\n    head: {\n      script: [\n        {\n          src: "${trackerUrl}",${nuxtSri}\n          defer: true,\n          "data-site": "${siteKey}",\n          "data-endpoint": "${ingestUrl}"\n        }\n      ]\n    }\n  }\n});`;
      case "gtm":
        return `<!-- Custom HTML Tag in Google Tag Manager -->\n<script\n  defer\n  src="${trackerUrl}"${htmlSri}\n  data-site="${siteKey}"\n  data-endpoint="${ingestUrl}"\n></script>\n<!-- Trigger: All Pages (Page View) -->`;
      case "html":
      default:
        return `<!-- TrackMe Cookieless Telemetry (under 10 KB gzipped, no tracking cookies) -->\n<script\n  defer\n  src="${trackerUrl}"${htmlSri}\n  data-site="${siteKey}"\n  data-endpoint="${ingestUrl}"\n></script>`;
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
    if (!created || launching) return;
    // The dashboard renders server-side and can take a while on first load; show progress
    // and ignore repeat clicks instead of leaving the button looking dead.
    setLaunching(true);
    router.push(`/${created.workspace.slug}/overview`);
    router.refresh();
  }


  const input = inputClass;
  const primary =
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#ededed] px-5 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] press hover:bg-white disabled:pointer-events-none disabled:opacity-60";
  const ghost =
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/[0.1] px-4 text-sm text-zinc-300 press hover:border-white/[0.2] hover:text-zinc-50";
  const current = STEPS[currentStep - 1]!;

  const StepHead = ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div className="mb-8">
      <p className="font-mono text-xs text-zinc-500">
        Step {currentStep} of {STEPS.length}
      </p>
      <h2 className="mt-3 text-[28px] font-medium leading-9 tracking-[-0.02em] text-zinc-50">{title}</h2>
      {children && <p className="mt-2 max-w-md text-sm leading-5 text-zinc-400">{children}</p>}
    </div>
  );

  const ErrorNote = () =>
    error ? (
      <Notice nonce={errorNonce} className="rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-sm text-[#e5484d]">
        {error}
      </Notice>
    ) : null;

  return (
    <div className="grid flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* The steps, always in view */}
      <aside className="relative hidden overflow-hidden border-r border-white/[0.08] bg-sidebar lg:block">
        <div className="relative z-10 p-8">
          <p className="font-mono text-xs text-zinc-500">Set up your workspace</p>
          <LayoutGroup id="onboarding-rail"><ol className="mt-6 space-y-1">
            {STEPS.map((s) => {
              const done = currentStep > s.id;
              const active = currentStep === s.id;
              return (
                <li key={s.id} aria-current={active ? "step" : undefined} className="relative flex items-center gap-3 rounded-lg px-3 py-3">
                  {active && (
                    <motion.span layoutId="rail-active" className="absolute inset-0 rounded-lg bg-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }} />
                  )}
                  <span
                    className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-md border font-mono text-xs transition-colors duration-150 ${
                      done ? "border-white/[0.2] bg-white/[0.06] text-zinc-100" : active ? "border-white/[0.3] text-zinc-50" : "border-white/[0.1] text-zinc-500"
                    }`}
                  >
                    {done ? <Check className="h-4 w-4" /> : String(s.id).padStart(2, "0")}
                  </span>
                  <span className="relative min-w-0">
                    <span className={`block text-sm ${active ? "font-medium text-zinc-50" : done ? "text-zinc-300" : "text-zinc-500"}`}>{s.label}</span>
                    <span className="block text-xs text-zinc-500">{s.desc}</span>
                  </span>
                </li>
              );
            })}
          </ol></LayoutGroup>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-64" aria-hidden="true">
          <GlyphField variant="stream" cell={9} strength={0.7} />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#0f0f10] to-transparent" />
        </div>
      </aside>

      <main className="min-w-0 px-4 py-10 sm:px-8 lg:py-16">
        <div className="mx-auto w-full max-w-[520px]">
          {/* Small screens: the rail collapses to a progress line */}
          <div className="mb-8 lg:hidden" aria-hidden="true">
            <div className="flex gap-1">
              {STEPS.map((s) => (
                <span key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.12]">
                  <motion.span className="block h-full origin-left bg-zinc-200" initial={false} animate={{ scaleX: currentStep >= s.id ? 1 : 0 }} transition={{ type: "spring", bounce: 0, visualDuration: 0.35 }} />
                </span>
              ))}
            </div>
            <p className="mt-3 font-mono text-xs text-zinc-500">{current.label}</p>
          </div>

          {existing.length > 0 && currentStep === 1 && (
            <div className="mb-8 rounded-lg border border-white/[0.08] bg-card px-4 py-3 text-sm text-zinc-400">
              You already have {existing.length === 1 ? "a workspace" : "workspaces"}:{" "}
              {existing.map((workspace, index) => (
                <span key={workspace.id}>
                  {index > 0 ? ", " : ""}
                  <Link className="text-zinc-100 underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white" href={`/${workspace.slug}/overview`}>
                    {workspace.name}
                  </Link>
                </span>
              ))}
            </div>
          )}

          <StepPanel stepKey={currentStep} direction={direction}>
          {/* STEP 1: ORGANIZATION */}
          {currentStep === 1 && (
            <div>
              <StepHead title="Name your workspace">A workspace holds your sites, your data and your team.</StepHead>
              <div className="space-y-6">
                <div>
                  <label htmlFor="org-name" className="mb-2 block text-sm text-zinc-300">
                    Organization name
                  </label>
                  <input id="org-name" type="text" required autoFocus placeholder="Acme Corporation" value={orgName} onChange={(e) => setOrgName(e.target.value)} className={input} />
                  <p className="mt-2 text-xs text-zinc-500">
                    Your address: <span className="font-mono text-zinc-400">/{computedSlug}</span>
                  </p>
                </div>
                <ErrorNote />
                <div className="flex justify-end">
                  <button type="button" onClick={handleNextFromOrg} className={primary}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: WEBSITE SETUP */}
          {currentStep === 2 && (
            <div>
              <StepHead title="Add your website">Enter your main domain. You can add more sites later in settings.</StepHead>
              <div className="space-y-6">
                <div>
                  <label htmlFor="site-domain" className="mb-2 block text-sm text-zinc-300">
                    Domain
                  </label>
                  <input id="site-domain" type="text" required autoFocus placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} className={`${input} font-mono`} />
                  <p className="mt-2 text-xs text-zinc-500">Without https:// or a path. Subdomains and the www version are included.</p>
                </div>
                <ErrorNote />
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setCurrentStep(1)} className={ghost}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button type="button" onClick={handleCreateWorkspaceAndSite} disabled={pending || !domain.trim()} className={primary}>
                    {pending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                      </>
                    ) : (
                      <>
                        Create workspace <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: SNIPPET INSTALLATION */}
          {currentStep === 3 && created && (
            <div>
              <StepHead title="Install the tag">One script tag in your page head. It loads deferred and tracks single-page navigation by itself.</StepHead>
              <div className="space-y-5">
                <PillTabs
                  kind="tabs"
                  label="Where to add the tag"
                  value={snippetTab}
                  onChange={setSnippetTab}
                  items={[
                    { id: "html", label: "HTML" },
                    { id: "nextjs", label: "Next.js" },
                    { id: "react", label: "React / Vite" },
                    { id: "vue", label: "Vue / Nuxt" },
                    { id: "gtm", label: "Tag Manager" },
                  ]}
                />

                <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-sidebar">
                  <div className="flex h-11 items-center justify-between border-b border-white/[0.08] pl-4 pr-2">
                    <span className="font-mono text-xs text-zinc-500">{created.site.domain}</span>
                    <button type="button" onClick={handleCopySnippet} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-50">
                      {copiedSnippet ? <Check className="h-4 w-4 text-[#4cc38a]" /> : <Copy className="h-4 w-4" />}
                      <span aria-live="polite">{copiedSnippet ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all p-4 font-mono text-[13px] leading-[22px] text-zinc-300">{getSnippetContent(snippetTab)}</pre>
                </div>

                <dl className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-zinc-500">
                  <div className="flex gap-2"><dt>size</dt><dd className="text-zinc-300">&lt; 10 KB gzipped</dd></div>
                  <div className="flex gap-2"><dt>cookies</dt><dd className="text-zinc-300">none</dd></div>
                  <div className="flex gap-2"><dt>loading</dt><dd className="text-zinc-300">deferred</dd></div>
                </dl>

                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={() => setCurrentStep(2)} className={ghost}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button type="button" onClick={() => setCurrentStep(4)} className={primary}>
                    I added it <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: VERIFY TELEMETRY */}
          {currentStep === 4 && created && (
            <div>
              <StepHead title="Watch the first event arrive">
                Waiting for <span className="font-mono text-zinc-200">{created.site.domain}</span> to send its first pageview.
              </StepHead>
              <div className="space-y-5">
                <div className="rounded-xl border border-white/[0.1] bg-card p-5">
                  <FirstEventVerifier siteId={created.site.id} />
                  <div className="mt-5 flex flex-col items-start justify-between gap-3 border-t border-white/[0.08] pt-4 text-sm sm:flex-row sm:items-center">
                    <span className="text-zinc-400">Not deployed yet?</span>
                    <button type="button" onClick={handleSendTestEvent} disabled={sendingTestEvent} className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.12] bg-raised px-3 text-xs text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-150 hover:border-white/[0.24] disabled:opacity-60">
                      {sendingTestEvent ? <Loader2 className="h-4 w-4 animate-spin" /> : testEventSent ? <Check className="h-4 w-4 text-[#4cc38a]" /> : <Zap className="h-4 w-4" />}
                      {testEventSent ? "Test event sent" : "Send a test event"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={() => setCurrentStep(3)} className={ghost}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button type="button" onClick={() => setCurrentStep(5)} className={primary}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: TEAM INVITES */}
          {currentStep === 5 && (
            <div>
              <StepHead title="Invite your team">Optional. Paste emails separated by commas or spaces. Each person gets a link that works for 7 days.</StepHead>
              <div className="space-y-5">
                <PillTabs
                  kind="radio"
                  label="Role"
                  value={inviteRole}
                  onChange={setInviteRole}
                  className="[&>button]:h-auto [&>button]:flex-1 [&>button]:justify-start [&>button]:py-2.5 [&>button]:text-left"
                  items={[
                    { id: "admin", label: <span><span className="block text-sm">Admin</span><span className="mt-0.5 block text-xs font-normal text-zinc-500">Full control</span></span> },
                    { id: "member", label: <span><span className="block text-sm">Member</span><span className="mt-0.5 block text-xs font-normal text-zinc-500">Read and edit</span></span> },
                    { id: "viewer", label: <span><span className="block text-sm">Viewer</span><span className="mt-0.5 block text-xs font-normal text-zinc-500">Read only</span></span> },
                  ]}
                />

                <form onSubmit={handleAddAndSendInvites} className="flex gap-2">
                  <input type="text" aria-label="Email addresses" placeholder="alice@acme.com, bob@acme.com" value={inviteInput} onChange={(e) => setInviteInput(e.target.value)} className={`${input} flex-1`} />
                  <button type="submit" disabled={!inviteInput.trim() || !created} className={`${primary} shrink-0`}>
                    <Send className="h-4 w-4" /> Send
                  </button>
                </form>

                {inviteStatuses.length > 0 ? (
                  <ul className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.1] bg-card">
                    <AnimatePresence initial={false}>
                    {inviteStatuses.map((s) => {
                      const expiry = s.expiresAt ? inviteManager.getExpiryMeta(s.expiresAt) : null;
                      return (
                        <motion.li
                          key={s.email}
                          layout="position"
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: 16 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                          className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {s.state === "sending" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />}
                            {s.state === "sent" && <DrawCheck size={16} className="shrink-0" />}
                            {s.state === "error" && <XCircle className="h-4 w-4 shrink-0 text-[#e5484d]" />}
                            <div className="min-w-0">
                              <span className="block truncate text-zinc-100">{s.email}</span>
                              {s.state === "error" && <span className="text-xs text-[#e5484d]">{s.error}</span>}
                              {s.state === "sent" && expiry && (
                                <span className={`mt-0.5 flex items-center gap-1 text-xs ${expiry.urgent ? "text-zinc-200" : "text-zinc-500"}`}>
                                  <Clock className="h-3 w-3" />
                                  {expiry.label}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded-md border border-white/[0.1] px-2 py-0.5 font-mono text-xs text-zinc-400">{s.role}</span>
                            {s.state === "error" && (
                              <button type="button" onClick={() => handleResend(s)} className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100" title="Retry" aria-label="Retry">
                                <RefreshCw className="h-4 w-4" />
                              </button>
                            )}
                            <button type="button" onClick={() => handleRemoveInviteStatus(s.email)} className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-[#e5484d]" title="Remove" aria-label="Remove">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </motion.li>
                      );
                    })}
                    </AnimatePresence>
                  </ul>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/[0.14] px-4 py-4 text-sm text-zinc-500">
                    <UserPlus className="h-4 w-4 shrink-0" />
                    No invites yet. Add emails above, or skip and invite from settings later.
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={() => setCurrentStep(4)} className={ghost}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button type="button" onClick={handleComplete} disabled={launching} className={primary}>
                    {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {launching ? "Opening dashboard…" : "Open dashboard"}
                    {!launching && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}
          </StepPanel>
        </div>
      </main>
    </div>
  );
}
