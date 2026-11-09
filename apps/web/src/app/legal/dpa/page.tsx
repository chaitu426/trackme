import type { Metadata } from "next";
import { LegalDoc, type LegalSection } from "@/components/legal-doc";

// An outline for counsel, not a document to sign: keep it out of search results.
export const metadata: Metadata = { title: "Data Processing Addendum", robots: { index: false, follow: false } };

const sections: LegalSection[] = [
  { id: "subject", title: "Subject matter", body: <p>Website analytics event processing.</p> },
  { id: "duration", title: "Duration", body: <p>The term of the subscription plus the retention window.</p> },
  { id: "nature", title: "Nature of processing", body: <p>Collection, enrichment, aggregation and deletion.</p> },
  { id: "data", title: "Types of data", body: <p>Pseudonymous IDs, URLs, device fields derived from the user agent, and coarse location.</p> },
  { id: "subprocessors", title: "Subprocessors", body: <p>Cloud database, object storage and support tooling. List them by name in a schedule.</p> },
  { id: "security", title: "Security", body: <p>Encryption in transit, access control and audit logging.</p> },
];

export default function DpaPage() {
  return (
    <LegalDoc
      title="Data Processing Addendum"
      lede="A template outline for engineering and product alignment."
      note="Have legal counsel finalise the roles (controller and processor), subprocessors, international transfers, breach notification and audit rights before signing customers."
      sections={sections}
    />
  );
}
