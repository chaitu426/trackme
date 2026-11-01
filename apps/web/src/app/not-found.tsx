import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400">
        <Compass className="h-5 w-5" />
      </div>
      <h1 className="mt-4 text-xl font-bold tracking-tight text-zinc-50">Page not found</h1>
      <p className="mt-1.5 max-w-sm text-xs text-zinc-400">
        The page you are looking for does not exist, or you do not have access to it.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex h-9 items-center rounded-md bg-zinc-100 px-4 text-xs font-medium text-zinc-950 transition-colors hover:bg-white"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
