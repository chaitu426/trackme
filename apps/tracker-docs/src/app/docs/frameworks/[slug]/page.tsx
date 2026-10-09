import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "@/components/doc-page";
import { FrameworkView } from "@/components/framework-view";
import { FRAMEWORKS, getFramework } from "@/lib/frameworks";

export function generateStaticParams() {
  return FRAMEWORKS.map((framework) => ({ slug: framework.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const framework = getFramework((await params).slug);
  return framework ? { title: framework.name, description: framework.tagline } : {};
}

export default async function FrameworkPage({ params }: { params: Promise<{ slug: string }> }) {
  const framework = getFramework((await params).slug);
  if (!framework) notFound();

  return (
    <DocPage href={`/docs/frameworks/${framework.slug}`} title={framework.name} description={framework.tagline}>
      <FrameworkView framework={framework} />
    </DocPage>
  );
}
