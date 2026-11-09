"use client";

import { LogoMark } from "@/components/brand/logo-mark";
import { MatrixLoader } from "@/components/ui/matrix-loader";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Check, Crown, Eye, EyeOff, Lock, Users, type LucideIcon } from "lucide-react";
import { GlyphField } from "@trackme/landing";
import { Field, TextInput } from "@/components/ui/field";
import { StepPanel, DrawCheck, Notice } from "@/components/motion/primitives";
import { checkPassword } from "@/lib/password-meter";
import { PasswordMeter } from "@/components/auth/password-meter";

interface InviteInfo {
  email: string;
  role: string;
  workspaceName: string;
  workspaceSlug: string;
  inviterName: string | null;
  expiresAt: string;
  requiresSignup: boolean;
}

type Phase = "loading" | "preview" | "signup" | "accepting" | "success" | "error";

/** What each role can do, in the words the rest of the app uses. The server decides the real permissions. */
const ROLES: Record<string, { label: string; icon: LucideIcon; can: string[] }> = {
  admin: { label: "Admin", icon: Crown, can: ["See every report", "Edit goals, funnels and segments", "Manage sites and settings", "Invite and remove members"] },
  member: { label: "Member", icon: Users, can: ["See every report", "Edit goals, funnels and segments"] },
  viewer: { label: "Viewer", icon: Eye, can: ["See every report"] },
};

function daysLeft(iso: string): string {
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "Expires today";
  return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
}

const primaryButton =
  "press inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#ededed] px-5 text-sm font-medium text-[#141415] " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white disabled:pointer-events-none disabled:opacity-60";

export default function InviteAcceptPage() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [invite, setInvite] = React.useState<InviteInfo | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");

  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const [errorNonce, setErrorNonce] = React.useState(0);
  const [touched, setTouched] = React.useState(false);

  const go = (next: Phase, dir: 1 | -1 = 1) => {
    setDirection(dir);
    setPhase(next);
  };

  React.useEffect(() => {
    if (!token) {
      setErrorMsg("No invite token was provided. Check the link in your email.");
      go("error");
      return;
    }
    fetch(`/api/v1/invites/accept?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error || data.status === 410) {
          setErrorMsg(data.detail || data.message || "This invitation is invalid or has expired.");
          go("error");
          return;
        }
        setInvite(data);
        go("preview");
      })
      .catch(() => {
        setErrorMsg("The invitation could not be loaded. Try again.");
        go("error");
      });
  }, [token]);

  function succeed(slug: string) {
    go("success");
    // A full page load, not a client navigation, so the browser sends the session cookie that was just set.
    window.setTimeout(() => {
      window.location.href = `/${slug}/overview`;
    }, 1600);
  }

  async function handleAccept() {
    go("accepting");
    try {
      const res = await fetch("/api/v1/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json();
      // The invited address already has an account: sign in as it, then come back.
      if (res.status === 401 && data.requiresLogin) {
        window.location.href = `/login?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`;
        return;
      }
      if (res.status === 202 && data.requiresSignup) return go("signup");
      if (!res.ok) throw new Error(data.detail || data.error || data.message || "The invitation could not be accepted.");
      succeed(data.workspaceSlug);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      go("error");
    }
  }

  const report = checkPassword(password, { email: invite?.email ?? "", name });
  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    const problem = !name.trim() ? "Enter your name." : !report.acceptable ? "Choose a password that meets the checks below." : password !== confirm ? "The passwords do not match." : "";
    if (problem) {
      setFormError(problem);
      setErrorNonce((n) => n + 1);
      return;
    }
    setFormError("");
    go("accepting");
    try {
      const res = await fetch("/api/v1/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name: name.trim(), password }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || data.message || "The account could not be created.");
      succeed(data.workspaceSlug);
    } catch (err) {
      // Stay on the form so nothing typed is lost; the message says what to fix.
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
      setErrorNonce((n) => n + 1);
      go("signup", -1);
    }
  }

  const role = invite ? (ROLES[invite.role] ?? ROLES.member!) : null;

  return (
    <div className="grid min-h-screen bg-background text-zinc-100 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* The invitation, always in view: who, where, and what the role allows */}
      <aside className="relative hidden overflow-hidden border-r border-white/[0.08] bg-sidebar lg:flex lg:flex-col">
        <div className="relative z-10 flex flex-1 flex-col p-10">
          <Link href="/" className="flex items-center gap-2 text-base font-medium text-zinc-50" aria-label="TrackMe home">
            <LogoMark />
            TrackMe
          </Link>

          {invite && role && (
            <motion.div className="my-auto max-w-sm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
              <p className="font-mono text-xs text-zinc-500">{invite.inviterName ?? "A teammate"} invited you to</p>
              <h1 className="mt-3 text-[32px] font-medium leading-10 text-zinc-50">{invite.workspaceName}</h1>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-zinc-400">
                <role.icon className="size-4" aria-hidden="true" />
                as {role.label.toLowerCase() === "admin" ? "an" : "a"} {role.label.toLowerCase()}
              </p>
              <ul className="mt-8 flex flex-col gap-3">
                {role.can.map((item, i) => (
                  <motion.li key={item} className="flex items-center gap-3 text-sm text-zinc-300" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.06, duration: 0.3 }}>
                    <span className="grid size-5 place-items-center rounded-full border border-white/[0.14] text-zinc-300"><Check className="size-3" aria-hidden="true" /></span>
                    {item}
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-72" aria-hidden="true">
          <GlyphField variant="stream" cell={9} strength={0.6} />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#0f0f10] to-transparent" />
        </div>
      </aside>

      <main className="flex min-w-0 items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[420px]">
          <Link href="/" className="mb-10 flex items-center gap-2 text-base font-medium text-zinc-50 lg:hidden" aria-label="TrackMe home">
            <LogoMark />
            TrackMe
          </Link>

          <StepPanel stepKey={phase} direction={direction}>
            {phase === "loading" && (
              <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your invitation">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-8 w-64" />
                <div className="skeleton h-4 w-full" />
                <div className="skeleton mt-4 h-11 w-full" />
              </div>
            )}

            {phase === "preview" && invite && role && (
              <div>
                <p className="font-mono text-xs text-zinc-500">{daysLeft(invite.expiresAt)}</p>
                <h2 className="mt-3 text-[28px] font-medium leading-9 text-zinc-50">Join {invite.workspaceName}</h2>
                <p className="mt-2 text-sm leading-5 text-zinc-400">
                  {invite.inviterName ?? "A teammate"} invited <span className="text-zinc-200">{invite.email}</span> as {role.label.toLowerCase() === "admin" ? "an" : "a"} {role.label.toLowerCase()}.
                </p>
                <div className="mt-8 flex flex-col gap-3">
                  <button type="button" onClick={handleAccept} className={primaryButton}>
                    Accept invitation <ArrowRight className="size-4" />
                  </button>
                  <button type="button" onClick={() => router.push("/login")} className="press h-9 rounded-lg text-sm text-zinc-500 hover:text-zinc-200">
                    Not you? Use a different account
                  </button>
                </div>
              </div>
            )}

            {phase === "signup" && invite && role && (
              <form onSubmit={handleSignup} noValidate>
                <p className="font-mono text-xs text-zinc-500">One more step</p>
                <h2 className="mt-3 text-[28px] font-medium leading-9 text-zinc-50">Create your account</h2>
                <p className="mt-2 text-sm leading-5 text-zinc-400">You will join {invite.workspaceName} as {role.label.toLowerCase() === "admin" ? "an" : "a"} {role.label.toLowerCase()}.</p>

                <div className="mt-7 flex flex-col gap-5">
                  <Field label="Email" htmlFor="invite-email">
                    <div className="relative">
                      <TextInput id="invite-email" type="email" value={invite.email} readOnly className="cursor-not-allowed pr-10 text-zinc-400" />
                      <Lock className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" aria-hidden="true" />
                    </div>
                  </Field>

                  <Field label="Full name" htmlFor="invite-name" error={touched && !name.trim() ? "Enter your name." : null}>
                    <TextInput id="invite-name" autoFocus autoComplete="name" placeholder="Ada Lovelace" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !name.trim()} />
                  </Field>

                  <Field label="Password" htmlFor="invite-password">
                    <div className="relative">
                      <TextInput
                        id="invite-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="At least 12 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pr-10"
                        aria-describedby="password-meter"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="press absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-zinc-500 hover:text-zinc-200"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    <PasswordMeter report={report} />
                  </Field>

                  <Field label="Confirm password" htmlFor="invite-confirm" error={mismatch ? "The passwords do not match." : null}>
                    <TextInput
                      id="invite-confirm"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat the password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      aria-invalid={mismatch}
                    />
                  </Field>

                  {formError && (
                    <Notice nonce={errorNonce} className="rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-sm text-[#e5484d]">
                      {formError}
                    </Notice>
                  )}

                  <button type="submit" className={primaryButton}>
                    Create account and join <ArrowRight className="size-4" />
                  </button>
                  <p className="text-center text-xs leading-5 text-zinc-600">No tracking cookies. Your analytics stay private to your workspace.</p>
                </div>
              </form>
            )}

            {phase === "accepting" && (
              <div className="flex justify-center py-10">
                <MatrixLoader label="Setting up your access" />
              </div>
            )}

            {phase === "success" && (
              <div className="flex flex-col items-center py-6 text-center" role="status">
                <DrawCheck />
                <h2 className="mt-6 text-[28px] font-medium leading-9 text-zinc-50">You are in</h2>
                <p className="mt-2 text-sm text-zinc-400">Opening {invite?.workspaceName ?? "your workspace"}</p>
                <div className="mt-6 h-0.5 w-40 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
                  <motion.div className="h-full origin-left bg-zinc-200" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.6, ease: "linear" }} style={{ width: "100%" }} />
                </div>
              </div>
            )}

            {phase === "error" && (
              <div className="flex flex-col items-center py-6 text-center">
                <DrawCheck tone="bad" />
                <h2 className="mt-6 text-[28px] font-medium leading-9 text-zinc-50">This invitation cannot be used</h2>
                <p className="mt-2 max-w-sm text-sm leading-5 text-zinc-400" role="alert">{errorMsg}</p>
                <div className="mt-8 flex w-full flex-col gap-3">
                  <button type="button" onClick={() => router.push("/login")} className={primaryButton}>Go to sign in</button>
                  <p className="text-xs text-zinc-500">Ask the person who invited you to send a new link.</p>
                </div>
              </div>
            )}
          </StepPanel>
        </div>
      </main>
    </div>
  );
}
