export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-slate-200">
      <h1 className="text-3xl font-semibold text-white mb-4">Privacy overview</h1>
      <p className="text-sm leading-relaxed text-slate-400 mb-6">
        TrackMe is designed as a privacy-first analytics product: no third-party advertising
        cookies, rotating visitor pseudonyms, transient IP use for geo only, and configurable
        retention. This page is a product overview — replace it with counsel-reviewed policies
        before production launch.
      </p>
      <ul className="list-disc pl-5 space-y-2 text-sm text-slate-300">
        <li>Consent gate via <code>data-require-consent</code> + <code>growth.grantConsent()</code></li>
        <li>Do Not Track honored when enabled for a site</li>
        <li>Origin/Referer allowlisting and optional HMAC ingest signatures</li>
        <li>Scheduled retention cleanup in ClickHouse</li>
        <li>Workspace data region field for residency planning</li>
      </ul>
    </main>
  );
}
