"use client";

import { MatrixSpinner } from "@/components/ui/matrix-loader";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeft, Clock, LogOut, Mail, RefreshCw, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { SelectDropdown } from "@/components/ui/select-dropdown";
import { inputClass } from "@/components/ui/field";
import { DrawCheck, Notice, PillTabs } from "@/components/motion/primitives";
import { useInviteManager, type Invite } from "@/hooks/use-invite-manager";
import { AuditLogViewer } from "@/components/audit-log-viewer";
import type { AuditLogSummary } from "@/lib/audit";
import { cn } from "@/lib/utils";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface OrganizationSettingsClientProps {
  workspace: { id: string; name: string; slug: string; role: string };
  initialMembers: Member[];
  initialInvites: Invite[];
  initialAuditLogs?: AuditLogSummary[];
  currentUserEmail: string;
}

const ROLES = [
  { role: "owner", label: "Owner", desc: "Everything, including billing and transferring ownership" },
  { role: "admin", label: "Admin", desc: "Manage members, sites, tracking keys and settings" },
  { role: "member", label: "Member", desc: "Read and edit analytics, goals and exports" },
  { role: "viewer", label: "Viewer", desc: "Read-only dashboards and reports" },
] as const;

const EASE = [0.22, 1, 0.36, 1] as const;
const rowMotion = {
  layout: "position" as const,
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 16 },
  transition: { duration: 0.22, ease: EASE },
};

function initialsOf(name: string): string {
  return name ? name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() : "TM";
}

export function OrganizationSettingsClient({ workspace, initialMembers, initialInvites, initialAuditLogs = [], currentUserEmail }: OrganizationSettingsClientProps) {
  const router = useRouter();
  const [members, setMembers] = React.useState<Member[]>(initialMembers);
  const [auditLogs] = React.useState<AuditLogSummary[]>(initialAuditLogs);

  const inviteManager = useInviteManager(workspace.id);
  React.useEffect(() => {
    inviteManager.setInvites(initialInvites);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"member" | "admin" | "viewer">("member");
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [inviteNonce, setInviteNonce] = React.useState(0);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [isInviting, setIsInviting] = React.useState(false);

  const [busyMemberId, setBusyMemberId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setIsInviting(true);
    setInviteError(null);
    setSentTo(null);
    const email = inviteEmail.trim();
    const result = await inviteManager.sendInvite(email, inviteRole);
    if (result.success) {
      setSentTo(email);
      setInviteEmail("");
      window.setTimeout(() => setSentTo(null), 4000);
    } else {
      setInviteError(result.error ?? "The invitation could not be sent.");
      setInviteNonce((n) => n + 1);
    }
    setIsInviting(false);
  }

  async function memberRequest(memberId: string, init: RequestInit, failure: string): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setBusyMemberId(memberId);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspace.id}/members/${memberId}`, init);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setActionError(typeof data.message === "string" ? data.message : failure);
      return { ok: res.ok, data };
    } catch {
      setActionError("Network error. Try again.");
      return { ok: false, data: {} };
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleRemoveMember(memberId: string) {
    const { ok } = await memberRequest(memberId, { method: "DELETE" }, "The member could not be removed.");
    if (ok) setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  async function handleLeave(memberId: string) {
    const { ok } = await memberRequest(memberId, { method: "DELETE" }, "You could not leave the workspace.");
    if (ok) {
      router.push("/");
      router.refresh();
    }
  }

  async function handleChangeRole(memberId: string, newRole: "admin" | "member" | "viewer" | "owner") {
    const { ok, data } = await memberRequest(
      memberId,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole }) },
      "The role could not be changed."
    );
    if (!ok) return;
    if (data.ownershipTransferred) {
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: "owner" } : m.email.toLowerCase() === currentUserEmail.toLowerCase() ? { ...m, role: "admin" } : m))
      );
      router.refresh();
    } else {
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)));
    }
  }

  const invites = inviteManager.invites;
  const isOwner = workspace.role === "owner";
  const canManage = isOwner || workspace.role === "admin";

  return (
    <div className="w-full space-y-6">
      <PageHeader title="Organization & Team" art="pulse">
        The team, access roles and invitations for {workspace.name}. API keys and usage are further down this page.
      </PageHeader>

      <AnimatePresence>
        {actionError && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <Alert tone="danger" title="That did not work">
              <span className="flex items-center justify-between gap-3">
                {actionError}
                <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss" className="press grid size-6 place-items-center rounded text-zinc-500 hover:text-zinc-100">
                  <X className="size-3.5" />
                </button>
              </span>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Workspace</CardTitle>
            </CardHeader>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">Name</dt>
                <dd className="text-zinc-100">{workspace.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Address</dt>
                <dd className="font-mono text-xs text-zinc-300">/{workspace.slug}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Your role</dt>
                <dd className="capitalize text-zinc-100">{workspace.role}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>What each role can do</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-3">
              {ROLES.map((r) => (
                <li key={r.role} className={cn("text-sm", r.role === workspace.role ? "text-zinc-100" : "text-zinc-400")}>
                  <span className="font-medium text-zinc-100">{r.label}</span>
                  <span className="block text-xs leading-5 text-zinc-500">{r.desc}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <UserPlus className="size-4 text-zinc-400" aria-hidden="true" />
                Invite a teammate
              </CardTitle>
              <CardDescription>The link works for 7 days. Someone who already has an account is added straight away; a new person sets up theirs on the invite page.</CardDescription>
            </CardHeader>

            <div className="flex flex-col gap-4">
              <PillTabs
                kind="radio"
                label="Role for the new member"
                value={inviteRole}
                onChange={setInviteRole}
                className="self-start"
                items={[
                  { id: "admin", label: "Admin" },
                  { id: "member", label: "Member" },
                  { id: "viewer", label: "Viewer" },
                ]}
              />

              <form onSubmit={handleInvite} className="flex gap-3">
                <div className="relative flex-1">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
                  <input
                    type="email"
                    required
                    aria-label="Email address"
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className={cn(inputClass, "pl-9")}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isInviting || !inviteEmail.trim()}
                  className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#ededed] px-4 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white disabled:pointer-events-none disabled:opacity-50"
                >
                  {isInviting ? <MatrixSpinner /> : <Send className="size-4" aria-hidden="true" />}
                  {isInviting ? "Sending" : "Send invite"}
                </button>
              </form>

              {inviteError && (
                <Notice nonce={inviteNonce} className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
                  {inviteError}
                </Notice>
              )}
              <AnimatePresence>
                {sentTo && (
                  <motion.p role="status" className="flex items-center gap-2 text-sm text-zinc-300" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <DrawCheck size={18} />
                    Invitation sent to {sentTo}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </Card>

          <AnimatePresence initial={false}>
            {invites.length > 0 && (
              <motion.div key="pending" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }}>
                <Card className="px-0 pb-0">
                  <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
                    <CardTitle>
                      <Clock className="size-4 text-zinc-400" aria-hidden="true" />
                      Waiting to join
                      <span className="font-mono text-xs text-zinc-500">{invites.length}</span>
                    </CardTitle>
                  </CardHeader>
                  <ul className="divide-y divide-white/[0.06]">
                    <AnimatePresence initial={false}>
                      {invites.map((invite) => {
                        const expiry = inviteManager.getExpiryMeta(invite.expiresAt);
                        const resending = Boolean(inviteManager.busy[`resend:${invite.id}`]);
                        return (
                          <motion.li key={invite.id} {...rowMotion} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                            <div className="min-w-0">
                              <span className="block truncate text-zinc-100">{invite.email}</span>
                              <span className="flex items-center gap-2 text-xs">
                                <span className="capitalize text-zinc-500">{invite.role}</span>
                                <span className={cn(expiry.expired ? "text-bad" : expiry.urgent ? "text-warn" : "text-zinc-500")}>{expiry.label}</span>
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => inviteManager.resendInvite(invite.id, invite.email, invite.role)}
                                disabled={resending}
                                title="Resend invite"
                                aria-label="Resend invite"
                                className="press grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-40"
                              >
                                {resending ? <MatrixSpinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
                              </button>
                              <ConfirmAction icon={Trash2} title="Revoke invite" confirmLabel="Revoke" onConfirm={() => inviteManager.revokeInvite(invite.id)} />
                            </div>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <Card className="px-0 pb-0">
            <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
              <CardTitle>
                <Users className="size-4 text-zinc-400" aria-hidden="true" />
                Members
                <span className="font-mono text-xs text-zinc-500">{members.length}</span>
              </CardTitle>
            </CardHeader>
            <ul className="divide-y divide-white/[0.06]">
              <AnimatePresence initial={false}>
                {members.map((member) => {
                  const isSelf = member.email.toLowerCase() === currentUserEmail.toLowerCase();
                  const memberIsOwner = member.role === "owner";
                  const busy = busyMemberId === member.id;
                  return (
                    <motion.li key={member.id} {...rowMotion} className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-medium text-zinc-200">{initialsOf(member.name)}</span>
                        <div className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-zinc-100">{member.name}</span>
                            {isSelf && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-zinc-400">You</span>}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">{member.email}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {memberIsOwner ? (
                          <span className="px-2 text-xs text-zinc-300">Owner</span>
                        ) : (
                          <SelectDropdown
                            ariaLabel={`Role for ${member.name}`}
                            value={member.role}
                            disabled={busy || isSelf || !canManage}
                            onChange={(role) => void handleChangeRole(member.id, role as "admin" | "member" | "viewer")}
                            options={[
                              { value: "admin", label: "Admin" },
                              { value: "member", label: "Member" },
                              { value: "viewer", label: "Viewer" },
                            ]}
                            className="w-32"
                          />
                        )}

                        {isOwner && !memberIsOwner && member.role === "admin" && (
                          <ConfirmAction
                            icon={ArrowRightLeft}
                            tone="neutral"
                            title="Transfer ownership"
                            confirmLabel="Make owner"
                            busy={busy}
                            onConfirm={() => void handleChangeRole(member.id, "owner")}
                          />
                        )}
                        {!memberIsOwner && !isSelf && canManage && (
                          <ConfirmAction icon={Trash2} title={`Remove ${member.name}`} confirmLabel="Remove" busy={busy} onConfirm={() => void handleRemoveMember(member.id)} />
                        )}
                        {isSelf && !memberIsOwner && (
                          <ConfirmAction icon={LogOut} title="Leave this organization" confirmLabel="Leave" busy={busy} onConfirm={() => void handleLeave(member.id)} />
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </Card>

          <section aria-labelledby="audit-heading" className="space-y-3">
            <h3 id="audit-heading" className="text-sm font-medium text-zinc-100">
              Recent activity
            </h3>
            <AuditLogViewer logs={auditLogs} />
          </section>
        </div>
      </div>
    </div>
  );
}
