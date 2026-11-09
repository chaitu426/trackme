import { LogoMark } from "@/components/brand/logo-mark";
import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-zinc-200">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-medium text-zinc-50" aria-label="TrackMe home">
          <LogoMark />
          TrackMe
        </Link>
        <nav aria-label="Legal" className="flex items-center gap-1 text-sm">
          <Link href="/legal/privacy" className="press rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50">
            Privacy
          </Link>
          <Link href="/legal/dpa" className="press rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50">
            DPA
          </Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/[0.08] px-4 py-5 text-xs text-zinc-600 sm:px-6">TrackMe. Cookieless analytics.</footer>
    </div>
  );
}
