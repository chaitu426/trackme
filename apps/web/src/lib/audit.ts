import { db, auditLogs, users, eq, desc } from "@trackme/db";

export interface RecordAuditLogParams {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface AuditLogSummary {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  actorEmail: string | null;
  actorName: string | null;
}

/**
 * Record an administrative action into the audit trail.
 */
export async function recordAuditLog(params: RecordAuditLogParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: params.actorId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ?? {},
      ipAddress: params.ipAddress ?? null,
    });
  } catch (err) {
    console.error("⚠️ [AuditLog] Failed to persist audit record:", err);
  }
}

/**
 * List the most recent audit activity records for a workspace.
 */
export async function listWorkspaceAuditLogs(
  workspaceId: string,
  limit = 25
): Promise<AuditLogSummary[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(eq(auditLogs.workspaceId, workspaceId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return rows as AuditLogSummary[];
}
