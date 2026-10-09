import * as React from "react";
import type { Metadata } from "next";
import { groupOf, pageOf } from "@/lib/nav";

/** Metadata for a page, taken from the registry so titles are written once. */
export function pageMetadata(href: string): Metadata {
  const page = pageOf(href);
  return page ? { title: page.title, description: page.description } : {};
}

/**
 * Standard page frame: eyebrow, title and lead come from the registry; the body
 * is styled by the `doc` typography class.
 */
export function DocPage({
  href,
  title,
  description,
  children,
}: {
  href: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const page = pageOf(href);
  const heading = title ?? page?.title ?? "";
  const lead = description ?? page?.description ?? "";
  const group = groupOf(href);

  return (
    <>
      <header className="mb-8 border-b border-white/[0.06] pb-7">
        {group && (
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-blue-400">{group}</p>
        )}
        <h1 className="text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] text-zinc-50 sm:text-[2.15rem]">
          {heading}
        </h1>
        {lead && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-400">{lead}</p>}
      </header>
      <article className="doc">{children}</article>
    </>
  );
}
