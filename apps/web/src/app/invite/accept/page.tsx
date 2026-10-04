"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  Users,
  Eye,
  Crown,
  ArrowRight,
  Lock,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InviteInfo {
  email: string;
  role: string;
  workspaceName: string;
  workspaceSlug: string;
  inviterName: string | null;
  expiresAt: string;
  requiresSignup: boolean;
}

// ─── Role display helpers ─────────────────────────────────────────────────────

const ROLE_META: Record<string, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  admin: {
    label: "Admin",
    icon: <Crown className="w-4 h-4" />,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    description: "Full control — manage members, sites, and settings.",
  },
  member: {
    label: "Member",
    icon: <Users className="w-4 h-4" />,
    color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
    description: "Read and edit analytics, funnels, and goals.",
  },
  viewer: {
    label: "Viewer",
    icon: <Eye className="w-4 h-4" />,
    color: "text-sky-400 bg-sky-500/10 border-sky-500/30",
    description: "Read-only access to analytics dashboards.",
  },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InviteAcceptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [state, setState] = React.useState<
    "loading" | "preview" | "signup-form" | "accepting" | "success" | "error"
  >("loading");

  const [invite, setInvite] = React.useState<InviteInfo | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");

  // Signup form state (for new users)
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [formError, setFormError] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  // ── Fetch invite preview on mount ─────────────────────────────────────────
  React.useEffect(() => {
    if (!token) {
      setState("error");
      setErrorMsg("No invite token provided. Please check the link in your email.");
      return;
    }

    fetch(`/api/v1/invites/accept?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error || data.status === 410) {
          setState("error");
          setErrorMsg(data.detail || data.message || "This invitation is invalid or has expired.");
          return;
        }
        setInvite(data);
        // Existing users go straight to accept preview; new users get signup form
        setState("preview");
      })
      .catch(() => {
        setState("error");
        setErrorMsg("Failed to load invitation. Please try again.");
      });
  }, [token]);

  // ── Accept invite (existing user) ─────────────────────────────────────────
  async function handleAccept() {
    setState("accepting");
    try {
      const res = await fetch("/api/v1/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();

      // 202 = new user who needs to fill signup form first
      if (res.status === 202 && data.requiresSignup) {
        setState("signup-form");
        return;
      }

      if (!res.ok) {
        throw new Error(data.detail || data.error || data.message || "Failed to accept invitation.");
      }

      setState("success");
      // Use full page reload (not router.push) so the browser sends the
      // freshly-set session cookie on the next server-component request.
      setTimeout(() => {
        window.location.href = `/${data.workspaceSlug}/overview`;
      }, 1500);
    } catch (err: unknown) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // ── Accept invite (new user signup) ───────────────────────────────────────
  async function handleSignupAndAccept(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!name.trim()) {
      setFormError("Please enter your name.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setState("accepting");
    try {
      const res = await fetch("/api/v1/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.error || data.message || "Failed to create account.");
      }

      setState("success");
      // Full page reload so the browser commits the session cookie before
      // hitting the server component that calls requireUser().
      setTimeout(() => {
        window.location.href = `/${data.workspaceSlug}/overview`;
      }, 1500);
    } catch (err: unknown) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const roleMeta = invite ? (ROLE_META[invite.role] ?? ROLE_META.member) : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b] px-4 py-16">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-600/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">

        {/* ── Loading ────────────────────────────────────────────────────── */}
        {state === "loading" && (
          <div className="flex flex-col items-center gap-4 text-zinc-400">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <p className="text-sm">Loading your invitation…</p>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {state === "error" && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center">
                <XCircle className="w-7 h-7 text-rose-400" />
              </div>
            </div>
            <h1 className="text-xl font-bold text-zinc-100">Invitation not valid</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => router.push("/login")}
              className="text-sm text-indigo-400 hover:text-indigo-300 transition underline underline-offset-2"
            >
              Go to login
            </button>
          </div>
        )}

        {/* ── Success ───────────────────────────────────────────────────── */}
        {state === "success" && invite && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
            </div>
            <h1 className="text-xl font-bold text-zinc-100">You're in!</h1>
            <p className="text-sm text-zinc-400">
              Welcome to <span className="text-zinc-200 font-semibold">{invite.workspaceName}</span>.
              Taking you to the dashboard…
            </p>
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto" />
          </div>
        )}

        {/* ── Accepting (loading) ───────────────────────────────────────── */}
        {state === "accepting" && (
          <div className="flex flex-col items-center gap-4 text-zinc-400">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <p className="text-sm">Setting up your access…</p>
          </div>
        )}

        {/* ── Preview (existing user or new user before form) ───────────── */}
        {(state === "preview") && invite && roleMeta && (
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-br from-indigo-950/60 to-zinc-950 px-6 pt-8 pb-6 text-center border-b border-white/[0.06]">
              {/* Inviter avatar */}
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xl font-bold text-white mx-auto mb-4 shadow-lg shadow-indigo-900/40">
                {(invite.inviterName ?? "T").slice(0, 1).toUpperCase()}
              </div>
              <div className="text-xs text-zinc-500 mb-1">Invitation from</div>
              <div className="text-sm font-semibold text-zinc-200">
                {invite.inviterName ?? "A teammate"}
              </div>
            </div>

            <div className="px-6 py-6 space-y-5">
              {/* Workspace card */}
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/60 p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs text-zinc-500 mb-0.5">Joining workspace</div>
                  <div className="text-base font-bold text-zinc-100">{invite.workspaceName}</div>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${roleMeta.color}`}>
                  {roleMeta.icon}
                  {roleMeta.label}
                </span>
              </div>

              {/* Role description */}
              <div className="flex items-start gap-2.5 bg-white/[0.02] border border-white/[0.05] rounded-xl px-4 py-3">
                <Shield className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                <p className="text-xs text-zinc-400 leading-relaxed">{roleMeta.description}</p>
              </div>

              {/* Email notice */}
              <p className="text-xs text-zinc-500 text-center">
                Accepting as <span className="text-zinc-300 font-medium">{invite.email}</span>
              </p>

              {/* CTA */}
              <button
                onClick={handleAccept}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition text-sm"
              >
                Accept Invitation
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => router.push("/login")}
                className="w-full text-xs text-zinc-500 hover:text-zinc-300 transition"
              >
                Not you? Sign in with a different account
              </button>
            </div>
          </div>
        )}

        {/* ── Signup Form (new users) ───────────────────────────────────── */}
        {state === "signup-form" && invite && roleMeta && (
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-br from-indigo-950/60 to-zinc-950 px-6 pt-8 pb-6 border-b border-white/[0.06]">
              <div className="flex items-center justify-between mb-1">
                <h1 className="text-lg font-bold text-zinc-100">Create your account</h1>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${roleMeta.color}`}>
                  {roleMeta.icon}
                  {roleMeta.label}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Joining <span className="text-zinc-200 font-medium">{invite.workspaceName}</span> — invited by{" "}
                <span className="text-zinc-200">{invite.inviterName ?? "a teammate"}</span>.
              </p>
            </div>

            <form onSubmit={handleSignupAndAccept} className="px-6 py-6 space-y-4">
              {/* Email (pre-filled, locked) */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
                <div className="relative">
                  <input
                    type="email"
                    value={invite.email}
                    readOnly
                    className="w-full rounded-xl border border-white/[0.06] bg-zinc-900/40 px-3.5 py-2.5 text-sm text-zinc-400 pr-10 cursor-not-allowed"
                  />
                  <Lock className="w-3.5 h-3.5 text-zinc-600 absolute right-3 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Full name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none transition"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none transition pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    tabIndex={-1}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Confirm password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none transition"
                />
              </div>

              {formError && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition text-sm mt-1"
              >
                Create account & join workspace
                <ArrowRight className="w-4 h-4" />
              </button>

              <p className="text-[11px] text-zinc-600 text-center leading-relaxed">
                By accepting, you agree to our Terms of Service and Privacy Policy.
                Your analytics are protected under zero-cookie, privacy-first principles.
              </p>
            </form>
          </div>
        )}

        {/* Logo footer */}
        {state !== "success" && state !== "accepting" && (
          <div className="flex items-center justify-center gap-2 mt-8 text-zinc-600 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/60" />
            <span>TrackMe · Privacy-first analytics</span>
          </div>
        )}
      </div>
    </div>
  );
}
