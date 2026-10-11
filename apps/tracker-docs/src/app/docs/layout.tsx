import { DocsShell } from "@/components/docs-shell";
import { TokenSync } from "@/components/token-sync";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DocsShell>{children}</DocsShell>
      <TokenSync />
    </>
  );
}
