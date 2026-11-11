import { requireUser } from "@/lib/auth";
import { SessionMonitor } from "@/components/auth/session-monitor";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return (
    <>
      {children}
      <SessionMonitor />
    </>
  );
}
