import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "./card";

/** What a page shows when there is nothing to show yet: one line of what is missing, one line of how to get it, one action. */
export function Empty({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="enter flex flex-col items-center py-14 text-center">
      {Icon && (
        <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-white/[0.03] text-zinc-400">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      )}
      <p className="text-sm font-medium text-zinc-100">{title}</p>
      {children && <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-400">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}
