"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  UserPlus,
  Mail,
  Shield,
  ShieldAlert,
  Trash2,
  Clock,
  CheckCircle2,
  Building,
  Loader2,
  RefreshCw,
  Link2,
  Check,
  Crown,
  Eye,
  Send,
  XCircle,
  LogOut,
  ArrowRightLeft,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInviteManager, type Invite } from "@/hooks/use-invite-manager";
import { AuditLogViewer } from "@/components/audit-log-viewer";
import type { AuditLogSummary } from "@/lib/audit";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface OrganizationSettingsClientProps {
  workspace: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  initialMembers: Member[];
  initialInvites: Invite[];
  initialAuditLogs?: AuditLogSummary[];
  currentUserEmail: string;
}

const ROLE_META = {
  admin: { label: "Admin", icon: Crown, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  member: { label: "Member", icon: Users, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
  viewer: { label: "Viewer", icon: Eye, color: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
  owner: { label: "Owner", icon: Crown, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
};

export function OrganizationSettingsClient({
  workspace,
  initialMembers,
  initialInvites,
  initialAuditLogs = [],
  currentUserEmail,
}: OrganizationSettingsClientProps) {
  const router = useRouter();
  const [members, setMembers] = React.useState<Member[]>(initialMembers);
  const [auditLogs] = React.useState<AuditLogSummary[]>(initialAuditLogs);

  // Invite state via shared hook
  const inviteManager = useInviteManager(workspace.id);
  React.useEffect(() => {
    inviteManager.setInvites(initialInvites);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Invite form state
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"member" | "admin" | "viewer">("member");
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = React.useState<string | null>(null);
  const [isInviting, setIsInviting] = React.useState(false);

  // Member action states
  const [busyMemberId, setBusyMemberId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // ── Invite send ─────────────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setIsInviting(true);
    setInviteError(null);
    setInviteSuccess(null);

    const result = await inviteManager.sendInvite(inviteEmail.trim(), inviteRole);
    if (result.success) {
      setInviteSuccess(`Invitation sent to ${inviteEmail} ✓`);
      setInviteEmail("");
      setTimeout(() => setInviteSuccess(null), 4000);
    } else {
      setInviteError(result.error ?? "Failed to send invitation.");
    }
    setIsInviting(false);
  }

  // ── Resend ──────────────────────────────────────────────────────────────────
  async function handleResend(invite: Invite) {
    await inviteManager.resendInvite(invite.id, invite.email, invite.role as "admin" | "member" | "viewer");
  }

  // ── Revoke ──────────────────────────────────────────────────────────────────
  async function handleRevokeInvite(inviteId: string) {
    await inviteManager.revokeInvite(inviteId);
  }

  // ── Remove member ───────────────────────────────────────────────────────────
  async function handleRemoveMember(memberId: string) {
    if (!confirm("Are you sure you want to remove this member from the organization?")) return;
    setBusyMemberId(memberId);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspace.id}/members/${memberId}`, { method: "DELETE" });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
      } else {
        const data = await res.json();
        setActionError(data.message || "Failed to remove member.");
      }
    } catch {
      setActionError("Network error while removing member.");
    } finally {
      setBusyMemberId(null);
    }
  }

  // ── Leave workspace (self) ──────────────────────────────────────────────────
  async function handleLeaveWorkspace(memberId: string) {
    if (!confirm("Are you sure you want to leave this organization? You will lose access to its sites and analytics.")) {
      return;
    }
    setBusyMemberId(memberId);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspace.id}/members/${memberId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json();
        setActionError(data.message || "Could not leave workspace.");
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setBusyMemberId(null);
    }
  }

  // ── Change role or Transfer Ownership ───────────────────────────────────────
  async function handleChangeRole(memberId: string, newRole: "admin" | "member" | "viewer" | "owner") {
    if (newRole === "owner") {
      const targetMember = members.find((m) => m.id === memberId);
      if (!confirm(`Are you sure you want to transfer workspace ownership to ${targetMember?.name || targetMember?.email}? You will become an Admin.`)) {
        return;
      }
    }

    setBusyMemberId(memberId);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspace.id}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.ownershipTransferred) {
          // Current user is demoted to admin, target is now owner
          setMembers((prev) =>
            prev.map((m) => {
              if (m.id === memberId) return { ...m, role: "owner" };
              if (m.email.toLowerCase() === currentUserEmail.toLowerCase()) return { ...m, role: "admin" };
              return m;
            })
          );
          router.refresh();
        } else {
          setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)));
        }
      } else {
        setActionError(data.message || "Failed to update member role.");
      }
    } catch {
      setActionError("Network error while updating role.");
    } finally {
      setBusyMemberId(null);
    }
  }

  const invites = inviteManager.invites;
  const isOwner = workspace.role === "owner";

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-zinc-200">
            <Building className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              {workspace.name} · Organization Settings
            </h1>
            <p className="text-xs text-zinc-400">
              Manage organization profile, team members, access roles, and invitations.
            </p>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Organization Info & Role Legend */}
        <div className="lg:col-span-1 space-y-4">
          {/* Org info */}
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-100">Organization Info</h3>
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-zinc-500 block text-[11px]">Organization Name</span>
                <span className="font-medium text-zinc-200">{workspace.name}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Workspace Slug</span>
                <span className="font-mono text-zinc-300 bg-white/[0.04] px-2 py-0.5 rounded text-[11px]">
                  {workspace.slug}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Your Access Level</span>
                <span className="inline-flex items-center gap-1 font-semibold uppercase text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Shield className="w-3 h-3" />{workspace.role}
                </span>
              </div>
            </div>
          </div>

          {/* Role permission legend */}
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-5 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Role Permissions</h3>
            {[
              { role: "owner", desc: "Full access, billing, and ownership transfer" },
              { role: "admin", desc: "Manage members, sites, tracking keys, settings" },
              { role: "member", desc: "Read & edit analytics, goals, and exports" },
              { role: "viewer", desc: "Read-only analytics dashboards and reports" },
            ].map((r) => {
              const meta = ROLE_META[r.role as keyof typeof ROLE_META];
              return (
                <div key={r.role} className="flex items-start gap-2.5">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${meta.color}`}>
                    {r.role}
                  </span>
                  <span className="text-[11px] text-zinc-500 leading-relaxed">{r.desc}</span>
                </div>
              );
            })}
          </div>

          {/* Privacy & Security */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
              <ShieldAlert className="w-4 h-4" />
              <span>Multi-Tenant Cryptographic Isolation</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Every query and event stream is strictly partitioned to this workspace's tenant boundary.
            </p>
          </div>
        </div>

        {/* Right Column: Invite Form, Pending Invites, Active Members, and Audit Trail */}
        <div className="lg:col-span-2 space-y-6">
          {/* Invite Form */}
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-400" />
                Invite Team Member
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Send an invitation link valid for 7 days. Existing users are added instantly; new users set up their account on the invite page.
              </p>
            </div>

            {/* Role selector */}
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {(["admin", "member", "viewer"] as const).map((r) => {
                const meta = ROLE_META[r];
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setInviteRole(r)}
                    className={`rounded-xl border px-3 py-2 text-left transition ${meta.color} ${inviteRole === r ? "ring-1 ring-white/20" : "opacity-50 hover:opacity-75"}`}
                  >
                    <div className="font-semibold capitalize">{r}</div>
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleInvite} className="flex gap-2.5">
              <div className="relative flex-1">
                <input
                  type="email"
                  required
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 pl-9 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none transition"
                />
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <Button type="submit" disabled={isInviting || !inviteEmail.trim()} className="h-10 text-xs font-semibold shrink-0 gap-2">
                {isInviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {isInviting ? "Sending…" : "Send Invite"}
              </Button>
            </form>

            {inviteError && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
                <XCircle className="w-3.5 h-3.5 shrink-0" />{inviteError}
              </p>
            )}
            {inviteSuccess && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />{inviteSuccess}
              </p>
            )}
          </div>

          {/* Pending Invites */}
          {invites.length > 0 && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.02] p-5 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Pending Invitations ({invites.length})
              </h4>
              <div className="divide-y divide-white/[0.06]">
                {invites.map((invite) => {
                  const expiry = inviteManager.getExpiryMeta(invite.expiresAt);
                  const isResending = inviteManager.busy[`resend:${invite.id}`];
                  const hasToken = !!invite.token;
                  return (
                    <div key={invite.id} className="flex items-center justify-between py-3 text-xs">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-zinc-200">{invite.email}</span>
                          <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
                            invite.role === "admin" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                            invite.role === "viewer" ? "text-sky-400 bg-sky-500/10 border-sky-500/20" :
                            "text-indigo-400 bg-indigo-500/10 border-indigo-500/20"
                          }`}>{invite.role}</span>
                          <span className={`flex items-center gap-1 ${expiry.expired ? "text-rose-400" : expiry.urgent ? "text-amber-400" : "text-zinc-500"}`}>
                            <Clock className="w-2.5 h-2.5" />{expiry.label}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-3">
                        {/* Resend */}
                        <button
                          onClick={() => handleResend(invite)}
                          disabled={!!isResending}
                          className="text-zinc-500 hover:text-indigo-400 transition p-1.5 rounded-lg hover:bg-white/[0.04]"
                          title="Resend invite"
                        >
                          {isResending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                        {/* Copy link */}
                        <button
                          onClick={() => inviteManager.copyInviteLink(invite.token || invite.id, invite.id)}
                          className="text-zinc-500 hover:text-zinc-300 transition p-1.5 rounded-lg hover:bg-white/[0.04]"
                          title={hasToken ? "Copy invite link" : "Invite link unavailable"}
                        >
                          {inviteManager.copiedToken === invite.id
                            ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                            : <Link2 className="w-3.5 h-3.5" />}
                        </button>
                        {/* Revoke */}
                        <button
                          onClick={() => handleRevokeInvite(invite.id)}
                          className="text-zinc-500 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-white/[0.04]"
                          title="Revoke invite"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Members List */}
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-zinc-400" />
              Active Members ({members.length})
            </h3>

            <div className="divide-y divide-white/[0.06]">
              {members.map((member) => {
                const isSelf = member.email.toLowerCase() === currentUserEmail.toLowerCase();
                const memberIsOwner = member.role === "owner";
                const initials = member.name
                  ? member.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
                  : "TM";

                return (
                  <div key={member.id} className="flex items-center justify-between py-3.5 text-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 text-[11px] font-bold text-zinc-200 shrink-0">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-zinc-100 truncate">{member.name}</span>
                          {isSelf && (
                            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-indigo-300">
                              You
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-zinc-400 truncate block">{member.email}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 ml-3">
                      {memberIsOwner ? (
                        <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-400">
                          Owner
                        </span>
                      ) : (
                        <select
                          value={member.role}
                          disabled={busyMemberId === member.id || isSelf || (!isOwner && workspace.role !== "admin")}
                          onChange={(e) => handleChangeRole(member.id, e.target.value as "admin" | "member" | "viewer")}
                          className="rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 focus:outline-none cursor-pointer"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      )}

                      {/* Transfer Ownership button (only visible to current Owner for Admin members) */}
                      {isOwner && !memberIsOwner && member.role === "admin" && (
                        <button
                          type="button"
                          onClick={() => handleChangeRole(member.id, "owner")}
                          disabled={busyMemberId === member.id}
                          className="text-zinc-500 hover:text-amber-400 transition p-1.5 rounded-lg hover:bg-white/[0.04]"
                          title="Transfer Workspace Ownership"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Remove member (by Admin or Owner) */}
                      {!memberIsOwner && !isSelf && (isOwner || workspace.role === "admin") && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={busyMemberId === member.id}
                          className="text-zinc-500 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-white/[0.04]"
                          title="Remove member"
                        >
                          {busyMemberId === member.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      )}

                      {/* Leave Workspace (Self, Non-owner) */}
                      {isSelf && !memberIsOwner && (
                        <button
                          type="button"
                          onClick={() => handleLeaveWorkspace(member.id)}
                          disabled={busyMemberId === member.id}
                          className="text-zinc-500 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-white/[0.04] flex items-center gap-1 text-[11px]"
                          title="Leave organization"
                        >
                          {busyMemberId === member.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <LogOut className="w-3.5 h-3.5" />
                          )}
                          <span className="hidden sm:inline">Leave</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Workspace Audit Trail */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-400" />
              <h3 className="text-sm font-semibold text-zinc-100">Audit Trail</h3>
            </div>
            <AuditLogViewer logs={auditLogs} />
          </div>
        </div>
      </div>
    </div>
  );
}
