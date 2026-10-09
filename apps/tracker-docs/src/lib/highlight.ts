import { createHighlighter, type Highlighter } from "shiki";

/**
 * Syntax highlighting runs on the server at build time, so code blocks ship as
 * plain HTML with no highlighter in the browser.
 */
const LANGS = [
  "html",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "vue",
  "svelte",
  "astro",
  "bash",
  "json",
  "python",
  "go",
  "php",
  "ruby",
  "java",
  "csharp",
  "nginx",
  "yaml",
  "ini",
  "liquid",
  "erb",
  "diff",
  "blade",
  "jinja",
  "razor",
  "elixir",
] as const;

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rb: "ruby",
  cs: "csharp",
  env: "ini",
  text: "text",
  txt: "text",
};

const THEME = "github-dark-default";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: [...LANGS] });
  return highlighterPromise;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function highlight(code: string, lang: string): Promise<string> {
  const normalized = ALIASES[lang] ?? lang;
  const trimmed = code.replace(/\n+$/, "");

  if (normalized === "text" || !(LANGS as readonly string[]).includes(normalized)) {
    return `<pre class="shiki"><code>${escapeHtml(trimmed)}</code></pre>`;
  }

  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(trimmed, { lang: normalized, theme: THEME });
}

/** Label shown in the code block header. */
export function languageLabel(lang: string): string {
  const normalized = ALIASES[lang] ?? lang;
  const labels: Record<string, string> = {
    html: "HTML",
    javascript: "JavaScript",
    typescript: "TypeScript",
    jsx: "JSX",
    tsx: "TSX",
    vue: "Vue",
    svelte: "Svelte",
    astro: "Astro",
    bash: "Shell",
    json: "JSON",
    python: "Python",
    go: "Go",
    php: "PHP",
    ruby: "Ruby",
    java: "Java",
    csharp: "C#",
    nginx: "nginx",
    yaml: "YAML",
    ini: "Env",
    liquid: "Liquid",
    erb: "ERB",
    diff: "Diff",
    blade: "Blade",
    jinja: "Jinja",
    razor: "Razor",
    elixir: "Elixir",
    text: "Text",
  };
  return labels[normalized] ?? normalized;
}
