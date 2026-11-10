import { Suspense } from "react";

// Next.js requires a Suspense boundary when the page uses useSearchParams().
export default function InviteAcceptLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-background" aria-busy="true">
          <div className="flex w-full max-w-[420px] flex-col gap-4 px-4">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-8 w-64" />
            <div className="skeleton h-11 w-full" />
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
