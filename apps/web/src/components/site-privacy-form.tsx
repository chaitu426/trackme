"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SiteSettings } from "@trackme/contracts";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SelectDropdown, type SelectOption } from "@/components/ui/select-dropdown";
import { CopyButton } from "@/components/ui/copy-button";

const RETENTION_OPTIONS: SelectOption<number>[] = [
  { value: 12, label: "12 Months (1 Year)", description: "Aggressive data minimization for strict GDPR" },
  { value: 24, label: "24 Months (2 Years — Default)", description: "Balanced retention for yearly cohort comparison" },
  { value: 36, label: "36 Months (3 Years)", description: "Longer enterprise historical trend analysis" },
];

export function SitePrivacyForm({
  siteId,
  initialSettings,
}: {
  siteId: string;
  initialSettings: SiteSettings;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [retentionDraft, setRetentionDraft] = useState(initialSettings.retentionMonths);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [signingSecretOnce, setSigningSecretOnce] = useState<string | null>(null);

  const shareUrl =
    typeof window !== "undefined" && settings.publicDashboardSlug
      ? `${window.location.origin}/share/${settings.publicDashboardSlug}`
      : null;

  async function patch(update: Partial<SiteSettings>) {
    setPending(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch(`/api/v1/sites/${siteId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const payload = (await response.json()) as { settings?: SiteSettings; detail?: string };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.detail ?? "Unable to save settings");
      }
      setSettings(payload.settings);
      setSuccessMessage("Settings saved successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save settings");
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
      const payload = (await response.json()) as {
        settings?: SiteSettings;
        signingSecret?: string;
        detail?: string;
      };
      if (!response.ok || !payload.settings || !payload.signingSecret) {
        throw new Error(payload.detail ?? "Unable to rotate signing secret");
      }
      setSettings(payload.settings);
      setSigningSecretOnce(payload.signingSecret);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rotate signing secret");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Privacy & Compliance Controls ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Privacy & Telemetry Controls</CardTitle>
            <Badge variant="outline">Client Telemetry</Badge>
          </div>
          <CardDescription>
            Configure how visitor events are processed at the ingestion edge. All options are evaluated in real-time.
          </CardDescription>
        </CardHeader>

        <div className="divide-y divide-white/[0.06]">
          <ToggleRow
            label="Respect Do Not Track (DNT)"
            description="Silently discard telemetry from visitors who have DNT / Global Privacy Control enabled in their browser"
            checked={settings.respectDoNotTrack}
            disabled={pending}
            onChange={(checked) => void patch({ respectDoNotTrack: checked })}
          />
          <ToggleRow
            label="Collect Web Vitals (RUM)"
            description="Measure LCP, CLS, INP, FCP, and TTFB directly from visitor browsers via PerformanceObserver"
            checked={settings.collectWebVitals}
            disabled={pending}
            onChange={(checked) => void patch({ collectWebVitals: checked })}
          />
          <ToggleRow
            label="Allow Localhost Tracking"
            description="Record telemetry originating from 127.0.0.1 or localhost during local development and testing"
            checked={settings.allowLocalhostTracking}
            disabled={pending}
            onChange={(checked) => void patch({ allowLocalhostTracking: checked })}
          />
          <ToggleRow
            label="Enforce Origin & Referer Match"
            description="Strictly drop events if the browser's Origin or Referrer header does not match this site's hostname"
            checked={settings.requireOriginMatch ?? true}
            disabled={pending}
            onChange={(checked) => void patch({ requireOriginMatch: checked })}
          />
          <ToggleRow
            label="Require Explicit Visitor Consent"
            description="Tracker stays completely idle until your application explicitly calls trackme.grantConsent()"
            checked={settings.requireConsent ?? false}
            disabled={pending}
            onChange={(checked) => void patch({ requireConsent: checked })}
          />
          <ToggleRow
            label="Require HMAC Ingestion Signatures"
            description="Rejects payloads lacking a valid X-TrackMe-Signature header generated by your backend proxy"
            checked={settings.signingRequired ?? false}
            disabled={pending}
            last
            onChange={(checked) => void patch({ signingRequired: checked })}
          />
        </div>

        {/* Ingest Signing Secret */}
        <div className="mt-5 pt-4 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-xs text-zinc-500">
            <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
            <span>
              Signing Secret:{" "}
              {settings.signingSecretHash ? (
                <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-zinc-300">
                  hash:{settings.signingSecretHash.slice(0, 10)}…
                </code>
              ) : (
                <span className="text-zinc-400">Not configured</span>
              )}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void rotateSigningSecret()}
            className="flex items-center space-x-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pending ? "animate-spin" : ""}`} />
            <span>Rotate Signing Secret</span>
          </Button>
        </div>

        {signingSecretOnce && (
          <div className="mt-4 p-4 rounded-xl border border-amber-200 bg-amber-500/10/70 text-xs text-amber-900 animate-in fade-in-0 duration-200">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="font-semibold flex items-center space-x-1.5 text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>New Ingestion Signing Secret (Copy now — shown once)</span>
                </div>
                <p className="text-amber-400 text-[11px]">
                  Store this secret securely in your first-party proxy environment. It will not be displayed again.
                </p>
                <div className="font-mono bg-white/[0.02] border border-amber-200/80 rounded-lg p-2 text-xs select-all text-zinc-50 break-all">
                  {signingSecretOnce}
                </div>
              </div>
              <CopyButton text={signingSecretOnce} label="Copy Secret" />
            </div>
          </div>
        )}
      </Card>

      {/* ── Two-column: Retention Policy + Public Dashboard ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Retention Policy */}
        <Card>
          <CardHeader>
            <CardTitle>Data Retention Policy</CardTitle>
            <CardDescription>
              Automatic ClickHouse partition TTL schedule. Older raw event partitions are pruned automatically.
            </CardDescription>
          </CardHeader>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Active Retention Window
              </label>
              <SelectDropdown<number>
                value={retentionDraft}
                onChange={(val) => setRetentionDraft(val)}
                options={RETENTION_OPTIONS}
                disabled={pending}
              />
            </div>

            <Button
              variant="primary"
              size="sm"
              className="w-full"
              disabled={pending || retentionDraft === settings.retentionMonths}
              onClick={() => void patch({ retentionMonths: retentionDraft })}
            >
              {pending ? "Saving..." : "Apply Retention Schedule"}
            </Button>
          </div>
        </Card>

        {/* Public Dashboard Sharing */}
        <Card>
          <CardHeader>
            <CardTitle>Public Dashboard Link</CardTitle>
            <CardDescription>
              Share aggregate, privacy-safe analytics publicly without requiring user sign-in.
            </CardDescription>
          </CardHeader>

          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="font-semibold text-zinc-50">Enable Public Link</div>
                <div className="text-zinc-500 text-[11px]">
                  Make aggregate dashboard accessible via public URL
                </div>
              </div>
              <Switch
                checked={settings.publicDashboardEnabled}
                disabled={pending}
                onCheckedChange={(checked) => void patch({ publicDashboardEnabled: checked })}
              />
            </div>

            {settings.publicDashboardEnabled && shareUrl ? (
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-zinc-400 text-xs">
                  <span className="font-medium">Public URL:</span>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center space-x-1 text-zinc-500 hover:text-zinc-50 transition"
                  >
                    <span>Open link</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <span className="font-mono text-zinc-300 text-xs truncate max-w-[280px]">
                    {shareUrl}
                  </span>
                  <CopyButton text={shareUrl} />
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="flex items-center space-x-2 text-xs text-emerald-800 bg-emerald-500/10 border border-emerald-200 rounded-xl px-4 py-2.5  animate-in fade-in-0 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center space-x-2 text-xs text-rose-800 bg-rose-500/10 border border-rose-200 rounded-xl px-4 py-2.5  animate-in fade-in-0 duration-200">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  last,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  last?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={`
        flex items-center justify-between py-3.5 gap-4
        ${last ? "" : "border-b border-white/[0.06]"}
      `}
    >
      <div className="space-y-0.5 min-w-0 pr-2">
        <div className="text-xs font-semibold text-zinc-200">{label}</div>
        <div className="text-[11px] text-zinc-500 leading-normal">{description}</div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
