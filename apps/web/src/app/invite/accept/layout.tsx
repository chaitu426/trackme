import { Suspense } from "react";

// Next.js requires a Suspense boundary when child pages use useSearchParams()
export default function InviteAcceptLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
