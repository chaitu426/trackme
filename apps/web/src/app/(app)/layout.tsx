import { requireUser } from "@/lib/auth";
import { SessionMonitor } from "@/components/auth/session-monitor";

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
