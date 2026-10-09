import { Braces, Code2, Globe, Server, Terminal } from "lucide-react";
import { DocPage, pageMetadata } from "@/components/doc-page";
import { Callout, CardGrid, H2, LinkCard } from "@/components/doc";
import { FRAMEWORKS } from "@/lib/frameworks";

export const metadata = pageMetadata("/docs/frameworks");

export default function FrameworksIndex() {
  const frameworks = FRAMEWORKS.filter((f) => f.group === "Frameworks");
  const platforms = FRAMEWORKS.filter((f) => f.group === "Platforms & CMS");

  return (
    <DocPage href="/docs/frameworks">
      <p>
        TrackMe is a single script. Every guide below ends with the same result: a tag that loads{" "}
        <code>tracker.js</code> with your site key and collector URL. What changes is where you put it and how you call
        the API from that framework.
      </p>

      <Callout type="tip" title="Not listed?">
        <p>
          If your stack can output a <code>&lt;script&gt;</code> tag in the page head, it works. Start with{" "}
          <a href="/docs/frameworks/html">HTML &amp; static sites</a>. Client-side routers that use the browser History
          API are tracked without any extra code.
        </p>
      </Callout>

      <H2>Frameworks</H2>
      <CardGrid cols={3}>
        {frameworks.map((framework) => (
          <LinkCard
            key={framework.slug}
            href={`/docs/frameworks/${framework.slug}`}
            title={framework.name}
            description={framework.tagline}
            icon={<Code2 className="h-4 w-4" />}
          />
        ))}
        <LinkCard
          href="/docs/frameworks/server-rendered"
          title="Server-rendered apps"
          description="Laravel, Rails, Django, Spring, ASP.NET, Express, Phoenix and Go templates."
          icon={<Server className="h-4 w-4" />}
        />
      </CardGrid>

      <H2>Platforms &amp; CMS</H2>
      <CardGrid cols={3}>
        {platforms.map((platform) => (
          <LinkCard
            key={platform.slug}
            href={`/docs/frameworks/${platform.slug}`}
            title={platform.name}
            description={platform.tagline}
            icon={<Globe className="h-4 w-4" />}
          />
        ))}
      </CardGrid>

      <H2>From your backend</H2>
      <CardGrid>
        <LinkCard
          href="/docs/server-side"
          title="HTTP API from any language"
          description="Send events from cURL, Node.js, Python, Go, PHP, Ruby, Java or C# when the action happens on the server."
          icon={<Terminal className="h-4 w-4" />}
        />
        <LinkCard
          href="/docs/reference/tracker-api"
          title="JavaScript tracker API"
          description="Constructor options and every method, if you want to use the module directly."
          icon={<Braces className="h-4 w-4" />}
        />
      </CardGrid>
    </DocPage>
  );
}
