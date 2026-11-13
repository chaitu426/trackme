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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordAuditLog(params: RecordAuditLogParams): Promise<void> {
  try {
    // `actor_id` is a user uuid. An API key (`api-key:<id>`) is kept in the metadata instead of being dropped,
    // so the record still says who acted.
    const actorIsUser = typeof params.actorId === "string" && UUID.test(params.actorId);
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: actorIsUser ? params.actorId! : null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.actorId && !actorIsUser ? { ...(params.metadata ?? {}), actor: params.actorId } : (params.metadata ?? {}),
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
