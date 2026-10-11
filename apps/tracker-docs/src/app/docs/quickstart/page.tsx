import { CodeBlock } from "@/components/code-block";
import { Callout, H2, Step, Steps } from "@/components/doc";
import { DocPage, pageMetadata } from "@/components/doc-page";

export const metadata = pageMetadata("/docs/quickstart");

const snippet = `<script
  defer
  src="https://app.example.com/tracker.js"
  data-site="YOUR_SITE_KEY"
  data-endpoint="https://ingest.example.com/v1/batch"
></script>`;

export default function QuickstartPage() {
  return (
    <DocPage href="/docs/quickstart">
      <p>
        Add one script tag to your site, then check the realtime view in your dashboard. The same snippet works on
        static pages and most frameworks.
      </p>

      <Steps>
        <Step title="Create a site">
          <p>
            In the TrackMe dashboard, create a site for the domain you want to measure. Copy its site key and the
            tracker and ingestion URLs for your deployment.
          </p>
        </Step>
        <Step title="Add the tracker">
          <p>
            Place the script in your page head and replace the example values with the ones from your dashboard:
          </p>
          <CodeBlock lang="html" filename="index.html" code={snippet} />
        </Step>
        <Step title="Verify events">
          <p>
            Publish the page, visit it yourself, and open the site&apos;s realtime dashboard. Your visit should appear
            shortly after the page loads.
          </p>
        </Step>
      </Steps>

      <Callout type="tip" title="Using a framework?">
        <p>
          See the <a href="/docs/frameworks">framework guides</a> for where to place the script in Next.js, React, Vue,
          and other supported platforms.
        </p>
      </Callout>

      <H2>What the script does</H2>
      <p>
        The tracker loads with <code>defer</code>, records pageviews and single-page navigation, and batches events to
        your configured ingestion endpoint. It does not require analytics cookies.
      </p>
    </DocPage>
  );
}
