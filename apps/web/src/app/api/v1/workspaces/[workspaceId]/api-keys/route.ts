import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError, ApiKeyScopeSchema } from "@trackme/contracts";
import { generateApiKey } from "@trackme/authz";
import { db, apiKeys, eq, desc } from "@trackme/db";
import { requireWorkspaceMember } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";

const CreateApiKeySchema = z.object({
  name: z.string().trim().min(2).max(64),
  scopes: z.array(ApiKeyScopeSchema).min(1).default(["read:analytics"]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    await requireWorkspaceMember(request, workspaceId, "api_keys:manage");

    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.workspaceId, workspaceId))
      .orderBy(desc(apiKeys.createdAt));

    return NextResponse.json({ keys });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    const ctx = await requireWorkspaceMember(request, workspaceId, "api_keys:manage");

    const parsed = CreateApiKeySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A name and at least one scope are required");
    }

    const generated = generateApiKey();
    const created = await db
      .insert(apiKeys)
      .values({
        workspaceId,
        name: parsed.data.name,
        prefix: generated.prefix,
        keyHash: generated.keyHash,
        scopes: parsed.data.scopes,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        createdAt: apiKeys.createdAt,
      });

    const key = created[0];
    if (!key) {
      throw new AppError(500, "API_KEY_CREATE_FAILED", "Unable to create API key");
    }

    // Plaintext is only ever returned once, at creation time.
    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId,
      action: "api_key:create",
      targetType: "api_key",
      targetId: key.id,
      metadata: { name: key.name, prefix: key.prefix, scopes: key.scopes },
      ipAddress: request.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json({ key: { ...key, plaintext: generated.plaintext } });
  } catch (error) {
    return jsonError(error);
  }
}
