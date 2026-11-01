// Fetches the free DB-IP "City Lite" MMDB (CC BY 4.0, attribution: https://db-ip.com)
// into infra/geoip/. Tries the current month, then the two before it, since a month's
// file is published a little after the month starts.
import { createWriteStream } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "../infra/geoip/dbip-city-lite.mmdb");
await mkdir(path.dirname(target), { recursive: true });

const now = new Date();
for (let back = 0; back < 3; back += 1) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    console.log(`${month}: not available (${res.status})`);
    continue;
  }
  const tmp = `${target}.part`;
  await pipeline(res.body, createGunzip(), createWriteStream(tmp));
  await rename(tmp, target);
  console.log(`Saved ${month} database to ${target}`);
  console.log("Set GEOIP_MMDB_PATH=../../infra/geoip/dbip-city-lite.mmdb in .env");
  process.exit(0);
}
console.error("Could not download a DB-IP database.");
process.exit(1);
