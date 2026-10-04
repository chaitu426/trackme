import Link from "next/link";
import { Activity } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listUserWorkspaces } from "@/lib/tenancy";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await listUserWorkspaces(user.id);

  return (
    <div className="min-h-screen bg-[#09090b] relative flex flex-col items-center justify-between p-6 antialiased overflow-hidden">
      {/* Background grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />

      {/* Ambient glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 700px 500px at 50% 10%, rgba(16,185,129,0.08) 0%, transparent 65%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 500px 400px at 80% 80%, rgba(99,102,241,0.06) 0%, transparent 65%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 w-full max-w-5xl flex items-center justify-between py-2">
        <div className="flex items-center space-x-2.5">
          <div className="h-8 w-8 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center shadow-sm">
            <Activity className="w-4 h-4 text-zinc-100" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-base tracking-tight text-zinc-100">TrackMe</span>
        </div>
        <span className="text-xs text-zinc-500 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-full">
          Signed in as{" "}
          <span className="text-zinc-300 font-medium">{user.email}</span>
        </span>
      </header>

      {/* Wizard */}
      <main className="relative z-10 w-full max-w-2xl my-auto py-6">
        {/* Existing workspace notice */}
        {existing.length > 0 && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-400 backdrop-blur-sm">
            <span className="text-zinc-300">You already have{" "}
            {existing.length === 1 ? "a workspace" : "workspaces"}:{" "}
            {existing.map((workspace, index) => (
              <span key={workspace.id}>
                {index > 0 ? ", " : ""}
                <Link
                  className="font-semibold text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2"
                  href={`/${workspace.slug}/overview`}
                >
                  {workspace.name}
                </Link>
              </span>
            ))}</span>
          </div>
        )}

        <OnboardingForm />
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-5xl text-center text-xs text-zinc-600 py-3">
        Need help?{" "}
        <Link href="/docs" className="text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2">
          Read the quickstart guide
        </Link>
      </footer>
    </div>
  );
}
