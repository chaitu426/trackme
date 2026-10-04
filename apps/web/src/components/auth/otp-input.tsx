"use client";

import React, { useRef, useState, useEffect } from "react";
import { Loader2, RefreshCw, KeyRound, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OtpInputProps {
  email: string;
  purpose: "login_otp" | "signup_verify" | "password_reset";
  onSuccess: (data: { redirectTo?: string; user?: unknown }) => void;
  onCancel?: () => void;
  devCode?: string | undefined;
  rememberMe?: boolean | undefined;
}

export function OtpVerificationModal({
  email,
  purpose,
  onSuccess,
  onCancel,
  devCode: initialDevCode,
  rememberMe = false,
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
      <div className="text-center space-y-1.5">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-900 border border-white/[0.08] text-white flex items-center justify-center shadow-md mb-3">
          <KeyRound className="w-5 h-5 text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-100">
          Two-Factor Security Code
        </h2>
        <p className="text-xs text-zinc-400 max-w-sm mx-auto">
          We’ve dispatched a 6-digit one-time passcode to{" "}
          <span className="font-semibold text-zinc-200">{email}</span>.
        </p>
      </div>

      {/* Dev helper badge */}
      {devCode && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
          <p className="text-[11px] font-mono text-amber-400 font-medium">
            Local Dev Code: <span className="font-bold tracking-wider text-amber-300">{devCode}</span>
          </p>
        </div>
      )}

      {/* 6 Digit Inputs */}
      <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
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
            onChange={(e) => handleChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            disabled={loading}
            className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-mono font-bold rounded-xl border transition-all ${
              digit
                ? "border-zinc-200 bg-zinc-900 text-zinc-100 shadow-xs ring-2 ring-white/10"
                : "border-white/[0.08] bg-zinc-900/60 text-zinc-100 focus:border-zinc-300 focus:bg-zinc-900 focus:ring-1 focus:ring-zinc-400/20"
            } focus:outline-none`}
          />
        ))}
      </div>

      {error && (
        <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/60 rounded-xl px-3.5 py-2.5 text-center">
          {error}
        </div>
      )}

      <div className="space-y-3 pt-2">
        <Button
          type="button"
          onClick={() => submitCode()}
          className="w-full h-11 text-xs font-semibold rounded-xl"
          disabled={loading || digits.some((d) => !d)}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Verifying Code…
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Verify & Enter
            </>
          )}
        </Button>

        <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-zinc-400 hover:text-zinc-200 transition"
            >
              ← Back
            </button>
          )}

          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || isResending}
            className={`inline-flex items-center gap-1.5 ml-auto text-xs font-medium transition ${
              resendCooldown > 0
                ? "text-zinc-500 cursor-not-allowed"
                : "text-zinc-200 hover:underline cursor-pointer"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResending ? "animate-spin" : ""}`} />
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
          </button>
        </div>
      </div>
    </div>
  );
}
