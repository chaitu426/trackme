import { and, db, eq, siteSegments } from "@trackme/db";
import { SegmentDefinitionSchema, type SegmentDefinition } from "./segment-schema";

export interface SavedSegment {
  id: string;
  name: string;
  definition: SegmentDefinition;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A saved definition that no longer passes the schema (the schema was tightened since) is skipped, not trusted. */
function valid(row: { id: string; name: string; definition: unknown }): SavedSegment | null {
  const parsed = SegmentDefinitionSchema.safeParse(row.definition);
  return parsed.success ? { id: row.id, name: row.name, definition: parsed.data } : null;
}

export async function listSavedSegments(siteId: string): Promise<SavedSegment[]> {
  const rows = await db
    .select({ id: siteSegments.id, name: siteSegments.name, definition: siteSegments.definition })
    .from(siteSegments)
    .where(eq(siteSegments.siteId, siteId));
  return rows.flatMap((row) => valid(row) ?? []);
}

/** One saved segment of this site; null for an unknown id or one that belongs to another site. */
export async function getSavedSegment(siteId: string, id: string): Promise<SavedSegment | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select({ id: siteSegments.id, name: siteSegments.name, definition: siteSegments.definition })
    .from(siteSegments)
    .where(and(eq(siteSegments.siteId, siteId), eq(siteSegments.id, id)))
    .limit(1);
  return row ? valid(row) : null;
}
