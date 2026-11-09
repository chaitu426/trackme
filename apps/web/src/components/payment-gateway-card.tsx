"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";

export interface GatewayState {
  gateway: "razorpay" | "stripe";
  label: string;
  connected: boolean;
  enabled: boolean;
  lastEventAt: string | null;
  webhookUrl: string;
  events: string;
}

/** Connect, rotate or remove one gateway. The signing secret is write-only: it is sent once and never shown again. */
export function PaymentGatewayCard({ siteId, g }: { siteId: string; g: GatewayState }) {
  const router = useRouter();
  const [secret, setSecret] = React.useState("");
  const [state, setState] = React.useState<"idle" | "saving" | "error">("idle");
  const endpoint = `/api/v1/sites/${siteId}/payment-gateways`;

  async function call(init: RequestInit, url = endpoint) {
    setState("saving");
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
    if (!res?.ok) return setState("error");
    setSecret("");
    setState("idle");
    router.refresh();
  }

  return (
    <section className="linear-card p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-zinc-200" />
          <h3 className="text-sm font-medium text-zinc-50">{g.label}</h3>
          {g.connected && <Badge>{g.enabled ? "Connected" : "Paused"}</Badge>}
        </div>
        {g.connected && (
          <span className="text-xs text-zinc-500">
            {g.lastEventAt ? `Last event ${new Date(g.lastEventAt).toLocaleString()}` : "No events received yet"}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-zinc-500">
          Add this URL as a webhook in your {g.label} dashboard. Subscribe to: {g.events}.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-white/[0.06] px-2 py-1.5 font-mono text-xs text-zinc-300">{g.webhookUrl}</code>
          <CopyButton text={g.webhookUrl} label="Copy" />
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (secret.length >= 8) void call({ method: "PUT", body: JSON.stringify({ gateway: g.gateway, secret }) });
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={g.connected ? "Paste a new signing secret to rotate" : "Webhook signing secret"}
          aria-label={`${g.label} webhook signing secret`}
          className="h-9 w-80 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={secret.length < 8 || state === "saving"}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/[0.08] px-3 text-sm text-zinc-100 disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> {g.connected ? "Update secret" : "Connect"}
        </button>
        {g.connected && (
          <>
            <button
              type="button"
              disabled={state === "saving"}
              onClick={() => void call({ method: "PUT", body: JSON.stringify({ gateway: g.gateway, enabled: !g.enabled }) })}
              className="h-9 rounded-md px-3 text-sm text-zinc-400 hover:text-zinc-100"
            >
              {g.enabled ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              disabled={state === "saving"}
              onClick={() => {
                if (confirm(`Disconnect ${g.label}? Webhooks will be rejected until you reconnect.`)) {
                  void call({ method: "DELETE" }, `${endpoint}?gateway=${g.gateway}`);
                }
              }}
              className="h-9 rounded-md px-3 text-sm text-red-400 hover:text-red-300"
            >
              Disconnect
            </button>
          </>
        )}
        <span role="status" className="text-xs text-red-400">
          {state === "error" ? "Could not save. Check the secret and try again." : ""}
        </span>
      </form>
    </section>
  );
}
