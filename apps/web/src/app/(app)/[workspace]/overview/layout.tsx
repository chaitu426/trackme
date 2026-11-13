import { gateOverview } from "@/lib/feature-gate";

/** The overview shows the primary site, so it needs that site's traffic access. See lib/feature-gate.tsx. */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ workspace: string }> }) {
  return (await gateOverview(params)) ?? children;
}
