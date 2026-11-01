import type { Metadata } from "next";

// An outline for counsel, not a document to sign: keep it out of search results.
export const metadata: Metadata = { title: "Data Processing Addendum", robots: { index: false, follow: false } };

export default function DpaPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-200">
      <h1 className="mb-4 text-title font-medium text-zinc-50">Data Processing Addendum (template)</h1>
      <p className="text-sm leading-relaxed text-zinc-400 mb-6">
        This is a placeholder DPA outline for engineering/product alignment. Have legal counsel
        finalize roles (controller/processor), subprocessors, international transfers, breach
        notification, and audit rights before signing customers.
      </p>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-zinc-300">
        <li>Subject matter: website analytics event processing</li>
        <li>Duration: term of the subscription + retention window</li>
        <li>Nature: collection, enrichment, aggregation, deletion</li>
        <li>Types of data: pseudonymous IDs, URLs, UA-derived device fields, coarse geo</li>
        <li>Subprocessors: cloud DB, object storage, support tooling (enumerate in schedule)</li>
        <li>Security: encryption in transit, access control, audit logging</li>
      </ol>
    </main>
  );
}
