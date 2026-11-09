import type { Metadata } from "next";
import { LegalDoc, type LegalSection } from "@/components/legal-doc";

export const metadata: Metadata = { title: "Privacy overview" };

const sections: LegalSection[] = [
  {
    id: "collected",
    title: "What is collected",
    body: (
      <>
        <p>For each site that installs the tag, TrackMe records what the visitor's browser reports about the visit:</p>
        <ul>
          <li>Pageviews with the path and title, and the referrer</li>
          <li>Events your site sends, such as signups or purchases</li>
          <li>Web Vitals (load and responsiveness timings), when the site has them on</li>
          <li>Errors the page throws, when the site turns error capture on</li>
          <li>Browser, operating system and device type from the user agent, and the country</li>
        </ul>
      </>
    ),
  },
  {
    id: "not-collected",
    title: "What is not collected",
    body: (
      <>
        <p>TrackMe sets no tracking cookies. The IP address is read once to work out the country and is then discarded, never stored with the event.</p>
        <p>Anonymous visitors are told apart by a pseudonym that changes every 24 hours, so the same person cannot be followed from one day to the next unless your site chooses to identify them.</p>
      </>
    ),
  },
  {
    id: "identified",
    title: "People you identify",
    body: (
      <>
        <p>
          If your site calls <code>trackme.identify()</code>, the user ID and traits you pass are stored against that person's events. Which ID you send, and whether you have a lawful basis to,
          is your decision as the site owner. Data about an identified person can be erased on request.
        </p>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payment data",
    body: (
      <>
        <p>When you connect a payment gateway, TrackMe receives signed webhooks and keeps the amount, currency, payment method type, status, bank or provider name and the gateway's failure code.</p>
        <p>It never keeps card numbers, UPI IDs, email addresses or phone numbers. Webhook signing secrets are stored encrypted and are not shown again after they are saved.</p>
      </>
    ),
  },
  {
    id: "consent",
    title: "Consent and Do Not Track",
    body: (
      <>
        <p>
          A site can hold the tracker idle until its own consent banner calls <code>trackme.grantConsent()</code> by turning on <code>data-require-consent</code>. When the site enables it, visitors
          who send Do Not Track or Global Privacy Control are not recorded at all.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long data is kept",
    body: (
      <>
        <p>Each site chooses how long raw events are kept: 12, 24 or 36 months. A scheduled job removes older data. Some data is kept for a fixed time regardless:</p>
        <ul>
          <li>Individual error events: 30 days. Error counts per day: 12 months</li>
          <li>Normalised payment events: 25 months. Raw webhook payloads: 90 days</li>
        </ul>
      </>
    ),
  },
  {
    id: "security",
    title: "How access is controlled",
    body: (
      <>
        <p>
          Every query is limited to the workspace that owns the site. Sites can reject events whose origin does not match their hostname and can require events to be signed by their own backend.
          Changes to members, keys and settings are recorded in the workspace's audit log.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy overview"
      lede="TrackMe is analytics without tracking cookies. This page describes what the product does with data, in plain words."
      note={
        <>
          This describes how the product behaves; it is not a signed agreement. For a contract with your customers, see the <a className="text-zinc-300 underline underline-offset-4" href="/legal/dpa">Data Processing Addendum</a>{" "}
          outline.
        </>
      }
      sections={sections}
    />
  );
}
