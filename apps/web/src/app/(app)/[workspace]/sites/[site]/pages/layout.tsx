import { gateSection } from "@/lib/feature-gate";

/** Per-site feature access: this area belongs to the "acquisition" feature. See lib/feature-gate.tsx. */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ workspace: string; site: string }> }) {
  return (await gateSection(params, "acquisition")) ?? children;
}
