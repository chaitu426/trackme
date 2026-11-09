import type { ReactNode } from "react";
import { LegalToc } from "@/components/legal-toc";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** A long-form page: a short lede, a sticky table of contents beside numbered sections. Server-rendered; only the contents list is client code. */
export function LegalDoc({ title, lede, note, sections }: { title: string; lede: ReactNode; note?: ReactNode; sections: LegalSection[] }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-14 lg:py-20">
      <header className="max-w-2xl">
        <h1 className="text-title font-medium text-zinc-50">{title}</h1>
        <p className="mt-3 text-base leading-7 text-zinc-400">{lede}</p>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-8">
            <LegalToc items={sections.map((s) => ({ id: s.id, title: s.title }))} />
          </div>
        </aside>

        <article className="min-w-0 max-w-2xl">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-8 border-t border-white/[0.08] py-8 first:border-t-0 first:pt-0">
              <h2 className="flex items-baseline gap-3 text-lg font-medium text-zinc-50">
                <span className="font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </h2>
              <div className="mt-3 flex flex-col gap-3 text-sm leading-7 text-zinc-400 [&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-zinc-300 [&_li]:pl-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:marker:text-zinc-600 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:marker:text-zinc-600">
                {s.body}
              </div>
            </section>
          ))}
          {note && <p className="mt-4 rounded-lg border border-border bg-white/[0.02] px-4 py-3 text-xs leading-5 text-zinc-500">{note}</p>}
        </article>
      </div>
    </div>
  );
}
