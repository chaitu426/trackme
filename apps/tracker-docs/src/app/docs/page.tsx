import { BookOpen, Code2, Rocket, ShieldCheck, Terminal, Zap } from "lucide-react";
import { DocPage, pageMetadata } from "@/components/doc-page";
import { CardGrid, H2, LinkCard } from "@/components/doc";

export const metadata = pageMetadata("/docs");

export default function DocsIndex() {
  return (
    <DocPage href="/docs">
      <p>
        TrackMe is privacy-first web analytics for product and growth teams. Collect pageviews, custom events, funnels,
        realtime activity and Web Vitals without advertising cookies.
      </p>

      <H2>Get started</H2>
      <CardGrid cols={3}>
        <LinkCard
          href="/docs/quickstart"
          title="Quickstart"
          description="Add the tracker to your site and verify your first pageview."
          icon={<Rocket className="h-4 w-4" />}
          art="stream"
        />
        <LinkCard
          href="/docs/frameworks"
          title="Framework guides"
          description="Follow an installation guide for your framework or CMS."
          icon={<Code2 className="h-4 w-4" />}
          art="steps"
        />
        <LinkCard
          href="/docs/frameworks/server-rendered"
          title="Server-rendered apps"
          description="Add TrackMe to a server-rendered application or template."
          icon={<BookOpen className="h-4 w-4" />}
          art="pulse"
        />
      </CardGrid>

      <H2>Go further</H2>
      <CardGrid cols={3}>
        <LinkCard
          href="/docs/tracking/events"
          title="Custom events"
          description="Record clicks, signups and purchases with properties."
          icon={<Zap className="h-4 w-4" />}
          art="ridge"
        />
        <LinkCard
          href="/docs/server-side"
          title="HTTP API"
          description="Send events from your backend in any language."
          icon={<Terminal className="h-4 w-4" />}
          art="stream"
        />
        <LinkCard
          href="/docs/privacy/consent"
          title="Consent & Do Not Track"
          description="Hold tracking until a visitor agrees."
          icon={<ShieldCheck className="h-4 w-4" />}
          art="gauge"
        />
      </CardGrid>
    </DocPage>
  );
}
