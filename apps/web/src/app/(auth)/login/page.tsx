"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ShieldCheck, ArrowRight, Eye, EyeOff, Lock, Mail, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpVerificationModal } from "@/components/auth/otp-input";

function safeNextPath(candidate: string | null): string | null {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return null;
  }
  return candidate;
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Auth mode: "password" or "email_code" (both 100% in-app, zero browser prompts)
  const [authMode, setAuthMode] = useState<"password" | "email_code">("password");

  // OTP verification step
  const [otpMode, setOtpMode] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>(undefined);

  // State for email code request
  const [emailCodeInput, setEmailCodeInput] = useState("");

  // Submit Password Form
  async function onPasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          rememberMe,
        }),
      });

      const payload = await response.json();
      setPending(false);

      if (!response.ok) {
        setError(payload.detail || payload.message || "Invalid credentials.");
        return;
      }

      // If user account has 2FA enabled
      if (payload.requiresOtp) {
        setOtpEmail(payload.email || email);
        setDevCode(payload.devCode);
        setOtpMode(true);
        return;
      }

      const nextPath = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      router.push(nextPath ?? payload.redirectTo ?? "/onboarding");
    } catch {
      setPending(false);
      setError("An unexpected error occurred. Please check your connection.");
    }
  }

  // Submit Email Code Request (In-App Form)
  async function onEmailCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailCodeInput.trim()) return;

    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailCodeInput.trim(),
          purpose: "login_otp",
        }),
      });

      const payload = await response.json();
      setPending(false);

      if (!response.ok) {
        setError(payload.detail || payload.message || "Unable to send login passcode.");
        return;
      }

      setOtpEmail(emailCodeInput.trim());
      setDevCode(payload.devCode);
      setOtpMode(true);
    } catch {
      setPending(false);
      setError("Failed to dispatch one-time passcode.");
    }
  }

  return (
    <div className="min-h-screen bg-background relative flex flex-col items-center justify-between p-6 antialiased">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 600px 500px at 50% 30%, rgba(99,102,241,0.06) 0%, rgba(244,114,182,0.03) 40%, transparent 70%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 w-full max-w-5xl flex items-center justify-between py-2">
        <div className="flex items-center space-x-2.5">
          <div className="h-8 w-8 rounded-xl bg-zinc-900 border border-white/[0.08] flex items-center justify-center shadow-xs">
            <Activity className="w-4 h-4 text-zinc-100" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-base tracking-tight text-zinc-100">TrackMe</span>
        </div>
        <Link
          href="/signup"
          className="inline-flex items-center space-x-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition"
        >
          <span>Create workspace</span>
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
        </Link>
      </header>

      {/* Auth Card */}
      <main className="relative z-10 w-full max-w-[430px] my-auto">
        <div className="bg-zinc-950/80 border border-white/[0.08] rounded-2xl p-7 sm:p-8 shadow-2xl backdrop-blur-xl">
          {otpMode ? (
            <OtpVerificationModal
              email={otpEmail}
              purpose="login_otp"
              devCode={devCode}
              rememberMe={rememberMe}
              onCancel={() => setOtpMode(false)}
              onSuccess={(data) => {
                const nextPath = safeNextPath(
                  new URLSearchParams(window.location.search).get("next")
                );
                router.push(nextPath ?? (data as { redirectTo?: string }).redirectTo ?? "/onboarding");
              }}
            />
          ) : (
            <>
              {/* Title */}
              <div className="text-center mb-6">
                <h1 className="text-xl font-bold tracking-tight text-zinc-100">Welcome back</h1>
                <p className="text-xs text-zinc-400 mt-1.5">
                  Sign in to your privacy-first analytics workspace.
                </p>
              </div>

              {/* Mode Switcher Tabs */}
              <div className="grid grid-cols-2 p-1 bg-white/[0.04] border border-white/[0.06] rounded-xl mb-5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("password");
                    setError(null);
                  }}
                  className={`py-1.5 rounded-lg transition ${
                    authMode === "password"
                      ? "bg-zinc-800 text-zinc-100 shadow-xs font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Password
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("email_code");
                    setError(null);
                  }}
                  className={`py-1.5 rounded-lg transition ${
                    authMode === "email_code"
                      ? "bg-zinc-800 text-zinc-100 shadow-xs font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Email Code (OTP)
                </button>
              </div>

              {/* PASSWORD FORM */}
              {authMode === "password" ? (
                <form className="space-y-4" onSubmit={onPasswordSubmit}>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Work Email
                    </label>
                    <div className="relative">
                      <input
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="name@company.com"
                        className="w-full rounded-xl border border-white/[0.08] bg-zinc-900/60 pl-9 pr-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 focus:bg-zinc-900/90 focus:ring-1 focus:ring-zinc-400/20 transition"
                      />
                      <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-zinc-300">Password</label>
                      <span className="text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition">
                        Forgot password?
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        name="password"
                        type={showPassword ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        placeholder="••••••••••••"
                        className="w-full rounded-xl border border-white/[0.08] bg-zinc-900/60 pl-9 pr-10 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 focus:bg-zinc-900/90 focus:ring-1 focus:ring-zinc-400/20 transition"
                      />
                      <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 transition"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" strokeWidth={1.75} />
                        ) : (
                          <Eye className="w-4 h-4" strokeWidth={1.75} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Remember Me */}
                  <div className="flex items-center justify-between pt-0.5">
                    <label className="flex items-center space-x-2 text-xs text-zinc-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500 h-3.5 w-3.5"
                      />
                      <span>Remember this session (30 days)</span>
                    </label>
                  </div>

                  {error && (
                    <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                      {error}
                    </p>
                  )}

                  <Button type="submit" className="w-full h-10 text-xs font-semibold" disabled={pending}>
                    {pending ? "Authenticating…" : "Sign In with Password"}
                  </Button>
                </form>
              ) : (
                /* IN-APP EMAIL CODE FORM */
                <form className="space-y-4" onSubmit={onEmailCodeSubmit}>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Account Email
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        required
                        value={emailCodeInput}
                        onChange={(e) => setEmailCodeInput(e.target.value)}
                        placeholder="name@company.com"
                        className="w-full rounded-xl border border-white/[0.08] bg-zinc-900/60 pl-9 pr-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 focus:bg-zinc-900/90 focus:ring-1 focus:ring-zinc-400/20 transition"
                      />
                      <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      We’ll send a 6-digit one-time code to sign in securely without typing your password.
                    </p>
                  </div>

                  {error && (
                    <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                      {error}
                    </p>
                  )}

                  <Button type="submit" className="w-full h-10 text-xs font-semibold gap-2" disabled={pending || !emailCodeInput.trim()}>
                    <KeyRound className="w-3.5 h-3.5" />
                    {pending ? "Sending passcode…" : "Send One-Time Code →"}
                  </Button>
                </form>
              )}

              <p className="text-center text-xs text-zinc-400 mt-5">
                No workspace yet?{" "}
                <Link href="/signup" className="font-semibold text-zinc-200 hover:underline">
                  Create workspace
                </Link>
              </p>

              {/* Privacy trust strip */}
              <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center justify-center space-x-2 text-[11px] text-zinc-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                <span>Zero cookies · Cryptographic sessions · 100% GDPR</span>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-5xl text-center text-xs text-zinc-500 py-3">
        TrackMe Analytics ·{" "}
        <Link href="/legal/terms" className="hover:text-zinc-300 transition">Terms</Link>{" "}
        ·{" "}
        <Link href="/legal/privacy" className="hover:text-zinc-300 transition">Privacy</Link>
      </footer>
    </div>
  );
}
