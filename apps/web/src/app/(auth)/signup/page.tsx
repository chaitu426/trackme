"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { AuthShell, AuthTitle, Field, FormError, authPrimary } from "@/components/auth/auth-ui";
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
    <AuthShell alt={{ href: "/login", label: "Sign in" }}>
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
          <AuthTitle title="Create your workspace">We email a one-time code to confirm your address.</AuthTitle>

          <form className="space-y-5" onSubmit={onSubmit}>
            <Field id="signup-name" label="Full name" icon={User} name="name" type="text" required autoComplete="name" placeholder="Jane Doe" />
            <Field id="signup-email" label="Work email" icon={Mail} name="email" type="email" required autoComplete="email" placeholder="jane@company.com" />
            <Field
              id="signup-password"
              label="Password"
              icon={Lock}
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              hint="Use a number or a symbol as well."
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

            {error && <FormError>{error}</FormError>}

            <button type="submit" className={authPrimary} disabled={pending}>
              {pending ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="mt-8 text-sm text-zinc-400">
            Already have an account?{" "}
            <Link href="/login" className="text-zinc-100 underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white">
              Sign in
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
