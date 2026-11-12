"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserPlus, X, Crown } from "lucide-react";
import { FEATURES, FEATURE_INFO, type AccessLevel, type AccessMode, type Feature } from "@trackme/contracts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SelectDropdown } from "@/components/ui/select-dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { PillTabs } from "@/components/motion/primitives";
import { toast } from "@/lib/toast";
import { apiCall } from "@/lib/api-call";
import { cn } from "@/lib/utils";
import { TEAM_PRESETS } from "@/lib/team-presets";
import type { SiteAccessView, TeamView } from "@/lib/teams-data";

type Cell = AccessLevel | "none";
type GrantMap = Record<Feature, Cell>;
type Person = { id: string; name: string; email: string; role: string };

interface Props {
  workspace: { id: string; slug: string };
  canManage: boolean;
  currentUserId: string;
  initialMode: AccessMode;
  sites: SiteAccessView[];
  teams: TeamView[];
  people: Person[];
}

const NEXT: Record<Cell, Cell> = { none: "view", view: "manage", manage: "none" };

const toMap = (raw: Record<string, string> | undefined): GrantMap =>
  Object.fromEntries(FEATURES.map((f) => [f, raw?.[f] === "view" || raw?.[f] === "manage" ? (raw[f] as AccessLevel) : "none"])) as GrantMap;

/**
 * One cell of the access matrix, drawn in the product's glyphs: `.` nothing, `+` can view, `#` can manage. Click (or press
 * Enter or Space) to step through the three. The state is in the accessible name, so it never depends on the glyph.
 */
function AccessCell({ value, label, disabled, onChange }: { value: Cell; label: string; disabled: boolean; onChange: (next: Cell) => void }) {
  const text = value === "manage" ? "can change" : value === "view" ? "can view" : "no access";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(NEXT[value])}
      aria-label={`${label}: ${text}. Press to change.`}
      className={cn(
        "press grid h-8 w-full min-w-[44px] place-items-center rounded-md border font-mono text-base leading-none transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-default",
        value === "manage" && "border-white/25 bg-white/[0.08] text-zinc-50",
        value === "view" && "border-white/[0.1] bg-white/[0.03] text-zinc-300",
        value === "none" && "border-transparent text-zinc-700 hover:border-white/[0.1] hover:text-zinc-400"
      )}
    >
      <span aria-hidden="true">{value === "manage" ? "#" : value === "view" ? "+" : "."}</span>
    </button>
  );
}

export function TeamsClient({ workspace, canManage, currentUserId, initialMode, sites, teams, people }: Props) {
  const router = useRouter();
  const [mode, setMode] = React.useState<AccessMode>(initialMode);
  const [confirmMode, setConfirmMode] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [siteId, setSiteId] = React.useState(sites[0]?.id ?? "");
  // Edits to the matrix that are not saved yet: site -> team -> every feature for that team.
  const [draft, setDraft] = React.useState<Record<string, Record<string, GrantMap>>>({});
  const [newName, setNewName] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [presetGrants, setPresetGrants] = React.useState<Partial<Record<Feature, AccessLevel>> | null>(null);
  const [openTeam, setOpenTeam] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<TeamView | null>(null);
  const [viewAs, setViewAs] = React.useState<{ userId: string; result: Awaited<ReturnType<typeof loadEffective>> | null; loading: boolean }>({ userId: "", result: null, loading: false });

  const site = sites.find((s) => s.id === siteId);
  const siteDraft = draft[siteId] ?? {};
  const dirty = Object.keys(siteDraft).length > 0;
  const sitesWithDraft = new Set(Object.entries(draft).filter(([, v]) => Object.keys(v).length > 0).map(([id]) => id));

  const cellValue = (teamId: string, feature: Feature): Cell => (siteDraft[teamId] ?? toMap(site?.teams[teamId]))[feature];

  function setCell(teamId: string, feature: Feature, next: Cell) {
    setDraft((d) => ({ ...d, [siteId]: { ...(d[siteId] ?? {}), [teamId]: { ...(d[siteId]?.[teamId] ?? toMap(site?.teams[teamId])), [feature]: next } } }));
  }
  function setRow(teamId: string, grants: Partial<Record<Feature, AccessLevel>> | "none") {
    const map = Object.fromEntries(FEATURES.map((f) => [f, grants === "none" ? "none" : (grants[f] ?? "none")])) as GrantMap;
    setDraft((d) => ({ ...d, [siteId]: { ...(d[siteId] ?? {}), [teamId]: map } }));
  }

  async function run(key: string, task: () => Promise<boolean>) {
    setBusy(key);
    const ok = await task();
    setBusy(null);
    if (ok) router.refresh();
  }

  async function changeMode(next: AccessMode) {
    await run("mode", async () => {
      const result = await apiCall(`/api/v1/workspaces/${workspace.id}/access`, { method: "PUT", body: JSON.stringify({ mode: next }) });
      if (!result.ok) {
        toast.error("Could not change the access mode", result.message);
        return false;
      }
      setMode(next);
      toast.success(next === "restricted" ? "Access is now restricted to teams" : "Access is open again");
      return true;
    });
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    await run("create", async () => {
      const result = await apiCall<{ team: { id: string } }>(`/api/v1/workspaces/${workspace.id}/teams`, {
        method: "POST",
        body: JSON.stringify({ name: newName, ...(newDesc.trim() ? { description: newDesc } : {}) }),
      });
      if (!result.ok) {
        toast.error("Could not create the team", result.message);
        return false;
      }
      if (presetGrants && siteId) {
        // The preset fills the matrix for the site being shown. It is not saved until the admin reviews it.
        setRow(result.body.team.id, presetGrants);
        toast.success("Team created", "Review its access in the matrix below, then save.");
      } else {
        toast.success("Team created");
      }
      setNewName("");
      setNewDesc("");
      setPresetGrants(null);
      return true;
    });
  }

  async function saveAccess() {
    await run("save", async () => {
      const body = Object.fromEntries(Object.entries(siteDraft));
      const result = await apiCall(`/api/v1/workspaces/${workspace.id}/sites/${siteId}/access`, { method: "PUT", body: JSON.stringify({ teams: body }) });
      if (!result.ok) {
        toast.error("Could not save access", result.message);
        return false;
      }
      setDraft((d) => {
        const { [siteId]: _saved, ...rest } = d;
        return rest;
      });
      toast.success("Access saved", `Changes apply to ${site?.displayName || site?.domain} within seconds.`);
      return true;
    });
  }

  async function teamMember(team: TeamView, userId: string, action: "add" | "remove" | "lead") {
    await run(`${team.id}:${userId}`, async () => {
      const result =
        action === "remove"
          ? await apiCall(`/api/v1/workspaces/${workspace.id}/teams/${team.id}/members/${userId}`, { method: "DELETE" })
          : await apiCall(`/api/v1/workspaces/${workspace.id}/teams/${team.id}/members/${userId}`, { method: "PUT", body: JSON.stringify({ role: action === "lead" ? "lead" : "member" }) });
      if (!result.ok) toast.error("Could not update the team", result.message);
      return result.ok;
    });
  }

  async function deleteTeam(team: TeamView) {
    await run("delete", async () => {
      const result = await apiCall(`/api/v1/workspaces/${workspace.id}/teams/${team.id}`, { method: "DELETE" });
      if (!result.ok) {
        toast.error("Could not delete the team", result.message);
        return false;
      }
      toast.success(`Deleted ${team.name}`);
      setDeleting(null);
      return true;
    });
  }

  async function loadEffective(userId: string) {
    const result = await apiCall<{ role: string; restricted: boolean; features: { feature: Feature; level: AccessLevel | null; source: string; via: string[] }[] }>(
      `/api/v1/workspaces/${workspace.id}/access/effective?userId=${userId}&siteId=${siteId}`
    );
    return result;
  }

  React.useEffect(() => {
    if (!viewAs.userId || !siteId) return;
    let cancelled = false;
    setViewAs((v) => ({ ...v, loading: true }));
    void loadEffective(viewAs.userId).then((result) => {
      if (!cancelled) setViewAs((v) => ({ ...v, loading: false, result }));
    });
    return () => {
      cancelled = true;
    };
    // The explanation depends on the person and the site, and on a saved change to either (a refresh gives new props).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAs.userId, siteId, teams, sites]);

  const nonMembers = (team: TeamView) => people.filter((p) => !team.members.some((m) => m.id === p.id));

  return (
    <div className="w-full space-y-6">
      <PageHeader title="Teams & access" art="steps">
        Group people into teams, then choose for each website what each team can open. Owners and admins always see everything.
      </PageHeader>

      {/* ── Mode ──────────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle>Who sees what</CardTitle>
            <CardDescription>
              {mode === "open"
                ? "Open: members and viewers see everything their role allows. Teams below take effect once you restrict access."
                : "Restricted: members and viewers see only what their teams (or a personal grant) give them, per website."}
            </CardDescription>
          </div>
          <PillTabs
            kind="radio"
            label="Access mode"
            value={mode}
            onChange={(next) => {
              if (!canManage || next === mode) return;
              if (next === "restricted") setConfirmMode(true);
              else void changeMode("open");
            }}
            items={[
              { id: "open", label: "Open" },
              { id: "restricted", label: "Restricted" },
            ]}
          />
        </CardHeader>
        {mode === "restricted" && teams.length === 0 && (
          <Alert tone="warning" title="No teams yet">
            Until a team is created and given access, every member and viewer sees nothing. Create a team below, or switch back to Open.
          </Alert>
        )}
      </Card>

      {/* ── Teams ─────────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>{teams.length === 0 ? "Start from a preset, or name your own." : `${teams.length} ${teams.length === 1 ? "team" : "teams"}.`}</CardDescription>
        </CardHeader>

        {canManage && (
          <form onSubmit={createTeam} className="mb-5 space-y-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Team presets">
              {TEAM_PRESETS.map((p) => (
                <Tooltip key={p.name} content={`${p.description}. Fills the matrix for the website shown; nothing is granted until you save.`}>
                  <button
                    type="button"
                    onClick={() => {
                      setNewName(p.name);
                      setNewDesc(p.description);
                      setPresetGrants(p.grants);
                    }}
                    className={cn("press rounded-md border px-2.5 py-1 font-mono text-xs transition-colors", newName === p.name ? "border-white/30 bg-white/[0.08] text-zinc-50" : "border-border text-zinc-400 hover:border-white/20 hover:text-zinc-100")}
                  >
                    {p.name}
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Team name"
                required
                minLength={2}
                maxLength={48}
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setPresetGrants(null);
                }}
                placeholder="Team name"
                className="h-9 min-w-[180px] flex-1 rounded-lg border border-border bg-background px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              />
              <input
                aria-label="Description (optional)"
                maxLength={200}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What they work on (optional)"
                className="h-9 min-w-[220px] flex-[2] rounded-lg border border-border bg-background px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              />
              <Button type="submit" loading={busy === "create"} disabled={newName.trim().length < 2}>
                <Plus /> Create team
              </Button>
            </div>
          </form>
        )}

        {teams.length === 0 ? (
          <p className="font-mono text-xs text-zinc-500">No teams yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-lg border border-border">
            {teams.map((team) => {
              const open = openTeam === team.id;
              return (
                <li key={team.id}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button type="button" onClick={() => setOpenTeam(open ? null : team.id)} aria-expanded={open} className="press flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span aria-hidden="true" className="font-mono text-xs text-zinc-500">{open ? "[-]" : "[+]"}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-zinc-100">{team.name}</span>
                        {team.description && <span className="block truncate text-xs text-zinc-500">{team.description}</span>}
                      </span>
                    </button>
                    <Badge variant="outline">
                      {team.members.length} {team.members.length === 1 ? "person" : "people"}
                    </Badge>
                    {canManage && (
                      <button type="button" aria-label={`Delete ${team.name}`} onClick={() => setDeleting(team)} className="press grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-bad">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="space-y-3 border-t border-white/[0.06] bg-white/[0.015] px-4 py-3">
                      {team.members.length === 0 ? (
                        <p className="font-mono text-xs text-zinc-500">Nobody on this team yet.</p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {team.members.map((m) => (
                            <li key={m.id} className="flex items-center gap-1.5 rounded-md border border-border py-1 pl-2.5 pr-1 text-xs text-zinc-300">
                              {m.role === "lead" && <Crown className="size-3 text-warning" aria-label="Team lead" />}
                              <span>{m.name ?? m.email}</span>
                              {canManage && (
                                <>
                                  {m.role !== "lead" && (
                                    <button type="button" onClick={() => void teamMember(team, m.id, "lead")} className="press rounded px-1 text-[11px] text-zinc-500 hover:text-zinc-200">
                                      make lead
                                    </button>
                                  )}
                                  <button type="button" aria-label={`Remove ${m.name ?? m.email} from ${team.name}`} onClick={() => void teamMember(team, m.id, "remove")} className="press grid size-5 place-items-center rounded text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100">
                                    <X className="size-3" />
                                  </button>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {canManage && nonMembers(team).length > 0 && (
                        <div className="flex items-center gap-2">
                          <UserPlus className="size-4 text-zinc-500" aria-hidden="true" />
                          <SelectDropdown
                            ariaLabel={`Add someone to ${team.name}`}
                            value=""
                            placeholder="Add a person"
                            className="w-64"
                            onChange={(userId) => userId && void teamMember(team, String(userId), "add")}
                            options={nonMembers(team).map((p) => ({ value: p.id, label: `${p.name} (${p.role})` }))}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Matrix ────────────────────────────────────────────────────────────────────────────── */}
      {teams.length > 0 && site && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-end justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle>Access by website</CardTitle>
              <CardDescription>
                <span className="font-mono">.</span> nothing &nbsp; <span className="font-mono">+</span> can view &nbsp; <span className="font-mono">#</span> can change. A team can never do more than a person&apos;s role allows.
              </CardDescription>
            </div>
            {sites.length > 1 && (
              <PillTabs
                label="Website"
                value={siteId}
                onChange={setSiteId}
                items={sites.map((s) => ({ id: s.id, label: sitesWithDraft.has(s.id) ? `${s.displayName || s.domain} •` : s.displayName || s.domain }))}
              />
            )}
          </CardHeader>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th scope="col" className="w-40 border-b border-border pb-2 text-xs font-normal text-zinc-500">
                    <span className="sr-only">Team</span>
                  </th>
                  {FEATURES.map((f) => (
                    <th key={f} scope="col" className="border-b border-border px-1 pb-2 text-center align-bottom text-[11px] font-normal leading-4 text-zinc-500">
                      <Tooltip content={`${FEATURE_INFO[f].description}. Usually: ${FEATURE_INFO[f].teams}.`}>
                        <span className="cursor-help">{FEATURE_INFO[f].label}</span>
                      </Tooltip>
                    </th>
                  ))}
                  {canManage && <th scope="col" className="border-b border-border pb-2" />}
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.id}>
                    <th scope="row" className="border-b border-white/[0.05] py-1.5 pr-3 text-sm font-normal text-zinc-200">
                      {team.name}
                      {siteDraft[team.id] && <span className="ml-1.5 font-mono text-[10px] text-warning">unsaved</span>}
                    </th>
                    {FEATURES.map((f) => (
                      <td key={f} className="border-b border-white/[0.05] px-1 py-1.5">
                        <AccessCell value={cellValue(team.id, f)} label={`${team.name}, ${FEATURE_INFO[f].label}`} disabled={!canManage} onChange={(next) => setCell(team.id, f, next)} />
                      </td>
                    ))}
                    {canManage && (
                      <td className="whitespace-nowrap border-b border-white/[0.05] pl-2 text-right text-[11px]">
                        <button type="button" onClick={() => setRow(team.id, Object.fromEntries(FEATURES.map((f) => [f, "view"])) as Partial<Record<Feature, AccessLevel>>)} className="press px-1 text-zinc-500 hover:text-zinc-200">
                          all view
                        </button>
                        <button type="button" onClick={() => setRow(team.id, "none")} className="press px-1 text-zinc-500 hover:text-zinc-200">
                          clear
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canManage && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <p className="text-xs text-zinc-500">{dirty ? `Unsaved changes for ${site.displayName || site.domain}.` : "Saved."}</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={!dirty || busy === "save"} onClick={() => setDraft((d) => ({ ...d, [siteId]: {} }))}>
                  Discard
                </Button>
                <Button size="sm" disabled={!dirty} loading={busy === "save"} onClick={() => void saveAccess()}>
                  Save access
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── View as ───────────────────────────────────────────────────────────────────────────── */}
      {canManage && site && (
        <Card>
          <CardHeader>
            <CardTitle>Why can they see this?</CardTitle>
            <CardDescription>Pick a person to see what they can open on {site.displayName || site.domain}, and which role or team gives it.</CardDescription>
          </CardHeader>
          <SelectDropdown
            ariaLabel="Person to check"
            value={viewAs.userId}
            placeholder="Choose a person"
            className="mb-4 w-72"
            onChange={(userId) => setViewAs({ userId: String(userId), result: null, loading: true })}
            options={people.map((p) => ({ value: p.id, label: `${p.name}${p.id === currentUserId ? " (you)" : ""} · ${p.role}` }))}
          />
          {viewAs.userId && viewAs.result && !viewAs.result.ok && <Alert tone="danger">{viewAs.result.message}</Alert>}
          {viewAs.userId && viewAs.result?.ok && (
            <div>
              {!viewAs.result.body.restricted && (
                <p className="mb-3 text-xs text-zinc-500">Access is open, so their role ({viewAs.result.body.role}) decides, not their teams.</p>
              )}
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {viewAs.result.body.features.map((e) => (
                  <li key={e.feature} className="flex items-center justify-between gap-3 border-b border-white/[0.05] py-1.5 text-xs">
                    <span className="flex items-center gap-2 text-zinc-300">
                      <span aria-hidden="true" className={cn("w-3 text-center font-mono text-sm", e.level === "manage" ? "text-zinc-50" : e.level === "view" ? "text-zinc-300" : "text-zinc-700")}>
                        {e.level === "manage" ? "#" : e.level === "view" ? "+" : "."}
                      </span>
                      {FEATURE_INFO[e.feature].label}
                    </span>
                    <span className="truncate text-right text-zinc-500">
                      {e.level === null ? "No access" : `${e.level === "manage" ? "Can change" : "Can view"} · ${e.source === "role" ? `role: ${viewAs.result && viewAs.result.ok ? viewAs.result.body.role : ""}` : e.via.join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {viewAs.loading && !viewAs.result && <p className="font-mono text-xs text-zinc-500">Checking…</p>}
        </Card>
      )}

      <ConfirmDialog
        open={confirmMode}
        onClose={() => setConfirmMode(false)}
        title="Restrict access to teams?"
        description="Members and viewers will see only what their teams give them, website by website. Anyone on no team sees nothing. Owners and admins are not affected, and you can switch back at any time."
        confirmLabel="Restrict access"
        tone="primary"
        loading={busy === "mode"}
        onConfirm={async () => {
          await changeMode("restricted");
          setConfirmMode(false);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "team"}?`}
        description="The team and everything it was granted are removed. Its people stay in the workspace, with whatever their other teams give them."
        confirmLabel="Delete team"
        loading={busy === "delete"}
        onConfirm={() => deleting && void deleteTeam(deleting)}
      />
    </div>
  );
}
