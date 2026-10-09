import * as React from "react";
import Link from "next/link";

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

/**
 * Renders the small inline subset used in data-driven pages: `code`, **bold** and
 * [links](/path). Anything else is plain text.
 */
export function Inline({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter((part) => part !== "");
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link) {
          const [, label, href] = link as unknown as [string, string, string];
          return href.startsWith("/") ? (
            <Link key={index} href={href}>
              {label}
            </Link>
          ) : (
            <a key={index} href={href} target="_blank" rel="noreferrer">
              {label}
            </a>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </>
  );
}
