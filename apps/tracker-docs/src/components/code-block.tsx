import { CopyButton } from "@/components/copy-button";
import { CodeTabs as CodeTabsClient, type TabItem } from "@/components/tabs-client";
import { highlight, languageLabel } from "@/lib/highlight";

export interface Snippet {
  /** Tab label. Omit for a single block. */
  label?: string;
  lang: string;
  code: string;
  filename?: string;
}

/** A single highlighted code block with a copy button. */
export async function CodeBlock({ lang, code, filename }: Omit<Snippet, "label">) {
  const html = await highlight(code, lang);
  return (
    <figure
      data-code-root
      className="not-prose my-6 overflow-hidden rounded-xl border border-white/[0.1] bg-[#0f0f10]"
    >
      <div className="flex h-11 items-center justify-between border-b border-white/[0.08] bg-[#141415] pl-4 pr-2">
        <span className="font-mono text-xs text-zinc-500">{filename ?? languageLabel(lang)}</span>
        <CopyButton />
      </div>
      <div data-code-panel className="code-body" dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}

/**
 * Several samples of the same thing, one tab each (for example one per language
 * or package manager). Pass `group` to keep tabs in sync across the page.
 */
export async function CodeTabs({ items, group }: { items: Snippet[]; group?: string }) {
  const rendered: TabItem[] = await Promise.all(
    items.map(async (item, index) => ({
      label: item.label ?? languageLabel(item.lang) ?? `Tab ${index + 1}`,
      html: await highlight(item.code, item.lang),
      filename: item.filename,
      languageLabel: languageLabel(item.lang),
    }))
  );
  return <CodeTabsClient items={rendered} group={group} />;
}

/** Install commands for the three common package managers. */
export function InstallTabs({ pkg, dev = false }: { pkg: string; dev?: boolean }) {
  return (
    <CodeTabs
      group="pm"
      items={[
        { label: "npm", lang: "bash", code: `npm install ${dev ? "-D " : ""}${pkg}` },
        { label: "pnpm", lang: "bash", code: `pnpm add ${dev ? "-D " : ""}${pkg}` },
        { label: "yarn", lang: "bash", code: `yarn add ${dev ? "-D " : ""}${pkg}` },
      ]}
    />
  );
}
