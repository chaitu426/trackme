/**
 * The release the product is on, in one place. The landing footer and the docs footer both read it, and
 * apps/web/src/lib/brand.test.ts checks it against the root package.json, so the number cannot drift.
 * Next: beta 0.2 (see docs/plans/beta-0.2-teams-suite-plan.md).
 */
export const RELEASE = { stage: "Beta", version: "0.1", label: "Beta 0.1" } as const;
