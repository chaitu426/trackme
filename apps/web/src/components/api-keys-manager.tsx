"use client";

import { useState } from "react";
import { KeyRound, Plus, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export function ApiKeysManager({
  workspaceId,
  initialKeys,
}: {
  workspaceId: string;
  initialKeys: ApiKeySummary[];
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function generateKey() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Reporting Key ${keys.length + 1}`,
          scopes: ["read:analytics"],
        }),
      });
      const payload = (await response.json()) as {
        key?: ApiKeySummary & { plaintext: string };
        detail?: string;
      };
      if (!response.ok || !payload.key) {
        throw new Error(payload.detail ?? "Unable to create API key");
      }
      const { plaintext, ...summary } = payload.key;
      setKeys((prev) => [summary, ...prev]);
      setJustCreated(plaintext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create API key");
    } finally {
      setPending(false);
    }
  }

  async function confirmRevokeKey(keyId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/api-keys/${keyId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { success?: boolean; detail?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.detail ?? "Unable to revoke API key");
      }
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
      setRevokingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to revoke API key");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <KeyRound className="w-4 h-4 text-zinc-700" />
            <CardTitle>Programmatic API Tokens</CardTitle>
          </div>
          <Badge variant="outline">REST API</Badge>
        </div>
        <CardDescription>
          Read tokens for querying aggregate metrics via automated pipelines and dashboards.
        </CardDescription>
      </CardHeader>

      <div className="space-y-4">
        {/* Just Created Token Banner */}
        {justCreated && (
          <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs space-y-2 animate-in fade-in-0 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-emerald-800 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>API Key Generated — Copy it now</span>
              </div>
              <CopyButton text={justCreated} label="Copy Token" />
            </div>
            <p className="text-[11px] text-emerald-700">
              For security reasons, this token will never be displayed again.
            </p>
            <div className="p-2.5 rounded-lg bg-white border border-emerald-200 font-mono text-[11px] text-zinc-900 break-all select-all">
              {justCreated}
            </div>
          </div>
        )}

        {/* List of keys */}
        {keys.length === 0 ? (
          <div className="text-center py-8 px-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
            <KeyRound className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-zinc-700">No API keys created</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Generate a key to query ClickHouse analytics via the REST API.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {keys.map((key) => (
              <div
                key={key.id}
                className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200/80 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition hover:bg-zinc-50/80"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-zinc-900">{key.name}</span>
                    <Badge variant="outline">{key.scopes.join(", ")}</Badge>
                  </div>
                  <div className="flex items-center space-x-2 text-zinc-500 font-mono text-[11px]">
                    <span>{key.prefix}••••••••••••••••</span>
                    <span className="text-zinc-300">·</span>
                    <span className="text-zinc-400 font-sans text-[11px]">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Revoke confirmation / action */}
                {revokingId === key.id ? (
                  <div className="flex items-center space-x-2 animate-in fade-in-0 duration-150">
                    <span className="text-[11px] text-rose-600 font-medium">Revoke key?</span>
                    <Button
                      variant="danger"
                      size="sm"
                      className="h-7 text-xs px-2.5"
                      disabled={pending}
                      onClick={() => void confirmRevokeKey(key.id)}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2"
                      disabled={pending}
                      onClick={() => setRevokingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-zinc-400 hover:text-rose-600 hover:bg-rose-50 text-xs h-7 px-2.5 transition shrink-0 self-start sm:self-center"
                    disabled={pending}
                    onClick={() => setRevokingId(key.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    <span>Revoke</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center space-x-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full flex items-center justify-center space-x-1.5"
          disabled={pending}
          onClick={() => void generateKey()}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{pending ? "Generating Key..." : "Generate New API Key"}</span>
        </Button>
      </div>
    </Card>
  );
}
