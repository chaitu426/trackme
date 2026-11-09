"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, Lock, Mail } from "lucide-react";
import { AuthShell, AuthTitle, Field, FormError } from "@/components/auth/auth-ui";
import { OtpVerificationModal } from "@/components/auth/otp-input";
import { safeNextPath } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import { PillTabs, StepPanel } from "@/components/motion/primitives";


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
  const [challenge, setChallenge] = useState<string | undefined>(undefined);

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
        setChallenge(payload.challenge);
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
    <AuthShell alt={{ href: "/signup", label: "Create workspace" }}>
      <StepPanel stepKey={otpMode ? "otp" : "form"} direction={otpMode ? 1 : -1}>
      {otpMode ? (
        <OtpVerificationModal
          email={otpEmail}
          purpose="login_otp"
          devCode={devCode}
          rememberMe={rememberMe}
          challenge={challenge}
          onCancel={() => { setOtpMode(false); setChallenge(undefined); }}
          onSuccess={(data) => {
            const nextPath = safeNextPath(new URLSearchParams(window.location.search).get("next"));
            router.push(nextPath ?? (data as { redirectTo?: string }).redirectTo ?? "/onboarding");
          }}
        />
      ) : (
        <>
          <AuthTitle title="Sign in">Use your password, or get a one-time code by email.</AuthTitle>

          <PillTabs
            kind="tabs"
            label="Sign in method"
            value={authMode}
            onChange={(mode) => {
              setAuthMode(mode);
              setError(null);
            }}
            className="mb-6 h-10 w-full"
            itemClassName="h-full flex-1"
            items={[
              { id: "password", label: "Password" },
              { id: "email_code", label: "Email code" },
            ]}
          />

          <StepPanel stepKey={authMode} direction={authMode === "password" ? -1 : 1}>
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
                    className="press text-xs text-zinc-400 hover:text-zinc-100"
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
                    className="press grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
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

              <Button type="submit" className="h-10 w-full" loading={pending}>
                {pending ? "Signing in" : "Sign in"}
              </Button>
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

              <Button type="submit" className="h-10 w-full" loading={pending} disabled={!emailCodeInput.trim()}>
                {!pending && <KeyRound />}
                {pending ? "Sending code" : "Send code"}
              </Button>
            </form>
          )}
          </StepPanel>

          <p className="mt-8 text-sm text-zinc-400">
            No workspace yet?{" "}
            <Link href="/signup" className="text-zinc-100 underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white">
              Create one
            </Link>
          </p>
        </>
      )}
      </StepPanel>
    </AuthShell>
  );
}
