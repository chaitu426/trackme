export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-200">
      <h1 className="mb-4 text-title font-medium text-zinc-50">Privacy overview</h1>
      <p className="text-sm leading-relaxed text-zinc-400 mb-6">
        TrackMe is a privacy-first analytics product: it sets no tracking cookies, uses visitor
        pseudonyms that rotate every 24 hours, reads the IP address only to find the country and
        then discards it, and lets each site configure how long data is kept.
      </p>
      <ul className="list-disc pl-5 space-y-2 text-sm text-zinc-300">
        <li>Consent gate via <code>data-require-consent</code> + <code>growth.grantConsent()</code></li>
        <li>Do Not Track honored when enabled for a site</li>
        <li>Origin/Referer allowlisting and optional HMAC ingest signatures</li>
        <li>Scheduled retention cleanup in ClickHouse</li>
              </ul>
    </main>
  );
}
