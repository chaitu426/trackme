"use client";

import { MatrixSpinner } from "@/components/ui/matrix-loader";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { StatusDot } from "@/components/ui/status-dot";
import { TextInput } from "@/components/ui/field";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Notice } from "@/components/motion/primitives";
import { Trash2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";

export interface GatewayState {
  gateway: "razorpay" | "stripe";
  label: string;
  connected: boolean;
  enabled: boolean;
  lastEventAt: string | null;
  webhookUrl: string;
  events: string;
}

/** Connect, rotate, pause or remove one gateway as three numbered steps. The signing secret is write-only: sent once, never shown again. */
export function PaymentGatewayCard({ siteId, g }: { siteId: string; g: GatewayState }) {
  const router = useRouter();
  const [secret, setSecret] = React.useState("");
  const [state, setState] = React.useState<"idle" | "saving" | "error">("idle");
  const [nonce, setNonce] = React.useState(0);
  const endpoint = `/api/v1/sites/${siteId}/payment-gateways`;

  async function call(init: RequestInit, url = endpoint) {
    setState("saving");
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
    if (!res?.ok) {
      setNonce((n) => n + 1);
      return setState("error");
    }
    setSecret("");
    setState("idle");
    router.refresh();
  }

  const status = !g.connected
    ? ({ tone: "idle", label: "Not connected" } as const)
    : !g.enabled
      ? ({ tone: "warn", label: "Paused" } as const)
      : g.lastEventAt
        ? ({ tone: "ok", label: "Receiving events" } as const)
        : ({ tone: "warn", label: "Waiting for the first event" } as const);

  return (
    <Card className="enter">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
        <h3 className="text-sm font-medium text-zinc-50">{g.label}</h3>
        <div className="flex items-center gap-4">
          <StatusDot tone={status.tone} label={status.label} live={status.tone === "ok"} />
          {g.connected && g.lastEventAt && <span className="hidden text-xs text-zinc-500 sm:inline">Last event {formatRelativeTime(g.lastEventAt)}</span>}
        </div>
      </div>

      <ol className="mt-5 flex flex-col gap-6">
        <Step n={1} title="Add the webhook URL" hint={`In your ${g.label} dashboard, subscribe to: ${g.events}.`}>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-white/[0.03] px-3 py-2 font-mono text-xs text-zinc-300">{g.webhookUrl}</code>
            <CopyButton text={g.webhookUrl} label="Copy" />
          </div>
        </Step>

        <Step n={2} title={g.connected ? "Rotate the signing secret" : "Paste the signing secret"} hint="Stored encrypted. It is never shown again after you save it.">
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (secret.length >= 8) void call({ method: "PUT", body: JSON.stringify({ gateway: g.gateway, secret }) });
            }}
          >
            <TextInput
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={g.connected ? "New signing secret" : "Signing secret"}
              aria-label={`${g.label} webhook signing secret`}
              className="w-72"
            />
            <button
              type="submit"
              disabled={secret.length < 8 || state === "saving"}
              className="press inline-flex h-10 items-center gap-2 rounded-lg bg-[#ededed] px-4 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white disabled:pointer-events-none disabled:opacity-50"
            >
              {state === "saving" && <MatrixSpinner />}
              {g.connected ? "Update secret" : "Connect"}
            </button>
          </form>
          {state === "error" && (
            <Notice nonce={nonce} className="mt-3 rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-sm text-[#e5484d]">
              Could not save. Check the secret and try again.
            </Notice>
          )}
        </Step>

        <Step n={3} title="Check that events arrive" hint={g.connected ? "Make a test payment in the gateway's test mode. The status above turns green when the first event lands." : "Connect first, then make a test payment."}>
          {g.connected && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={state === "saving"}
                onClick={() => void call({ method: "PUT", body: JSON.stringify({ gateway: g.gateway, enabled: !g.enabled }) })}
                className="press h-9 rounded-lg border border-border px-3 text-sm text-zinc-300 hover:border-white/[0.2] hover:text-zinc-50"
              >
                {g.enabled ? "Pause" : "Resume"}
              </button>
              <ConfirmAction icon={Trash2} title={`Disconnect ${g.label}`} confirmLabel="Disconnect" onConfirm={() => void call({ method: "DELETE" }, `${endpoint}?gateway=${g.gateway}`)} />
            </div>
          )}
        </Step>
      </ol>
    </Card>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <span className="grid size-7 place-items-center rounded-md border border-white/[0.14] font-mono text-xs text-zinc-400">{String(n).padStart(2, "0")}</span>
      <div className="min-w-0">
        <p className="text-sm text-zinc-100">{title}</p>
        <p className="mb-3 mt-0.5 text-xs leading-5 text-zinc-500">{hint}</p>
        {children}
      </div>
    </li>
  );
}
