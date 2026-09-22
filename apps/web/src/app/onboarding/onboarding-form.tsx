"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Check,
  Copy,
  Radio,
  ArrowRight,
  ArrowLeft,
  Building2,
  Globe,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FirstEventVerifier } from "@/components/first-event-verifier";

type CreatedWorkspace = {
  workspace: { id: string; name: string; slug: string };
  site: { id: string; domain: string; publicKey: string };
  trackerScriptUrl: string;
  ingestionUrl: string;
};

const inputCls =
  "w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-2.5 text-xs text-zinc-900 placeholder-zinc-400 font-mono focus:outline-none focus:border-zinc-900 focus:bg-white transition";

export function OnboardingForm() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [workspaceName, setWorkspaceName] = useState("Acme Corp");
  const [domain, setDomain] = useState("acmesaas.com");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedWorkspace | null>(null);
  const [copied, setCopied] = useState(false);

  const snippet = created
    ? `<!-- TrackMe Cookieless Tracker (<2KB, privacy-first) -->\n<script defer src="${created.trackerScriptUrl}" data-site="${created.site.publicKey}" data-endpoint="${created.ingestionUrl}"></script>`
    : "";

  async function createWorkspace() {
    setError(null);
    setPending(true);
    const response = await fetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: workspaceName, domain }),
    });
    const payload = (await response.json()) as CreatedWorkspace & { detail?: string };
    setPending(false);

    if (!response.ok) {
      setError(payload.detail ?? "Unable to create workspace");
      return;
    }

    setCreated(payload);
    setStep(3);
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-white border border-zinc-200/90 rounded-2xl shadow-card overflow-hidden">
      {/* Step Progress Bar */}
      <div className="px-7 pt-6 pb-5 border-b border-zinc-100">
        <div className="flex items-center justify-between max-w-sm mx-auto">
          {(["Site Details", "Install Script", "Verify Live"] as const).map(
            (label, idx) => {
              const stepNum = (idx + 1) as 1 | 2 | 3;
              const active = step >= stepNum;
              const current = step === stepNum;
              return (
                <div key={label} className="flex items-center">
                  <div className="flex items-center space-x-2">
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold font-mono transition ${
                        active
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-200 text-zinc-500"
                      }`}
                    >
                      {stepNum}
                    </div>
                    <span
                      className={`text-xs font-semibold transition hidden sm:inline ${
                        current ? "text-zinc-900" : active ? "text-zinc-500" : "text-zinc-400"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                  {idx < 2 && <div className="h-[1px] w-8 sm:w-12 bg-zinc-200 mx-2" />}
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* Step Content */}
      <div className="p-7 sm:p-9 space-y-5">
        {/* ── STEP 1: Site Details ── */}
        {step === 1 && (
          <>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-zinc-900">Connect your website</h2>
              <p className="text-xs text-zinc-500 mt-1">
                TrackMe collects zero personally identifiable data. No consent banners required.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Workspace Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 pl-9 pr-3.5 py-2.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-900 focus:bg-white transition"
                    placeholder="Acme Corp"
                  />
                  <Building2 className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Domain / Hostname
                </label>
                <div className="relative">
                  <span className="absolute left-9 top-2.5 text-xs text-zinc-400 font-mono pointer-events-none">
                    https://
                  </span>
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className={`${inputCls} pl-24 pr-3.5`}
                    placeholder="yoursite.com"
                  />
                  <Globe className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  Subpaths and wildcards can be added later.
                </p>
              </div>

              {/* Privacy info box */}
              <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200/80 flex items-start space-x-3 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-zinc-600">
                  <strong className="text-zinc-800">Edge Privacy:</strong> IPs are salted with an
                  hourly rotating secret and hashed via MurmurHash3 before entering ClickHouse.
                </div>
              </div>
            </div>

            <Button className="w-full flex items-center justify-center space-x-1.5" onClick={() => setStep(2)}>
              <span>Continue to Install Script</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </>
        )}

        {/* ── STEP 2: Install Script ── */}
        {step === 2 && (
          <>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-zinc-900">Add the tracking snippet</h2>
              <p className="text-xs text-zinc-500 mt-1">
                Paste this single{" "}
                <code className="font-mono text-zinc-700 bg-zinc-100 px-1 py-0.5 rounded">&lt;2 KB</code>{" "}
                script tag inside the{" "}
                <code className="font-mono text-zinc-700 bg-zinc-100 px-1 py-0.5 rounded">&lt;head&gt;</code>{" "}
                of your site.
              </p>
            </div>

            {/* Snippet preview box */}
            <div className="relative bg-zinc-900 rounded-xl p-4 font-mono text-xs text-zinc-300 leading-relaxed border border-zinc-800">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 text-zinc-400 text-[11px]">
                <div className="flex items-center space-x-1.5">
                  <Code2 className="w-3.5 h-3.5" />
                  <span>HTML Snippet</span>
                </div>
              </div>
              <pre className="overflow-x-auto pr-4 text-[11px] font-mono">{`<script\n  defer\n  data-domain="${domain}"\n  src="https://trackme.dev/tracker.js"\n></script>`}</pre>
            </div>

            {error && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex space-x-3 pt-1">
              <Button variant="outline" onClick={() => setStep(1)} className="w-1/3 flex items-center justify-center space-x-1.5">
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </Button>
              <Button
                className="w-2/3 flex items-center justify-center space-x-1.5"
                onClick={() => void createWorkspace()}
                disabled={pending || !domain.trim()}
              >
                <span>{pending ? "Creating workspace…" : "Generate & Verify Live"}</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}

        {/* ── STEP 3: Verify Live ── */}
        {step === 3 && created && (
          <>
            <div className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mb-4">
                <Radio className="w-6 h-6 animate-pulse" />
              </div>
              <h2 className="text-lg font-bold tracking-tight text-zinc-900">Listening for your first event…</h2>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                Open <strong className="font-mono text-zinc-800">{created.site.domain}</strong> in another
                tab after installing the snippet below.
              </p>
            </div>

            {/* Full Snippet */}
            <div className="relative bg-zinc-900 rounded-xl p-4 font-mono text-xs text-zinc-300 border border-zinc-800">
              <button
                onClick={() => void copySnippet()}
                className="absolute top-3 right-3 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[11px] font-sans font-medium rounded-lg transition inline-flex items-center space-x-1.5"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <pre className="overflow-x-auto text-[11px] pr-20 whitespace-pre-wrap">{snippet}</pre>
            </div>

            {/* Site Key Row */}
            <div className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs">
              <div>
                <div className="font-semibold text-zinc-800 mb-0.5">Site write key</div>
                <div className="text-zinc-500 font-mono">{created.site.publicKey}</div>
              </div>
              <Badge variant="success">Write-Only</Badge>
            </div>

            {/* Live verifier */}
            <FirstEventVerifier siteId={created.site.id} />

            <Link href={`/${created.workspace.slug}/overview`}>
              <Button className="w-full flex items-center justify-center space-x-1.5">
                <span>Open Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
