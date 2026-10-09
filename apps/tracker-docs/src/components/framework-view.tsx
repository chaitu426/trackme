import * as React from "react";
import { CodeBlock } from "@/components/code-block";
import { Callout, CardGrid, H2, LinkCard, Step, Steps } from "@/components/doc";
import { Inline } from "@/components/inline";
import type { Framework, Step as StepData } from "@/lib/frameworks";

async function StepList({ steps }: { steps: StepData[] }) {
  return (
    <Steps>
      {steps.map((step) => (
        <Step key={step.title} title={step.title}>
          {step.body && (
            <p>
              <Inline text={step.body} />
            </p>
          )}
          {step.snippets?.map((snippet, index) => (
            <CodeBlock
              key={index}
              lang={snippet.lang}
              code={snippet.code}
              {...(snippet.filename ? { filename: snippet.filename } : {})}
            />
          ))}
        </Step>
      ))}
    </Steps>
  );
}

async function Section({ id, title, step }: { id: string; title: string; step: StepData }) {
  return (
    <>
      <H2 id={id}>{title}</H2>
      {step.body && (
        <p>
          <Inline text={step.body} />
        </p>
      )}
      {step.snippets?.map((snippet, index) => (
        <CodeBlock
          key={index}
          lang={snippet.lang}
          code={snippet.code}
          {...(snippet.filename ? { filename: snippet.filename } : {})}
        />
      ))}
    </>
  );
}

/** One framework guide. Every guide has the same sections so they scan the same way. */
export async function FrameworkView({ framework }: { framework: Framework }) {
  const facts: [string, string][] = [
    ["Language", framework.language],
    ["Install method", framework.method],
    ["Where you edit", framework.files],
    ["Pageviews", framework.routing],
  ];

  return (
    <>
      <div className="not-prose my-5 overflow-hidden rounded-xl border border-white/[0.08]">
        <dl className="divide-y divide-white/[0.06]">
          {facts.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
              <dt className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">{label}</dt>
              <dd className="text-[13.5px] leading-relaxed text-zinc-300">
                <Inline text={value} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {framework.moduleSteps && (
        <Callout type="tip" title="Two ways to install">
          <p>
            The <strong>script tag</strong> needs no build changes and is the recommended route. Prefer an{" "}
            <a href="#install-as-a-module">npm module</a> if you want the tracker in your bundle and under your own
            initialisation code.
          </p>
        </Callout>
      )}

      <H2 id="set-up">{framework.moduleSteps ? "Set up with the script tag" : "Set up"}</H2>
      <StepList steps={framework.steps} />

      {framework.moduleSteps && (
        <>
          <H2 id="install-as-a-module">Install as a module</H2>
          <StepList steps={framework.moduleSteps} />
        </>
      )}

      <Section id="track-events" title="Track events" step={framework.events} />
      {framework.identify && <Section id="identify-users" title="Identify users" step={framework.identify} />}
      {framework.consent && <Section id="consent" title="Consent" step={framework.consent} />}

      {framework.notes.length > 0 && (
        <>
          <H2 id="notes">Notes</H2>
          {framework.notes.map((note, index) => (
            <Callout key={index} type={note.type} {...(note.title ? { title: note.title } : {})}>
              <p>
                <Inline text={note.text} />
              </p>
            </Callout>
          ))}
        </>
      )}

      <H2 id="next-steps">Next steps</H2>
      <CardGrid>
        <LinkCard
          href="/docs/verify"
          title="Verify your installation"
          description="Confirm events reach the dashboard before you ship."
        />
        <LinkCard
          href="/docs/tracking/events"
          title="Custom events"
          description="Naming, properties and limits for the events you send."
        />
        <LinkCard
          href="/docs/privacy/consent"
          title="Consent & Do Not Track"
          description="Hold tracking until a visitor agrees."
        />
        <LinkCard
          href="/docs/reference/tracker-api"
          title="Tracker API"
          description="Every method and option."
        />
      </CardGrid>
    </>
  );
}
