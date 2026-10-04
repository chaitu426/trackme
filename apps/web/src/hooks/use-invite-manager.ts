"use client";

/**
 * useInviteManager — shared invite logic used by:
 *  - Onboarding Step 5 (new workspace, queue + send on complete)
 *  - Organization Settings page (live send, resend, revoke)
 *
 * Keeps the two surfaces tightly coupled to a single source of truth.
 */

import * as React from "react";

export interface Invite {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  status: string;
  expiresAt: string;
  createdAt: string;
  token?: string;
}

export interface InviteResult {
  success: boolean;
  invite?: Invite;
  error?: string;
}

export function useInviteManager(workspaceId: string | null) {
  const [invites, setInvites] = React.useState<Invite[]>([]);
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [copiedToken, setCopiedToken] = React.useState<string | null>(null);

  // ── Send / Re-invite ───────────────────────────────────────────────────────
  async function sendInvite(
    email: string,
    role: Invite["role"]
  ): Promise<InviteResult> {
    if (!workspaceId) return { success: false, error: "No workspace selected." };

    setBusy((b) => ({ ...b, [`send:${email}`]: true }));
    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.message || "Failed to send invite." };
      }
      const newInvite: Invite = data.invite;
      setInvites((prev) => [newInvite, ...prev.filter((i) => i.email !== email)]);
      return { success: true, invite: newInvite };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[`send:${email}`]; return n; });
    }
  }

  // ── Resend (revokes old token, issues fresh one) ────────────────────────────
  async function resendInvite(inviteId: string, email: string, role: Invite["role"]): Promise<InviteResult> {
    if (!workspaceId) return { success: false, error: "No workspace." };

    setBusy((b) => ({ ...b, [`resend:${inviteId}`]: true }));
    try {
      // Re-send = POST again — the API auto-revokes the old pending invite
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.message || "Failed to resend." };
      }
      const updated: Invite = data.invite;
      setInvites((prev) => prev.map((i) => (i.id === inviteId ? updated : i)));
      return { success: true, invite: updated };
    } catch {
      return { success: false, error: "Network error." };
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[`resend:${inviteId}`]; return n; });
    }
  }

  // ── Revoke ─────────────────────────────────────────────────────────────────
  async function revokeInvite(inviteId: string): Promise<boolean> {
    if (!workspaceId) return false;
    setBusy((b) => ({ ...b, [`revoke:${inviteId}`]: true }));
    try {
      const res = await fetch(
        `/api/v1/workspaces/${workspaceId}/invites/${inviteId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[`revoke:${inviteId}`]; return n; });
    }
  }

  // ── Copy invite link ───────────────────────────────────────────────────────
  async function copyInviteLink(tokenOrId: string, trackKey?: string): Promise<void> {
    const appUrl = window.location.origin;
    const url = `${appUrl}/invite/accept?token=${tokenOrId}`;
    await navigator.clipboard.writeText(url);
    const key = trackKey ?? tokenOrId;
    setCopiedToken(key);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  // ── Expiry helpers ─────────────────────────────────────────────────────────
  function getExpiryMeta(expiresAt: string): {
    label: string;
    urgent: boolean;
    expired: boolean;
  } {
    const diff = new Date(expiresAt).getTime() - Date.now();
    const hours = diff / 1000 / 60 / 60;
    if (diff <= 0) return { label: "Expired", urgent: true, expired: true };
    if (hours < 24) return { label: `Expires in ${Math.round(hours)}h`, urgent: true, expired: false };
    const days = Math.ceil(hours / 24);
    return { label: `Expires in ${days}d`, urgent: false, expired: false };
  }

  return {
    invites,
    setInvites,
    busy,
    copiedToken,
    sendInvite,
    resendInvite,
    revokeInvite,
    copyInviteLink,
    getExpiryMeta,
  };
}
