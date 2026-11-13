#!/usr/bin/env bash
# Bushaltestellen aus dem gesamtdeutschen GTFS-Feed (gtfs.de, de_full) nach PMTiles.
#
# Aufruf: transit/build.sh [--refresh] [-- <Optionen fuer busstops.ts>]
#   z. B.  transit/build.sh
#          transit/build.sh -- --min 6 --bbox 7.5,47.5,10.5,49.8
#          transit/build.sh --refresh        # Feed neu laden (sonst wird der zuletzt geladene benutzt)
# Ausgabe: $CAPERCAILYE_DATA/capercailye-busstops.pmtiles (+ .geojsonl, + Statistik in tmp/)
# Env:     GTFS_URL (Standard: gtfs.de de_full, kostenlose Basisversion), CAPERCAILYE_DATA, GTFS_DIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${CAPERCAILYE_DATA:-$HOME/.local/share/capercailye}"
GTFS_ROOT="${GTFS_DIR:-$DATA_DIR/gtfs}"
GTFS_URL="${GTFS_URL:-https://download.gtfs.de/germany/free/latest.zip}"
REFRESH=0
[[ "${1:-}" == "--refresh" ]] && { REFRESH=1; shift; }
[[ "${1:-}" == "--" ]] && shift

mkdir -p "$DATA_DIR/tmp" "$GTFS_ROOT"

# Neuester bereits geladener Feed (Verzeichnis de_full-YYYYMMDD mit entpacktem data/).
latest_dir() { ls -d "$GTFS_ROOT"/de_full-*/ 2>/dev/null | sort | tail -n1 | sed 's:/$::'; }
FEED_DIR="$(latest_dir || true)"

if [[ $REFRESH -eq 1 || -z "$FEED_DIR" ]]; then
  # Stand des Feeds aus dem HTTP-Kopf (Last-Modified), Groesse vorab ausgeben
  hdr="$(curl -sIL "$GTFS_URL")"
  size="$(printf '%s' "$hdr" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-length"{v=$2} END{print v}')"
  lm="$(printf '%s' "$hdr" | tr -d '\r' | awk -F': ' 'tolower($1)=="last-modified"{sub(/^[^:]*: /,"");v=$0} END{print v}')"
  stamp="$(date -u -d "$lm" +%Y%m%d)"
  FEED_DIR="$GTFS_ROOT/de_full-$stamp"
  echo "GTFS: $GTFS_URL ($((size / 1048576)) MiB, Stand $lm)" >&2
  if [[ ! -d "$FEED_DIR/data" ]]; then
    avail_kb="$(df -Pk "$GTFS_ROOT" | awk 'NR==2{print $4}')"
    (( avail_kb > 8 * 1048576 )) || { echo "zu wenig Plattenplatz (< 8 GiB frei)" >&2; exit 1; }
    mkdir -p "$FEED_DIR"
    curl -fL --retry 3 -o "$FEED_DIR/gtfs-de_full.zip" "$GTFS_URL"
    unzip -q -o "$FEED_DIR/gtfs-de_full.zip" -d "$FEED_DIR/data"
  fi
fi
echo "GTFS-Verzeichnis: $FEED_DIR/data" >&2

GEOJSONL="$DATA_DIR/capercailye-busstops.geojsonl"
OUT="$DATA_DIR/capercailye-busstops.pmtiles"

bun "$SCRIPT_DIR/busstops.ts" --gtfs "$FEED_DIR/data" --out "$GEOJSONL" \
  --stats "$DATA_DIR/tmp/busstops-stats.json" "$@"

# Schema (fest, mit dem Stil abgestimmt): Layer bus_stop, Punkte, z10-14, keine Ausduennung.
tippecanoe -q --force -o "$OUT" -l bus_stop -Z10 -z14 -r1 \
  --no-feature-limit --no-tile-size-limit \
  -n "capercailye bus stops" \
  -A "Fahrplandaten: DELFI e.V. / gtfs.de, CC BY 4.0" \
  "$GEOJSONL" >&2
ls -l "$OUT" >&2
