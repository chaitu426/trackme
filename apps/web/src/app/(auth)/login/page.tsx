"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, Lock, Mail } from "lucide-react";
import { AuthShell, AuthTitle, Field, FormError, authPrimary } from "@/components/auth/auth-ui";
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

  const tab = (active: boolean) =>
    `inline-flex h-full flex-1 items-center justify-center rounded-md px-3 text-sm transition-colors duration-150 ${
      active ? "bg-raised font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-zinc-400 hover:text-zinc-100"
    }`;

  return (
    <AuthShell alt={{ href: "/signup", label: "Create workspace" }}>
      {otpMode ? (
        <OtpVerificationModal
          email={otpEmail}
          purpose="login_otp"
          devCode={devCode}
          rememberMe={rememberMe}
          onCancel={() => setOtpMode(false)}
          onSuccess={(data) => {
            const nextPath = safeNextPath(new URLSearchParams(window.location.search).get("next"));
            router.push(nextPath ?? (data as { redirectTo?: string }).redirectTo ?? "/onboarding");
          }}
        />
      ) : (
        <>
          <AuthTitle title="Sign in">Use your password, or get a one-time code by email.</AuthTitle>

          <div role="tablist" aria-label="Sign in method" className="mb-6 flex h-10 items-center gap-0.5 rounded-lg border border-white/[0.1] p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "password"}
              onClick={() => {
                setAuthMode("password");
                setError(null);
              }}
              className={tab(authMode === "password")}
            >
              Password
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "email_code"}
              onClick={() => {
                setAuthMode("email_code");
                setError(null);
              }}
              className={tab(authMode === "email_code")}
            >
              Email code
            </button>
          </div>

          {authMode === "password" ? (
            <form className="space-y-5" onSubmit={onPasswordSubmit}>
              <Field id="login-email" label="Email" icon={Mail} name="email" type="email" required autoComplete="email" placeholder="name@company.com" />
              <Field
                id="login-password"
                label="Password"
                icon={Lock}
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="Your password"
                aside={
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("email_code");
                      setError(null);
                    }}
                    className="text-xs text-zinc-400 transition-colors duration-150 hover:text-zinc-100"
                  >
                    Forgot? Use an email code
                  </button>
                }
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
              />

              <label className="flex cursor-pointer select-none items-center gap-3 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-white/[0.2] bg-card accent-zinc-200"
                />
                Keep me signed in for 30 days
              </label>

              {error && <FormError>{error}</FormError>}

              <button type="submit" className={authPrimary} disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={onEmailCodeSubmit}>
              <Field
                id="login-code-email"
                label="Email"
                icon={Mail}
                type="email"
                required
                value={emailCodeInput}
                onChange={(e) => setEmailCodeInput(e.target.value)}
                autoComplete="email"
                placeholder="name@company.com"
                hint="We send a 6-digit code. No password needed."
              />

              {error && <FormError>{error}</FormError>}

              <button type="submit" className={authPrimary} disabled={pending || !emailCodeInput.trim()}>
                <KeyRound className="h-4 w-4" />
                {pending ? "Sending code…" : "Send code"}
              </button>
            </form>
          )}

          <p className="mt-8 text-sm text-zinc-400">
            No workspace yet?{" "}
            <Link href="/signup" className="text-zinc-100 underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white">
              Create one
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
