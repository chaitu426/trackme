#!/usr/bin/env bash
# Downloads a free DB-IP country lite MMDB for edge geo enrichment.
# IP is used transiently at ingest and never stored on events.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/infra/geoip"
mkdir -p "$OUT_DIR"

YM="$(date -u +%Y-%m)"
URL="https://download.db-ip.com/free/dbip-country-lite-${YM}.mmdb.gz"
TMP="$(mktemp)"

echo "Fetching ${URL}"
if ! curl -fsSL -o "$TMP" "$URL"; then
  # fall back to previous month
  YM="$(date -u -d 'last month' +%Y-%m 2>/dev/null || date -u -v-1m +%Y-%m)"
  URL="https://download.db-ip.com/free/dbip-country-lite-${YM}.mmdb.gz"
  echo "Retry ${URL}"
  curl -fsSL -o "$TMP" "$URL"
fi

gunzip -c "$TMP" > "${OUT_DIR}/country.mmdb"
rm -f "$TMP"
echo "Wrote ${OUT_DIR}/country.mmdb"
echo "Set GEOIP_MMDB_PATH=${OUT_DIR}/country.mmdb"
