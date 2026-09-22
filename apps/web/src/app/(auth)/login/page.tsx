"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ShieldCheck, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    const payload = (await response.json()) as { detail?: string; redirectTo?: string };
    setPending(false);

    if (!response.ok) {
      setError(payload.detail ?? "Unable to sign in");
      return;
    }

    const nextPath = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    router.push(nextPath ?? payload.redirectTo ?? "/onboarding");
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
          <div className="h-8 w-8 rounded-xl bg-zinc-900 flex items-center justify-center shadow-xs">
            <Activity className="w-4 h-4 text-zinc-100" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-base tracking-tight text-zinc-900">TrackMe</span>
        </div>
        <Link
          href="/signup"
          className="inline-flex items-center space-x-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 transition"
        >
          <span>Create account</span>
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
        </Link>
      </header>

      {/* Auth Card */}
      <main className="relative z-10 w-full max-w-[420px] my-auto">
        <div className="bg-white border border-zinc-200/90 rounded-2xl p-7 sm:p-8 shadow-card">

          {/* Title */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">Welcome back</h1>
            <p className="text-xs text-zinc-500 mt-1.5">
              Sign in to your cookieless analytics dashboard.
            </p>
          </div>

          {/* Form */}
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Work Email
              </label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="name@company.com"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-2.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:bg-white transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-zinc-700">Password</label>
                <span className="text-[11px] text-zinc-400 cursor-pointer hover:text-zinc-600 transition">
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
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-2.5 pr-10 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:bg-white transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-700 transition"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" strokeWidth={1.75} />
                  ) : (
                    <Eye className="w-4 h-4" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign In"}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center my-5">
            <div className="flex-1 border-t border-zinc-100" />
            <span className="px-3 text-[11px] text-zinc-400 font-mono">or</span>
            <div className="flex-1 border-t border-zinc-100" />
          </div>

          <p className="text-center text-xs text-zinc-500">
            No account?{" "}
            <Link href="/signup" className="font-semibold text-zinc-900 hover:underline">
              Create workspace
            </Link>
          </p>

          {/* Privacy trust strip */}
          <div className="mt-5 pt-4 border-t border-zinc-100 flex items-center justify-center space-x-2 text-[11px] text-zinc-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" strokeWidth={2} />
            <span>Zero cookies · Zero cross-site tracking · 100% GDPR</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-5xl text-center text-xs text-zinc-400 py-3">
        TrackMe Analytics ·{" "}
        <Link href="/legal/terms" className="hover:text-zinc-700 transition">Terms</Link>{" "}
        ·{" "}
        <Link href="/legal/privacy" className="hover:text-zinc-700 transition">Privacy</Link>
      </footer>
    </div>
  );
}
