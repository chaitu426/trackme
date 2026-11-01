"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, Plus, Check, Copy, Loader2, X, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AddSiteModalProps {
  workspaceId: string;
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
  onSiteAdded?: (site: { id: string; domain: string; displayName: string }) => void;
}

export function AddSiteModal({
  workspaceId,
  workspaceSlug,
  isOpen,
  onClose,
  onSiteAdded,
}: AddSiteModalProps) {
  const router = useRouter();
  const [domain, setDomain] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createdSite, setCreatedSite] = React.useState<{
    domain: string;
    snippet: string;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domain) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          displayName: displayName.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to add website.");
      }

      setCreatedSite({
        domain: data.site.domain,
        snippet: data.snippet,
      });

      if (onSiteAdded) {
        onSiteAdded(data.site);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error creating website.");
    } finally {
      setLoading(false);
    }
  }

  function handleCopySnippet() {
    if (!createdSite) return;
    navigator.clipboard.writeText(createdSite.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleFinish() {
    onClose();
    if (createdSite) {
      router.push(`/${workspaceSlug}/sites/${createdSite.domain}/realtime`);
      router.refresh();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-card p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition"
        >
          <X className="w-4 h-4" />
        </button>

        {createdSite ? (
          /* Success & Snippet Step */
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4cc38a]/10 text-[#4cc38a] border border-[#4cc38a]/20">
                <Check className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-medium text-zinc-100">Website Added Successfully!</h3>
                <p className="text-xs text-zinc-400">
                  <span className="font-mono text-zinc-200">{createdSite.domain}</span> is now registered in your organization.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300">Tracking Code Snippet</label>
              <div className="relative rounded-xl border border-white/10 bg-zinc-900/90 p-4">
                <pre className="font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all pr-12">
                  {createdSite.snippet}
                </pre>
                <button
                  type="button"
                  onClick={handleCopySnippet}
                  className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-white/10 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-white/20 transition"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-[#4cc38a]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                Paste this tag inside the <code className="text-zinc-400">&lt;head&gt;</code> of your website.
              </p>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button onClick={handleFinish} className="w-full h-10 text-xs font-medium">
                Go to Website Analytics →
              </Button>
            </div>
          </div>
        ) : (
          /* Add Website Form */
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-zinc-300 border border-white/[0.1]">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-medium text-zinc-100">Add Website to Organization</h3>
                <p className="text-xs text-zinc-400">
                  Track additional websites, subdomains, or web apps under this organization.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">
                  Domain / Hostname <span className="text-[#e5484d]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="app.mycompany.com or store.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-xs text-zinc-100 placeholder-zinc-500 focus:border-white/[0.1] focus:outline-none transition"
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-1">Do not include https:// or trailing slashes.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">
                  Display Label (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Production Web App"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-xs text-zinc-100 placeholder-zinc-500 focus:border-white/[0.1] focus:outline-none transition"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-[#e5484d] bg-[#e5484d]/10 border border-[#e5484d]/20 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 h-10 text-xs border-white/10 text-zinc-300 hover:bg-white/[0.04]"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !domain.trim()} className="flex-1 h-10 text-xs font-medium">
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                    Adding…
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5 mr-2" />
                    Add Website
                  </>
                )}
              </Button>
            </div>

            <div className="pt-1 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <Shield className="w-3.5 h-3.5 text-[#4cc38a]" />
              <span>Isolated keys & privacy-preserving telemetry per site</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
