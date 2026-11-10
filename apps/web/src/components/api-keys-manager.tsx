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

  async function generateKey(kind: "reporting" | "deploy" = "reporting") {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: kind === "deploy" ? `Deploy Key ${keys.length + 1}` : `Reporting Key ${keys.length + 1}`,
          scopes: kind === "deploy" ? ["write:deploys"] : ["read:analytics"],
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
            <KeyRound className="w-4 h-4 text-zinc-300" />
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
          <div className="p-4 rounded-xl bg-good/10/80 border border-good text-xs space-y-2 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-good font-medium">
                <CheckCircle2 className="w-4 h-4 text-good" />
                <span>API Key Generated — Copy it now</span>
              </div>
              <CopyButton text={justCreated} label="Copy Token" />
            </div>
            <p className="text-xs text-good">
              For security reasons, this token will never be displayed again.
            </p>
            <div className="p-3 rounded-lg bg-white/[0.02] border border-good font-mono text-xs text-zinc-50 break-all select-all">
              {justCreated}
            </div>
          </div>
        )}

        {/* List of keys */}
        {keys.length === 0 ? (
          <div className="text-center py-8 px-4 rounded-xl border border-dashed border-border bg-white/[0.03]/50">
            <KeyRound className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
            <p className="text-xs font-medium text-zinc-300">No API keys created</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Generate a key to query ClickHouse analytics via the REST API.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="p-4 rounded-xl bg-white/[0.03] border border-border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition hover:bg-white/[0.03]/80"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-zinc-50">{key.name}</span>
                    <Badge variant="outline">{key.scopes.join(", ")}</Badge>
                  </div>
                  <div className="flex items-center space-x-2 text-zinc-500 font-mono text-xs">
                    <span>{key.prefix}••••••••••••••••</span>
                    <span className="text-zinc-300">·</span>
                    <span className="text-zinc-400 font-sans text-xs">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Revoke confirmation / action */}
                {revokingId === key.id ? (
                  <div className="flex items-center space-x-2 animate-fade-in">
                    <span className="text-xs text-bad font-medium">Revoke key?</span>
                    <Button
                      variant="danger"
                      size="sm"
                      className="h-7 text-xs px-3"
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
                    className="text-zinc-400 hover:text-bad hover:bg-bad/10 text-xs h-7 px-3 transition shrink-0 self-start sm:self-center"
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
          <div className="flex items-center space-x-2 text-xs text-bad bg-bad/10 border border-bad rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full flex items-center justify-center space-x-2"
          disabled={pending}
          onClick={() => void generateKey()}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{pending ? "Generating Key..." : "Generate New API Key"}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full flex items-center justify-center space-x-2"
          disabled={pending}
          onClick={() => void generateKey("deploy")}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Generate Deploy Key (CI: report deploys, upload source maps)</span>
        </Button>
      </div>
    </Card>
  );
}
