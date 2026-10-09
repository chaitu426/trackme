import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { hashApiKey } from "@trackme/authz";
import { db, sites, eq, and } from "@trackme/db";
import { env } from "@trackme/config";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { invalidateIngestSiteCache } from "@/lib/ingest-cache";

const AddSiteSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .transform((val) => val.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? val.toLowerCase()),
  displayName: z.string().trim().min(1).max(100).optional(),
});

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await props.params;
    await authenticateRequest(request, workspaceId, "read:analytics");

    const rows = await db
      .select({
        id: sites.id,
        workspaceId: sites.workspaceId,
        domain: sites.domain,
        displayName: sites.displayName,
        publicKey: sites.publicKey,
        settings: sites.settings,
        createdAt: sites.createdAt,
      })
      .from(sites)
      .where(eq(sites.workspaceId, workspaceId));

    return NextResponse.json({ sites: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await props.params;
    // Adding a site requires workspace site creation permission
    await authenticateRequest(request, workspaceId, "sites:create");

    const body = await request.json().catch(() => ({}));
    const parsed = AddSiteSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A valid domain is required.");
    }

    const { domain, displayName } = parsed.data;

    // Check if domain already exists in this workspace
    const existing = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.workspaceId, workspaceId), eq(sites.domain, domain)))
      .limit(1);

    if (existing[0]) {
      throw new AppError(409, "SITE_EXISTS", "This domain is already added to this organization.");
    }

    const publicKey = `site_pub_${randomBytes(18).toString("base64url")}`;
    const publicKeyHash = hashApiKey(publicKey);

    const created = await db
      .insert(sites)
      .values({
        workspaceId,
        domain,
        displayName: displayName || domain,
        publicKey,
        publicKeyHash,
      })
      .returning({
        id: sites.id,
        workspaceId: sites.workspaceId,
        domain: sites.domain,
        displayName: sites.displayName,
        publicKey: sites.publicKey,
        createdAt: sites.createdAt,
      });

    const newSite = created[0];
    if (!newSite) {
      throw new AppError(500, "SITE_CREATE_FAILED", "Failed to create site.");
    }

    // The edge remembers unknown keys for a few seconds; tell it this one now exists.
    await invalidateIngestSiteCache(publicKeyHash);

    return NextResponse.json({
      site: newSite,
      snippet: `<script defer src="${env.APP_URL}/tracker.js" data-site="${newSite.publicKey}" data-endpoint="${env.INGESTION_URL}/v1/batch"></script>`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
