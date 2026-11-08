/**
 * Re-encrypts every stored secret under the CURRENT key.
 *
 * Rotation runbook (docs/SECURITY_AUDIT.md, M3):
 *   1. Generate a new key (32+ random characters).
 *   2. Deploy with SITE_SIGNING_SECRET_KEY=<new> and SITE_SIGNING_SECRET_KEY_PREVIOUS=<old>
 *      (the web app and the ingestion edge both read the ring, so nothing stops working).
 *   3. Run this script (dry run by default):        npx tsx scripts/rotate-secrets.ts
 *      then apply:                                   npx tsx scripts/rotate-secrets.ts --apply
 *   4. Run it again; it should report 0 to re-encrypt. Then remove SITE_SIGNING_SECRET_KEY_PREVIOUS and redeploy.
 *
 * It also converts values stored before encryption existed (plaintext) and in the earlier v1 format.
 * It touches: sites.settings.signingSecret and alert_channels.config (webhookUrl, url, secret).
 */
import { alertChannels, db, eq, sites } from "@trackme/db";
import { decryptSecret, encryptSecret, needsReencrypt } from "../apps/web/src/lib/secret-box";

const apply = process.argv.includes("--apply");
const FIELDS = ["webhookUrl", "url", "secret"] as const;

async function main() {
  let sitesChanged = 0;
  let channelsChanged = 0;

  for (const site of await db.select({ id: sites.id, settings: sites.settings }).from(sites)) {
    const settings = site.settings as Record<string, unknown>;
    const stored = settings.signingSecret;
    if (typeof stored !== "string" || !needsReencrypt(stored)) continue;
    sitesChanged++;
    if (apply) {
      const plaintext = decryptSecret(stored)!;
      await db.update(sites).set({ settings: { ...settings, signingSecret: encryptSecret(plaintext) } }).where(eq(sites.id, site.id));
    }
  }

  for (const channel of await db.select({ id: alertChannels.id, config: alertChannels.config }).from(alertChannels)) {
    const config = { ...(channel.config as Record<string, unknown>) };
    let changed = false;
    for (const field of FIELDS) {
      const value = config[field];
      if (typeof value === "string" && value && needsReencrypt(value)) {
        config[field] = encryptSecret(decryptSecret(value)!);
        changed = true;
      }
    }
    if (!changed) continue;
    channelsChanged++;
    if (apply) await db.update(alertChannels).set({ config }).where(eq(alertChannels.id, channel.id));
  }

  console.log(`${apply ? "Re-encrypted" : "Would re-encrypt"}: ${sitesChanged} site signing secret(s), ${channelsChanged} alert channel(s).`);
  if (!apply && sitesChanged + channelsChanged > 0) console.log("Run again with --apply to do it.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
