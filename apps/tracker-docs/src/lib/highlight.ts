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

/** The theme colours some tokens blue. The site has no blue, so those become grey of the same lightness. */
function withoutBlue(html: string): string {
  return html.replace(/#([0-9a-fA-F]{6})/g, (match, digits: string) => {
    const r = parseInt(digits.slice(0, 2), 16) / 255;
    const g = parseInt(digits.slice(2, 4), 16) / 255;
    const b = parseInt(digits.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return match;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h < 185 || h > 262 || s < 0.1) return match;
    const v = Math.round(l * 255).toString(16).padStart(2, "0");
    return `#${v}${v}${v}`;
  });
}

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
  return withoutBlue(highlighter.codeToHtml(trimmed, { lang: normalized, theme: THEME }));
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
