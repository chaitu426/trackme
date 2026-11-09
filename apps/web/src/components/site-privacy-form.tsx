"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import type { SiteSettings } from "@trackme/contracts";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { SelectDropdown, type SelectOption } from "@/components/ui/select-dropdown";
import { CopyButton } from "@/components/ui/copy-button";
import { Collapse, DrawCheck } from "@/components/motion/primitives";

const RETENTION_OPTIONS: SelectOption<number>[] = [
  { value: 12, label: "12 months", description: "Strictest data minimisation" },
  { value: 24, label: "24 months (default)", description: "Enough for year-over-year comparison" },
  { value: 36, label: "36 months", description: "Longer historical trends" },
];

const primaryButton =
  "press inline-flex h-9 items-center justify-center rounded-lg bg-[#ededed] px-4 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white disabled:pointer-events-none disabled:opacity-50";

export function SitePrivacyForm({ siteId, initialSettings }: { siteId: string; initialSettings: SiteSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [retentionDraft, setRetentionDraft] = useState(initialSettings.retentionMonths);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [signingSecretOnce, setSigningSecretOnce] = useState<string | null>(null);

  const shareUrl = typeof window !== "undefined" && settings.publicDashboardSlug ? `${window.location.origin}/share/${settings.publicDashboardSlug}` : null;

  function flashSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function patch(update: Partial<SiteSettings>) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sites/${siteId}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) });
      const payload = (await response.json()) as { settings?: SiteSettings; detail?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.detail ?? "The settings could not be saved");
      setSettings(payload.settings);
      flashSaved();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The settings could not be saved");
    } finally {
      setPending(false);
    }
  }

  async function rotateSigningSecret() {
    setPending(true);
    setError(null);
    setSigningSecretOnce(null);
    try {
      const response = await fetch(`/api/v1/sites/${siteId}/signing-secret`, { method: "POST" });
      const payload = (await response.json()) as { settings?: SiteSettings; signingSecret?: string; detail?: string };
      if (!response.ok || !payload.settings || !payload.signingSecret) throw new Error(payload.detail ?? "The signing secret could not be rotated");
      setSettings(payload.settings);
      setSigningSecretOnce(payload.signingSecret);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The signing secret could not be rotated");
    } finally {
      setPending(false);
    }
  }

  const toggle = (key: keyof SiteSettings) => (checked: boolean) => void patch({ [key]: checked } as Partial<SiteSettings>);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Privacy and collection</CardTitle>
          <CardDescription>How visitor events are handled at the edge. Each change applies as soon as it saves.</CardDescription>
        </CardHeader>

        <Group title="Visitors">
          <ToggleRow label="Respect Do Not Track" description="Drop events from visitors whose browser sends Do Not Track or Global Privacy Control" checked={settings.respectDoNotTrack} disabled={pending} onChange={toggle("respectDoNotTrack")} />
          <ToggleRow label="Require visitor consent" description="The tracker stays idle until your app calls trackme.grantConsent()" checked={settings.requireConsent ?? false} disabled={pending} onChange={toggle("requireConsent")} />
        </Group>
        <Group title="Measurement">
          <ToggleRow label="Collect Web Vitals" description="Measure LCP, CLS, INP, FCP and TTFB in visitors' browsers" checked={settings.collectWebVitals} disabled={pending} onChange={toggle("collectWebVitals")} />
          <ToggleRow label="Allow localhost" description="Record events from localhost during development" checked={settings.allowLocalhostTracking} disabled={pending} onChange={toggle("allowLocalhostTracking")} />
        </Group>
        <Group title="Ingestion security" last>
          <ToggleRow label="Enforce origin match" description="Drop events whose Origin or Referer does not match this site's hostname" checked={settings.requireOriginMatch ?? true} disabled={pending} onChange={toggle("requireOriginMatch")} />
          <ToggleRow label="Require signed payloads" description="Reject events without a valid X-TrackMe-Signature from your backend proxy" checked={settings.signingRequired ?? false} disabled={pending} onChange={toggle("signingRequired")} />
        </Group>

        <div className="mt-5 flex flex-col justify-between gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <KeyRound className="size-3.5 text-zinc-400" aria-hidden="true" />
            <span>
              Signing secret{" "}
              {settings.signingSecretHash ? <code className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-zinc-300">hash:{settings.signingSecretHash.slice(0, 10)}…</code> : <span className="text-zinc-400">not set</span>}
            </span>
          </div>
          <button type="button" disabled={pending} onClick={() => void rotateSigningSecret()} className="press inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs text-zinc-300 hover:border-white/[0.2] hover:text-zinc-50 disabled:opacity-50">
            <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
            Rotate secret
          </button>
        </div>

        <Collapse open={Boolean(signingSecretOnce)}>
          <div className="pt-4">
            <Alert tone="warning" title="Copy this secret now">
              <p>It is shown once. Store it in your proxy's environment.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-black/30 p-2 font-mono text-xs text-zinc-50">{signingSecretOnce}</code>
                {signingSecretOnce && <CopyButton text={signingSecretOnce} label="Copy" />}
              </div>
            </Alert>
          </div>
        </Collapse>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data retention</CardTitle>
            <CardDescription>Raw events older than this are deleted automatically.</CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-4">
            <SelectDropdown<number> ariaLabel="Retention window" value={retentionDraft} onChange={setRetentionDraft} options={RETENTION_OPTIONS} disabled={pending} />
            <button type="button" className={primaryButton} disabled={pending || retentionDraft === settings.retentionMonths} onClick={() => void patch({ retentionMonths: retentionDraft })}>
              {pending ? "Saving" : "Apply retention"}
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Public dashboard</CardTitle>
            <CardDescription>Share aggregate, privacy-safe analytics without a sign-in.</CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <span id="public-label" className="text-sm text-zinc-200">
                Enable public link
              </span>
              <Switch aria-label="Enable public link" checked={settings.publicDashboardEnabled} disabled={pending} onCheckedChange={toggle("publicDashboardEnabled")} />
            </div>
            <Collapse open={Boolean(settings.publicDashboardEnabled && shareUrl)}>
              <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4">
                <a href={shareUrl ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-end text-xs text-zinc-500 hover:text-zinc-50">
                  Open link <ExternalLink className="size-3" aria-hidden="true" />
                </a>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white/[0.03] p-3">
                  <span className="truncate font-mono text-xs text-zinc-300">{shareUrl}</span>
                  {shareUrl && <CopyButton text={shareUrl} />}
                </div>
              </div>
            </Collapse>
          </div>
        </Card>
      </div>

      {error && <Alert tone="danger" title="Not saved">{error}</Alert>}

      <AnimatePresence>
        {saved && (
          <motion.div
            role="status"
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-border bg-raised px-4 py-2.5 text-sm text-zinc-100 shadow-float"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            <DrawCheck size={16} />
            Saved
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Group({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section className={last ? "" : "mb-1"}>
      <h4 className="mt-4 text-xs font-medium text-zinc-400">{title}</h4>
      <div className="divide-y divide-white/[0.06]">{children}</div>
    </section>
  );
}

function ToggleRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-sm text-zinc-100">{label}</div>
        <div className="mt-0.5 text-xs leading-5 text-zinc-500">{description}</div>
      </div>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
