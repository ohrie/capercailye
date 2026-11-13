#!/usr/bin/env bash
# Build capercailye vector tiles (PMTiles) from an OSM extract with Planetiler.
#
# Usage: tiles/build.sh [input.osm.pbf] [area-name]
#   input     default: $CAPERCAILYE_DATA/baden-wuerttemberg-latest.osm.pbf
#   area-name default: derived from the input file name (baden-wuerttemberg → bw, rheinland-pfalz → rp)
# Output: $CAPERCAILYE_DATA/capercailye-<area>.pmtiles
# Env:    JAVA_XMX (heap, default 4g), PLANETILER_VERSION (default: latest release),
#         extra Planetiler args may follow after "--", e.g. build.sh in.pbf de -- --threads=8
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${CAPERCAILYE_DATA:-$HOME/.local/share/capercailye}"
INPUT="${1:-$DATA_DIR/baden-wuerttemberg-latest.osm.pbf}"
shift || true
AREA="${1:-}"
[[ $# -gt 0 ]] && shift
[[ "${1:-}" == "--" ]] && shift

if [[ -z "$AREA" ]]; then
  base="$(basename "$INPUT")"
  base="${base%%-latest*}"
  base="${base%%.osm.pbf}"
  case "$base" in
    baden-wuerttemberg) AREA=bw ;;
    rheinland-pfalz) AREA=rp ;;
    germany) AREA=de ;;
    europe) AREA=eu ;;
    *) AREA="$base" ;;
  esac
fi

OUTPUT="$DATA_DIR/capercailye-$AREA.pmtiles"
JAR="$DATA_DIR/planetiler.jar"
TMP="$DATA_DIR/tmp"
mkdir -p "$DATA_DIR" "$TMP"

[[ -f "$INPUT" ]] || { echo "input not found: $INPUT" >&2; exit 1; }

if [[ ! -f "$JAR" ]]; then
  if [[ -n "${PLANETILER_VERSION:-}" ]]; then
    url="https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"
  else
    url="https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar"
  fi
  echo "downloading $url"
  curl -fL --retry 3 -o "$JAR.part" "$url"
  mv "$JAR.part" "$JAR"
fi

echo "input:  $INPUT"
echo "output: $OUTPUT"
start=$(date +%s)
java -Xmx"${JAVA_XMX:-4g}" -cp "$JAR" "$SCRIPT_DIR/CapercailyeProfile.java" \
  --input="$INPUT" \
  --output="$OUTPUT" \
  --tmpdir="$TMP" \
  --minzoom=0 --maxzoom=14 \
  --storage=mmap --nodemap-type=sparsearray \
  --output-layerstats \
  "$@"
echo "done in $(( $(date +%s) - start )) s: $(du -h "$OUTPUT" | cut -f1) $OUTPUT"
