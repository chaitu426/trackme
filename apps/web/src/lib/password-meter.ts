/**
 * What the signup form can tell a person about their password while they type. It mirrors the rules the server enforces in
 * password-policy.ts that do not need a server (length, variety of characters, not containing the email or name); the server
 * still decides, and also refuses common and breached passwords. Pure, so it runs in the browser and is tested.
 */
export const MIN_LENGTH = 12;

export interface PasswordCheck {
  id: "length" | "variety" | "personal";
  label: string;
  ok: boolean;
}

export interface PasswordReport {
  checks: PasswordCheck[];
  /** 0 to 1, for the meter. Reaches 1 only when every check passes and the password is comfortably long. */
  strength: number;
  acceptable: boolean;
}

export function checkPassword(password: string, context: { email?: string; name?: string } = {}): PasswordReport {
  const lower = password.toLowerCase();
  const local = context.email?.split("@")[0]?.toLowerCase() ?? "";
  const name = context.name?.toLowerCase().replace(/\s+/g, "") ?? "";
  const personal = !((local.length >= 4 && lower.includes(local)) || (name.length >= 4 && lower.replace(/\s+/g, "").includes(name)));

  const checks: PasswordCheck[] = [
    { id: "length", label: `At least ${MIN_LENGTH} characters`, ok: password.length >= MIN_LENGTH },
    { id: "variety", label: "Not a repeated pattern", ok: new Set(lower).size >= 5 },
    { id: "personal", label: "Does not contain your name or email", ok: personal },
  ];

  const lengthScore = Math.min(1, password.length / 20);
  const ok = checks.filter((c) => c.ok).length;
  const strength = password.length === 0 ? 0 : Math.min(1, lengthScore * 0.7 + (ok / checks.length) * 0.3) * (ok === checks.length ? 1 : 0.6);
  return { checks, strength, acceptable: ok === checks.length };
}

/** A word for the meter. */
export function strengthLabel(strength: number): string {
  if (strength === 0) return "";
  if (strength < 0.4) return "Weak";
  if (strength < 0.75) return "Fair";
  return "Strong";
}
