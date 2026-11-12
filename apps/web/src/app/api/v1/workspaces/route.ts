import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { env } from "@trackme/config";
import { hashApiKey } from "@trackme/authz";
import {
  db,
  workspaces,
  workspaceMembers,
  companies,
  companyMembers,
  sites,
  eq,
  and,
} from "@trackme/db";
import { requireApiUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { invalidateIngestSiteCache } from "@/lib/ingest-cache";
import { resolveTrackerIntegrity, resolveTrackerScriptUrl } from "@/lib/tracker-url";

const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(64),
  /**
   * The company to create the workspace under. Omit it and the caller's only company is used; a first-time
   * caller with no company gets one created, named after the workspace.
   */
  companyId: z.string().uuid().optional(),
  domain: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .transform((value) => value.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? value.toLowerCase()),
});

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length >= 2 ? slug : "workspace";
}

async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const existing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!existing[0]) {
      return candidate;
    }
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = CreateWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "Workspace name and domain are required");
    }

    const slug = await uniqueSlug(slugify(parsed.data.name));
    const publicKey = `site_pub_${randomBytes(18).toString("base64url")}`;
    const publicKeyHash = hashApiKey(publicKey);

    const created = await db.transaction(async (tx) => {
      // Workspaces live under a company, and only a company owner can add one.
      const owned = await tx
        .select({ companyId: companyMembers.companyId })
        .from(companyMembers)
        .where(and(eq(companyMembers.userId, user.id), eq(companyMembers.role, "owner")));

      let companyId: string;
      if (parsed.data.companyId) {
        if (!owned.some((c) => c.companyId === parsed.data.companyId)) {
          throw new AppError(403, "FORBIDDEN", "Only a company owner can create workspaces in this company.");
        }
        companyId = parsed.data.companyId;
      } else if (owned.length === 1) {
        companyId = owned[0]!.companyId;
      } else if (owned.length > 1) {
        throw new AppError(400, "COMPANY_REQUIRED", "You own more than one company. Say which one the workspace belongs to.");
      } else {
        const [company] = await tx.insert(companies).values({ name: parsed.data.name }).returning({ id: companies.id });
        if (!company) {
          throw new AppError(500, "COMPANY_CREATE_FAILED", "Unable to create company");
        }
        await tx.insert(companyMembers).values({ companyId: company.id, userId: user.id, role: "owner" });
        companyId = company.id;
      }

      const workspaceRows = await tx
        .insert(workspaces)
        .values({
          companyId,
          name: parsed.data.name,
          slug,
        })
        .returning({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
        });
      const workspace = workspaceRows[0];
      if (!workspace) {
        throw new AppError(500, "WORKSPACE_CREATE_FAILED", "Unable to create workspace");
      }

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });

      const siteRows = await tx
        .insert(sites)
        .values({
          workspaceId: workspace.id,
          domain: parsed.data.domain,
          displayName: parsed.data.domain,
          publicKey,
          publicKeyHash,
        })
        .returning({
          id: sites.id,
          domain: sites.domain,
          displayName: sites.displayName,
        });
      const site = siteRows[0];
      if (!site) {
        throw new AppError(500, "SITE_CREATE_FAILED", "Unable to create site");
      }

      return { workspace, site };
    });

    // The edge remembers unknown keys for a few seconds; tell it this one now exists.
    await invalidateIngestSiteCache(publicKeyHash);

    return NextResponse.json({
      workspace: created.workspace,
      site: {
        ...created.site,
        publicKey,
      },
      trackerScriptUrl: resolveTrackerScriptUrl(),
      trackerScriptIntegrity: resolveTrackerIntegrity(),
      ingestionUrl: `${env.INGESTION_URL}/v1/batch`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
