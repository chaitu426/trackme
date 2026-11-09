"use client";

import { MatrixSpinner } from "@/components/ui/matrix-loader";
import React, { useRef, useState, useEffect } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";

interface OtpInputProps {
  email: string;
  purpose: "login_otp" | "signup_verify";
  onSuccess: (data: { redirectTo?: string; user?: unknown }) => void;
  onCancel?: () => void;
  devCode?: string | undefined;
  rememberMe?: boolean | undefined;
  /** From /auth/login when the account needs its password first; sent back so the code can complete that sign-in. */
  challenge?: string | undefined;
}

export function OtpVerificationModal({
  email,
  purpose,
  onSuccess,
  onCancel,
  devCode: initialDevCode,
  rememberMe = false,
  challenge,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [isResending, setIsResending] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>(initialDevCode);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Focus first input box on mount
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Handle single digit input
  function handleChange(index: number, value: string) {
    const char = value.slice(-1);
    if (!/^\d*$/.test(char)) return;

    const next = [...digits];
    next[index] = char;
    setDigits(next);
    setError(null);

    if (char && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto submit if all 6 digits are entered
    if (char && index === 5 && next.every((d) => d.length === 1)) {
      submitCode(next.join(""));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;

    const next = [...digits];
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || "";
    }
    setDigits(next);

    const targetIdx = Math.min(pasted.length, 5);
    inputRefs.current[targetIdx]?.focus();

    if (pasted.length === 6) {
      submitCode(pasted);
    }
  }

  async function submitCode(codeToVerify?: string) {
    const code = codeToVerify || digits.join("");
    if (code.length !== 6) {
      setError("Please enter the complete 6-digit code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code,
          purpose,
          rememberMe,
          ...(challenge ? { challenge } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Invalid verification code.");
      }

      onSuccess(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed.";
      setError(msg);
      // Reset digits on error
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || isResending) return;
    if (challenge) {
      // The code is tied to the password step; a new one needs a new password sign-in.
      setError("Go back and sign in again to get a new code.");
      return;
    }
    setIsResending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to resend code.");
      }

      setResendCooldown(60);
      if (data.devCode) {
        setDevCode(data.devCode);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resend code.";
      setError(msg);
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[28px] font-medium leading-9 tracking-[-0.02em] text-zinc-50">Check your email</h2>
        <p className="mt-2 text-sm leading-5 text-zinc-400">
          We sent a 6-digit code to <span className="text-zinc-100">{email}</span>. Enter it below.
        </p>
      </div>

      {/* Shown only outside production: the API never returns the code there. */}
      {devCode && (
        <div className="rounded-lg border border-white/[0.1] bg-card px-3 py-2">
          <p className="font-mono text-xs text-zinc-400">
            Development code: <span className="text-zinc-100">{devCode}</span>
          </p>
        </div>
      )}

      {/* 6 Digit Inputs */}
      <div className="flex gap-2" onPaste={handlePaste} role="group" aria-label="One-time code">
        {digits.map((digit, idx) => (
          <input
            key={idx}
            ref={(el) => {
              inputRefs.current[idx] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            aria-label={`Digit ${idx + 1}`}
            autoComplete={idx === 0 ? "one-time-code" : "off"}
            onChange={(e) => handleChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            disabled={loading}
            className={`h-12 min-w-0 flex-1 rounded-lg border bg-card text-center font-mono text-xl text-zinc-50 outline-none transition-colors duration-150 ${
              digit ? "border-white/[0.35]" : "border-white/[0.1] hover:border-white/[0.18] focus:border-white/[0.4]"
            }`}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-sm text-[#e5484d]">
          {error}
        </p>
      )}

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => submitCode()}
          disabled={loading || digits.some((d) => !d)}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#ededed] px-4 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
        >
          {loading ? (
            <>
              <MatrixSpinner />
              Verifying…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Verify and continue
            </>
          )}
        </button>

        <div className="flex items-center justify-between text-sm">
          {onCancel && (
            <button type="button" onClick={onCancel} className="text-zinc-400 transition-colors duration-150 hover:text-zinc-100">
              Back
            </button>
          )}

          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || isResending}
            className={`ml-auto inline-flex items-center gap-2 transition-colors duration-150 ${
              resendCooldown > 0 ? "cursor-not-allowed text-zinc-500" : "text-zinc-200 hover:text-white"
            }`}
          >
            <RefreshCw className={`h-4 w-4 ${isResending ? "animate-spin" : ""}`} />
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
          </button>
        </div>
      </div>
    </div>
  );
}
