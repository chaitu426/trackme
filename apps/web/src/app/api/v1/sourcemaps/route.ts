import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError, ReleaseSchema } from "@trackme/contracts";
import { and, db, eq, sites } from "@trackme/db";
import { authenticateDeployKey } from "@/lib/tenancy";
import { checkSourceMap, getObjectStore, mapKey, MAX_MAP_BYTES, normalizeFileKey } from "@/lib/sourcemaps";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";
import { getClientIp } from "@/lib/client-ip";

const BodySchema = z.object({
  /** The site's public key, as in the tracker snippet. It names the site; the API key is what authorizes. */
  siteKey: z.string().min(8).max(64),
  release: ReleaseSchema,
  /** The minified file the map belongs to: its URL or path, as it appears in stack traces. */
  file: z.string().min(1).max(512),
  /** The source map, as JSON text or an object. */
  map: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

/**
 * Store a source map for one file of one release, so stack traces from minified code read as the original source.
 * Authorizes like the deploy webhook: a workspace API key with `write:deploys`. Replaces a map already stored for the
 * same site, release and file, so CI can safely re-upload.
 */
async function handlePost(request: NextRequest) {
  try {
    const { workspaceId, keyId } = await authenticateDeployKey(request);

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "siteKey, release, file and map are required; see docs/features/sourcemaps.md");
    }
    const { siteKey, release, file, map } = parsed.data;

    const text = typeof map === "string" ? map : JSON.stringify(map);
    if (text.length > MAX_MAP_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "The source map is larger than 10 MB");
    const check = checkSourceMap(text);
    if (!check.ok) throw new AppError(400, "INVALID_SOURCE_MAP", check.reason);

    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.publicKey, siteKey), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) throw new AppError(404, "SITE_NOT_FOUND", "No site with that siteKey in this workspace");

    const bytes = new TextEncoder().encode(text);
    await getObjectStore().put(mapKey(site.id, release, file), bytes);

    await recordAuditLog({
      workspaceId,
      action: "sourcemap:upload",
      targetType: "site",
      targetId: site.id,
      metadata: { release, file: normalizeFileKey(file), bytes: bytes.length, keyId },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ stored: true, release, file: normalizeFileKey(file), bytes: bytes.length }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export const POST = timedRoute("sourcemaps", handlePost);
