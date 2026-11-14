#!/usr/bin/env bash
# Wöchentlicher Neuaufbau: OSM-Auszug laden, Kacheln und Bushaltestellen bauen, prüfen, in live/ tauschen.
# Die Dateien in live/ bleiben unberührt, solange nicht alles gebaut und geprüft ist.
#
# Aufruf: update.sh            (Zeitplan: crontab; von Hand: siehe deploy/README.md)
# Env (alle optional):
#   ROOT            Datenverzeichnis mit live/ und work/            (/srv/capercailye)
#   PBF_URL         OSM-Auszug; Geofabrik liefert <URL>.md5 mit      (…/europe/germany-latest.osm.pbf)
#   AREA            Gebietskürzel im Dateinamen capercailye-<AREA>.pmtiles   (de)
#   JAVA_XMX        Java-Heap für Planetiler                         (6g)
#   THREADS         Planetiler-Threads                               (nproc)
#   MIN_FREE_GB     Abbruch, wenn auf ROOT weniger frei ist          (60)
#   BUSSTOPS        1 = Bushaltestellen mitbauen, 0 = überspringen   (1)
#   GTFS_REFRESH    auto = Feed nur laden, wenn keiner da ist oder ein neuer Fahrplan begonnen hat (s. u.),
#                   1 = immer neu laden, 0 = nie laden (vorhandenen nutzen)   (auto)
#   TODAY           YYYYMMDD, "heute" für die Regel unten (nur zum Testen)
#   HEALTHCHECK_URL Optional; Ping bei Erfolg, <URL>/fail bei Fehler
#   TILES_DIR, TRANSIT_DIR  Skripte tiles/ und transit/              (/opt/capercailye/…)
#
# Bushaltestellen: Der GTFS-Feed (gtfs.de) wird nur geladen, wenn in work/gtfs noch keiner liegt oder
# der neueste älter ist als der letzte Fahrplanwechsel (15. Dezember). Die Haltestellen-PMTiles werden
# nur neu gebaut, wenn so ein Feed geladen wird oder live/capercailye-busstops.pmtiles fehlt.
# Das Datum des Feeds steht im Verzeichnisnamen work/gtfs/de_full-YYYYMMDD (Last-Modified, setzt transit/build.sh).
set -euo pipefail
umask 022

ROOT="${ROOT:-/srv/capercailye}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/europe/germany-latest.osm.pbf}"
AREA="${AREA:-de}"
JAVA_XMX="${JAVA_XMX:-6g}"
THREADS="${THREADS:-$(nproc)}"
MIN_FREE_GB="${MIN_FREE_GB:-60}"
BUSSTOPS="${BUSSTOPS:-1}"
GTFS_REFRESH="${GTFS_REFRESH:-auto}"
TODAY="${TODAY:-$(date +%Y%m%d)}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
TILES_DIR="${TILES_DIR:-/opt/capercailye/tiles}"
TRANSIT_DIR="${TRANSIT_DIR:-/opt/capercailye/transit}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LIVE="$ROOT/live"
WORK="$ROOT/work"
BUILD="$WORK/build"
PREV="$WORK/prev"
LOGS="$WORK/logs"
GTFS="$WORK/gtfs"
PBF="$WORK/$(basename "$PBF_URL")"
UA=capercailye-updater

mkdir -p "$LIVE" "$BUILD" "$PREV" "$LOGS" "$GTFS"

# Nur ein Lauf gleichzeitig (Zeitplan und Handlauf)
exec 9>"$WORK/update.lock"
if ! flock -n 9; then
  echo "update.sh: es läuft schon ein Update (Sperre $WORK/update.lock), abgebrochen." >&2
  exit 1
fi

# Ausgabe in die Konsole und in work/logs/ (die neuesten 8 bleiben)
LOG="$LOGS/update-$(date +%Y%m%d-%H%M).log"
exec > >(tee -a "$LOG") 2>&1
ls -1t "$LOGS"/update-*.log 2>/dev/null | tail -n +9 | xargs -r rm -f -- || true

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

# --- Zeitmessung je Schritt, Speicher-Spitze über /usr/bin/time, falls vorhanden --------------
STEPS=()
T0=$SECONDS
HAVE_TIME=0
[[ -x /usr/bin/time ]] && HAVE_TIME=1

# timed <name> <befehl…>: führt aus, merkt Dauer und (falls möglich) größten RSS; gibt den Status des Befehls zurück
timed() {
  local name="$1" start=$SECONDS rc=0 tf="$WORK/.time-$1" rss=""
  shift
  if [[ $HAVE_TIME -eq 1 ]]; then
    /usr/bin/time -v -o "$tf" "$@" || rc=$?
    rss="$(awk -F': ' '/Maximum resident set size/{printf "%.1f GB RSS", $2/1048576}' "$tf" 2>/dev/null || true)"
    rm -f "$tf"
  else
    "$@" || rc=$?
  fi
  STEPS+=("$(printf '%-12s %5d s  %s%s' "$name" $((SECONDS - start)) "$rss" "$([[ $rc -ne 0 ]] && echo ' (fehlgeschlagen)')")")
  return "$rc"
}

# kleine Schritte ohne Speichermessung
mark() { STEPS+=("$(printf '%-12s %5d s' "$1" $((SECONDS - $2)))"); }

ping_health() { # ping_health [/fail]; ein Fehlschlag des Pings lässt das Skript nie scheitern
  [[ -n "$HEALTHCHECK_URL" ]] || return 0
  curl -fsS -m 10 --retry 3 -A "$UA" -o /dev/null "${HEALTHCHECK_URL%/}${1:-}" ||
    log "Warnung: Healthcheck-Ping ${1:-} fehlgeschlagen"
  return 0
}

on_exit() {
  local rc=$?
  trap - EXIT
  rm -rf "$BUILD/tmp"
  echo
  log "Zusammenfassung ($((SECONDS - T0)) s gesamt):"
  (( ${#STEPS[@]} == 0 )) || printf '  %s\n' "${STEPS[@]}"
  if [[ $rc -eq 0 ]]; then
    for f in "$LIVE"/*.pmtiles; do [[ -e "$f" ]] && printf '  live: %s  %s\n' "$(du -h "$f" | cut -f1)" "$(basename "$f")"; done
    log "Update fertig."
    ping_health
  else
    log "FEHLER: Update abgebrochen (Status $rc), live/ ist unverändert. Log: $LOG"
    ping_health /fail
  fi
  exit "$rc"
}
trap on_exit EXIT

# --- GTFS: wann ist ein neuer Feed fällig? -------------------------------------------------------
# gtfs_decide <gtfs-dir> <heute YYYYMMDD> <auto|1|0>: Status 0 = Feed neu laden, 1 = nicht;
# GTFS_WHY enthält die Begründung. Grenze = letzter 15. Dezember (Fahrplanwechsel).
gtfs_decide() {
  local dir="$1" today="$2" mode="$3" year newest feed cutoff
  case "$mode" in
    1) GTFS_WHY="GTFS_REFRESH=1 erzwingt neuen Feed"; return 0 ;;
    0) GTFS_WHY="GTFS_REFRESH=0: kein neuer Feed"; return 1 ;;
  esac
  newest="$(ls -d "$dir"/de_full-* 2>/dev/null | sort | tail -n1 || true)"
  year="${today:0:4}"
  (( 10#${today:4:4} >= 1215 )) || year=$((year - 1))
  cutoff="${year}1215"
  if [[ -z "$newest" ]]; then
    GTFS_WHY="noch kein Feed vorhanden"; return 0
  fi
  feed="$(basename "$newest")"; feed="${feed#de_full-}"
  if [[ ! "$feed" =~ ^[0-9]{8}$ ]]; then
    GTFS_WHY="Feed-Datum aus '$newest' nicht lesbar"; return 0
  fi
  if (( feed < cutoff )); then
    GTFS_WHY="neuester Feed $feed ist älter als der letzte Fahrplanwechsel $cutoff"; return 0
  fi
  GTFS_WHY="neuester Feed $feed ist nicht älter als der letzte Fahrplanwechsel $cutoff"; return 1
}
# --- Ende gtfs_decide ---

log "Start: ROOT=$ROOT AREA=$AREA PBF_URL=$PBF_URL JAVA_XMX=$JAVA_XMX THREADS=$THREADS BUSSTOPS=$BUSSTOPS GTFS_REFRESH=$GTFS_REFRESH TODAY=$TODAY"

# --- 1. Plattenplatz; Reste früherer Läufe wegräumen ------------------------------------------
rm -rf "$BUILD/tmp" "$WORK/.time-"* "$PBF.part"
rm -f "$BUILD"/capercailye-*
avail_kb="$(df -Pk "$ROOT" | awk 'NR==2{print $4}')"
if (( avail_kb < MIN_FREE_GB * 1048576 )); then
  log "zu wenig Plattenplatz: $((avail_kb / 1048576)) GB frei, gebraucht werden $MIN_FREE_GB GB (MIN_FREE_GB)"
  exit 1
fi
log "Plattenplatz: $((avail_kb / 1048576)) GB frei"

# --- 2. OSM-Auszug laden (nur wenn neuer) und mit der .md5 des Servers prüfen -------------------
step_start=$SECONDS
curl_args=(-fsSL --retry 3 -A "$UA" -R -o "$PBF.part")
[[ -f "$PBF" ]] && curl_args+=(-z "$PBF")
log "Download: $PBF_URL"
curl "${curl_args[@]}" "$PBF_URL"
if [[ -s "$PBF.part" ]]; then
  log "neuer Auszug geladen ($(du -h "$PBF.part" | cut -f1)), prüfe md5"
  expected="$(curl -fsSL --retry 3 -A "$UA" "$PBF_URL.md5" | awk '{print $1; exit}')"
  actual="$(md5sum "$PBF.part" | awk '{print $1}')"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    rm -f "$PBF.part"
    log "md5 stimmt nicht (erwartet '${expected:-?}', berechnet $actual)"
    exit 1
  fi
  mv -f "$PBF.part" "$PBF"
else
  rm -f "$PBF.part"
  log "Auszug unverändert (nicht neuer als $PBF), keine neue Datei geladen"
fi
mark download "$step_start"

# --- 3. Kacheln -----------------------------------------------------------------------------
log "Kacheln bauen (Planetiler, Heap $JAVA_XMX)"
JAVA_XMX="$JAVA_XMX" CAPERCAILYE_DATA="$BUILD" \
  timed tiles nice -n 10 "$TILES_DIR/build.sh" "$PBF" "$AREA" -- --threads="$THREADS"
rm -rf "$BUILD/tmp"   # Planetiler-Zwischendateien (viele GB) vor den Bushaltestellen freigeben
FILES=("capercailye-$AREA.pmtiles")

# --- 4. Bushaltestellen (Fehler hier lassen die alten Haltestellen stehen) ------------------------
if [[ "$BUSSTOPS" == "1" ]]; then
  build_busstops=0
  refresh=()
  if gtfs_decide "$GTFS" "$TODAY" "$GTFS_REFRESH"; then
    refresh=(--refresh)
    build_busstops=1
    log "Haltestellen: neuer Feed wird geladen ($GTFS_WHY)"
  elif [[ ! -e "$LIVE/capercailye-busstops.pmtiles" ]]; then
    build_busstops=1
    log "Haltestellen: $GTFS_WHY; es gibt aber noch keine Haltestellen-Datei in live/, baue aus dem vorhandenen Feed"
  else
    log "Haltestellen: kein neuer Fahrplan, übersprungen ($GTFS_WHY)"
  fi
  if [[ $build_busstops -eq 1 ]]; then
    log "Bushaltestellen bauen"
    if GTFS_DIR="$GTFS" CAPERCAILYE_DATA="$BUILD" timed busstops "$TRANSIT_DIR/build.sh" "${refresh[@]}"; then
      FILES+=("capercailye-busstops.pmtiles")
      # nur den neuesten Feed behalten (rm -rf auf einen Symlink entfernt nur den Link)
      mapfile -t feeds < <(ls -d "$GTFS"/de_full-* 2>/dev/null | sort)
      if (( ${#feeds[@]} > 1 )); then
        for old in "${feeds[@]:0:${#feeds[@]}-1}"; do
          log "alter GTFS-Feed entfernt: $old"
          rm -rf -- "$old"
        done
      fi
    else
      log "Warnung: Bushaltestellen fehlgeschlagen, die alte Datei bleibt in live/"
      rm -f "$BUILD/capercailye-busstops.pmtiles"
    fi
  fi
else
  log "Bushaltestellen übersprungen (BUSSTOPS=$BUSSTOPS)"
fi
rm -rf "$BUILD/tmp"

# --- 5. Prüfen (alles, bevor etwas getauscht wird) ---------------------------------------------
step_start=$SECONDS
for f in "${FILES[@]}"; do
  live_arg=()
  [[ -e "$LIVE/$f" ]] && live_arg=("$LIVE/$f")
  bun "$SCRIPT_DIR/check.ts" "$BUILD/$f" "${live_arg[@]}"
done
mark check "$step_start"

# --- 6. Tauschen: alte Datei als harter Link nach prev/ (Rollback), neue per rename() nach live/ -------
for f in "${FILES[@]}"; do
  [[ -e "$LIVE/$f" ]] && ln -f "$LIVE/$f" "$PREV/$f"
  mv -f "$BUILD/$f" "$LIVE/$f"
  log "getauscht: $f ($(du -h "$LIVE/$f" | cut -f1))"
done
