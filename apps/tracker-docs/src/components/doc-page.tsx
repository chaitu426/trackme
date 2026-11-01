import * as React from "react";
import type { Metadata } from "next";
import { GlyphField, type GlyphVariant } from "@trackme/landing";
import { NAV, groupOf, pageOf } from "@/lib/nav";

/** Metadata for a page, taken from the registry so titles are written once. */
export function pageMetadata(href: string): Metadata {
  const page = pageOf(href);
  return page ? { title: page.title, description: page.description } : {};
}

/**
 * Each docs section has a picture that says what it is about, drawn with the same glyph
 * language as the landing page: traffic for the introduction, a stream for installing,
 * a globe for platforms, steps for tracking, a gauge for privacy.
 */
const ART: Record<string, GlyphVariant> = {
  "Start here": "ridge",
  Frameworks: "stream",
  "Platforms & CMS": "globe",
  "Server-side": "stream",
  Tracking: "steps",
  "Privacy & security": "gauge",
  Reference: "steps",
  Operate: "pulse",
};

export function artFor(group: string | undefined): GlyphVariant {
  return (group && ART[group]) || "ridge";
}

/** "01" for the first group, "02" for the second, so every page knows where it sits. */
export function indexOf(group: string | undefined): string {
  const i = NAV.findIndex((g) => g.title === group);
  return String(i < 0 ? 0 : i + 1).padStart(2, "0");
}

/**
 * Standard page frame: a matrix banner with the section, title and lead from the registry,
 * then the body styled by the `doc` typography class.
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
      <header className="relative mb-10 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0f0f10]">
        <div className="absolute inset-y-0 right-0 hidden w-[50%] [mask-image:linear-gradient(to_right,transparent,black_45%)] sm:block">
          <GlyphField variant={artFor(group)} cell={9} strength={0.85} />
        </div>
        <div className="relative z-10 px-6 py-9 sm:px-10 sm:py-12">
          {group && (
            <div className="flex items-center gap-4 font-mono text-xs text-zinc-500">
              <span className="text-zinc-300">{indexOf(group)}</span>
              <span className="h-px w-10 bg-white/[0.16]" />
              <span>{group}</span>
            </div>
          )}
          <h1 className="mt-5 max-w-xl text-balance text-[34px] font-medium leading-[40px] tracking-[-0.03em] text-zinc-50 sm:text-[44px] sm:leading-[48px]">
            {heading}
          </h1>
          {lead && <p className="mt-4 max-w-md text-[16px] leading-7 text-zinc-400">{lead}</p>}
        </div>
      </header>
      <article className="doc">{children}</article>
    </>
  );
}
