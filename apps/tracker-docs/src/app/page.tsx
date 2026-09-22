export default function TrackerDocsPage() {
  return (
    <div style={{ maxWidth: 840, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>
          G
        </div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Developer & Tracker Documentation</h1>
      </div>

      <section style={{ marginBottom: 40 }}>
        <h2>1. Quickstart (HTML / Universal)</h2>
        <p style={{ color: "#94a3b8" }}>Add this snippet inside the <code>&lt;head&gt;</code> tag of your website:</p>
        <pre style={{ background: "#11131a", border: "1px solid #1e2230", padding: 16, borderRadius: 8, overflowX: "auto" }}>
          <code>{`<script defer src="https://cdn.growthintelligence.io/tracker.js" data-site="YOUR_SITE_KEY"></script>`}</code>
        </pre>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2>2. React / Next.js Integration</h2>
        <p style={{ color: "#94a3b8" }}>In Next.js App Router (<code>app/layout.tsx</code>):</p>
        <pre style={{ background: "#11131a", border: "1px solid #1e2230", padding: 16, borderRadius: 8, overflowX: "auto" }}>
          <code>{`import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <Script
          defer
          src="https://cdn.growthintelligence.io/tracker.js"
          data-site="YOUR_SITE_KEY"
          strategy="afterInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}`}</code>
        </pre>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2>3. Custom Event Tracking</h2>
        <p style={{ color: "#94a3b8" }}>Track custom events using the global window object:</p>
        <pre style={{ background: "#11131a", border: "1px solid #1e2230", padding: 16, borderRadius: 8, overflowX: "auto" }}>
          <code>{`window.growth.trackEvent("signup_completed", {
  plan: "pro",
  annual: true,
});`}</code>
        </pre>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2>4. Public Ingestion API Reference</h2>
        <p style={{ color: "#94a3b8" }}>You can also send events directly from your backend servers:</p>
        <pre style={{ background: "#11131a", border: "1px solid #1e2230", padding: 16, borderRadius: 8, overflowX: "auto" }}>
          <code>{`POST https://ingest.growthintelligence.io/v1/e
Content-Type: application/json

{
  "schemaVersion": 1,
  "eventId": "123e4567-e89b-12d3-a456-426614174000",
  "type": "pageview",
  "occurredAt": "2026-09-17T12:00:00.000Z",
  "siteKey": "YOUR_SITE_KEY",
  "sessionId": "sess_abc123",
  "visitorPseudonym": "vis_xyz789",
  "url": "https://yoursite.com/pricing",
  "path": "/pricing"
}`}</code>
        </pre>
      </section>
    </div>
  );
}

