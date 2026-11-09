import Link from "next/link";
import { LogoMark } from "@/components/brand/logo-mark";
import { requireUser } from "@/lib/auth";
import { listUserWorkspaces } from "@/lib/tenancy";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await listUserWorkspaces(user.id);

  return (
    <div className="flex min-h-screen flex-col bg-background text-zinc-100 antialiased">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-medium leading-none text-zinc-50" aria-label="TrackMe home">
          <LogoMark />
          TrackMe
        </Link>
        <span className="truncate font-mono text-xs text-zinc-500">{user.email}</span>
      </header>

      <OnboardingForm existing={existing.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))} />

      <footer className="shrink-0 border-t border-white/[0.08] px-4 py-4 text-[13px] text-zinc-500 sm:px-6">
        Need help?{" "}
        <Link href="/docs" className="text-zinc-300 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60">
          Read the quickstart
        </Link>
      </footer>
    </div>
  );
}
