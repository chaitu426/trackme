"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ShieldCheck, ArrowRight, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpVerificationModal } from "@/components/auth/otp-input";

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Email OTP verification state
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [signupEmail, setSignupEmail] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>(undefined);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const name = String(form.get("name") || "").trim();
    const password = String(form.get("password") || "");

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const payload = await response.json();
      setPending(false);

      if (!response.ok) {
        setError(payload.detail || payload.message || "Unable to create account.");
        return;
      }

      // Transition smoothly in-app to email OTP verification
      setSignupEmail(email);
      setDevCode(payload.devCode);
      setVerifyingEmail(true);
    } catch {
      setPending(false);
      setError("An unexpected error occurred. Please try again.");
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
            "radial-gradient(ellipse 600px 500px at 50% 30%, rgba(16,185,129,0.05) 0%, rgba(99,102,241,0.03) 50%, transparent 70%)",
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
          href="/login"
          className="inline-flex items-center space-x-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition"
        >
          <span>Sign in</span>
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
        </Link>
      </header>

      {/* Signup Card */}
      <main className="relative z-10 w-full max-w-[440px] my-auto">
        <div className="bg-zinc-950/80 border border-white/[0.08] rounded-2xl p-7 sm:p-8 shadow-2xl backdrop-blur-xl">
          {verifyingEmail ? (
            <OtpVerificationModal
              email={signupEmail}
              purpose="signup_verify"
              devCode={devCode}
              onCancel={() => setVerifyingEmail(false)}
              onSuccess={(data) => {
                router.push(data.redirectTo || "/onboarding");
              }}
            />
          ) : (
            <>
              {/* Title */}
              <div className="text-center mb-6">
                <h1 className="text-xl font-bold tracking-tight text-zinc-100">Create your workspace</h1>
                <p className="text-xs text-zinc-400 mt-1.5">
                  Privacy-first analytics, deployed in minutes. We will verify your email with a secure code.
                </p>
              </div>

              {/* Form */}
              <form className="space-y-4" onSubmit={onSubmit}>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Full Name</label>
                  <div className="relative">
                    <input
                      name="name"
                      type="text"
                      required
                      autoComplete="name"
                      placeholder="Jane Doe"
                      className="w-full rounded-xl border border-white/[0.08] bg-zinc-900/60 pl-9 pr-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 focus:bg-zinc-900/90 focus:ring-1 focus:ring-zinc-400/20 transition"
                    />
                    <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Work Email</label>
                  <div className="relative">
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="jane@company.com"
                      className="w-full rounded-xl border border-white/[0.08] bg-zinc-900/60 pl-9 pr-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 focus:bg-zinc-900/90 focus:ring-1 focus:ring-zinc-400/20 transition"
                    />
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="Min 8 chars with number or symbol"
                      className="w-full rounded-xl border border-white/[0.08] bg-zinc-900/60 pl-9 pr-10 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 focus:bg-zinc-900/90 focus:ring-1 focus:ring-zinc-400/20 transition"
                    />
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 focus:outline-none"
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full h-10 text-xs font-semibold" disabled={pending}>
                  {pending ? "Creating account & sending code…" : "Create Account & Verify Email →"}
                </Button>
              </form>

              {/* Privacy guarantee */}
              <div className="mt-5 pt-4 border-t border-white/[0.06]">
                <div className="flex items-center justify-center space-x-1.5 text-[11px] text-zinc-500 mb-3">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Zero cookies · Cryptographic authentication · 100% GDPR</span>
                </div>
                <p className="text-center text-xs text-zinc-400">
                  Already have an account?{" "}
                  <Link href="/login" className="font-semibold text-zinc-200 hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-5xl text-center text-xs text-zinc-500 py-3">
        <div className="flex items-center justify-center space-x-4">
          <Link href="/legal/privacy" className="hover:text-zinc-300 transition">
            Privacy Policy
          </Link>
          <span>·</span>
          <Link href="/legal/dpa" className="hover:text-zinc-300 transition">
            Data Processing
          </Link>
          <span>·</span>
          <Link href="/legal/subprocessors" className="hover:text-zinc-300 transition">
            Subprocessors
          </Link>
        </div>
      </footer>
    </div>
  );
}
