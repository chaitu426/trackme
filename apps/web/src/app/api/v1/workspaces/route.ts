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
  sites,
  eq,
} from "@trackme/db";
import { requireApiUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { invalidateIngestSiteCache } from "@/lib/ingest-cache";

const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(64),
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
      const workspaceRows = await tx
        .insert(workspaces)
        .values({
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
      trackerScriptUrl: `${env.APP_URL}/tracker.js`,
      ingestionUrl: `${env.INGESTION_URL}/v1/batch`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
