import { NextRequest, NextResponse } from "next/server";
import { db, companies, companyMembers, workspaces, workspaceMembers, eq, and, inArray } from "@trackme/db";
import { requireApiUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

/**
 * GET /api/v1/companies
 *
 * The companies the signed-in person belongs to, with the workspaces they can open in each. A company owner
 * sees every workspace in the company; anyone else sees only the workspaces they are a member of.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);

    const mine = await db
      .select({ id: companies.id, name: companies.name, role: companyMembers.role })
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .where(eq(companyMembers.userId, user.id));

    const ownedIds = mine.filter((c) => c.role === "owner").map((c) => c.id);

    // Workspaces of companies they own, plus workspaces they were added to directly (their company may be another one).
    const owned = ownedIds.length
      ? await db
          .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, companyId: workspaces.companyId })
          .from(workspaces)
          .where(inArray(workspaces.companyId, ownedIds))
      : [];
    const direct = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        companyId: workspaces.companyId,
        companyName: companies.name,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .innerJoin(companies, eq(companies.id, workspaces.companyId))
      .where(and(eq(workspaceMembers.userId, user.id)));

    const byCompany = new Map<string, { id: string; name: string; role: string | null; workspaces: { id: string; name: string; slug: string; role: string }[] }>();
    for (const c of mine) byCompany.set(c.id, { id: c.id, name: c.name, role: c.role, workspaces: [] });
    for (const w of owned) byCompany.get(w.companyId)?.workspaces.push({ id: w.id, name: w.name, slug: w.slug, role: "owner" });
    for (const w of direct) {
      let company = byCompany.get(w.companyId);
      if (!company) {
        // A member of a workspace in a company they have no role in: shown, with no company role.
        company = { id: w.companyId, name: w.companyName, role: null, workspaces: [] };
        byCompany.set(w.companyId, company);
      }
      if (!company.workspaces.some((x) => x.id === w.id)) {
        company.workspaces.push({ id: w.id, name: w.name, slug: w.slug, role: w.role });
      }
    }

    return NextResponse.json({ companies: [...byCompany.values()] });
  } catch (error) {
    return jsonError(error);
  }
}
