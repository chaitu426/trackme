import Link from "next/link";
import { Activity } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listUserWorkspaces } from "@/lib/tenancy";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await listUserWorkspaces(user.id);

  return (
    <div className="min-h-screen bg-background relative flex flex-col items-center justify-between p-6 antialiased">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 650px 550px at 50% 25%, rgba(16,185,129,0.05) 0%, rgba(99,102,241,0.03) 50%, transparent 70%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 w-full max-w-5xl flex items-center justify-between py-2">
        <div className="flex items-center space-x-2.5">
          <div className="h-8 w-8 rounded-xl bg-zinc-900 flex items-center justify-center shadow-xs">
            <Activity className="w-4 h-4 text-zinc-100" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-base tracking-tight text-zinc-900">TrackMe</span>
        </div>
        <span className="text-xs text-zinc-500">Signed in as {user.email}</span>
      </header>

      {/* Wizard */}
      <main className="relative z-10 w-full max-w-2xl my-auto py-6">
        {/* Existing workspace notice */}
        {existing.length > 0 && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-zinc-200 bg-white text-xs text-zinc-600 shadow-xs">
            You already have {existing.length === 1 ? "a workspace" : "workspaces"}:{" "}
            {existing.map((workspace, index) => (
              <span key={workspace.id}>
                {index > 0 ? ", " : ""}
                <Link
                  className="font-semibold text-zinc-900 hover:underline"
                  href={`/${workspace.slug}/overview`}
                >
                  {workspace.name}
                </Link>
              </span>
            ))}
          </div>
        )}

        <OnboardingForm />
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-5xl text-center text-xs text-zinc-400 py-3">
        Need help?{" "}
        <Link href="/docs" className="hover:text-zinc-700">
          Read the quickstart guide
        </Link>
      </footer>
    </div>
  );
}
