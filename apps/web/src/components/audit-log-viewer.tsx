import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AuditLogSummary } from "@/lib/audit";
import { formatRelativeTime } from "@/lib/format";

function actionBadgeVariant(action: string): "default" | "success" | "warning" | "outline" {
  if (action.includes("delete") || action.includes("revoke")) return "warning";
  if (action.includes("create")) return "success";
  return "default";
}

export function AuditLogViewer({ logs }: { logs: AuditLogSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Audit Trail</CardTitle>
        <CardDescription>
          Immutable security record of configuration changes and API operations.
        </CardDescription>
      </CardHeader>

      <div className="space-y-1.5 font-mono text-[11px]">
        {logs.length === 0 ? (
          <p className="text-xs font-sans text-zinc-400 py-3 text-center">
            No audit activity recorded yet.
          </p>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-white/[0.04] transition"
            >
              <div className="flex items-center space-x-2.5 flex-wrap gap-1">
                <Badge variant={actionBadgeVariant(log.action)} className="text-[10px]">
                  {log.action}
                </Badge>
                <span className="text-zinc-400 font-sans text-xs">
                  {log.actorEmail ? (
                    <span>
                      by <strong className="text-zinc-50">{log.actorEmail}</strong>
                    </span>
                  ) : (
                    <span className="text-zinc-400">System</span>
                  )}
                </span>
                <span className="text-zinc-300">·</span>
                <span className="text-zinc-500 font-sans text-[11px]">
                  target: <span className="text-zinc-300">{log.targetType}</span>
                </span>
              </div>

              <span className="text-zinc-400 font-sans text-[11px] shrink-0">
                {formatRelativeTime(
                  typeof log.createdAt === "string"
                    ? log.createdAt
                    : new Date(log.createdAt).toISOString()
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
