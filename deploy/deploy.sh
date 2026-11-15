#!/usr/bin/env bash
# Deploy vom Entwicklungsrechner auf den Server (ohne Registry, ohne CI):
#   git archive HEAD → scp → auf dem Server entpacken, Image dort bauen (native Architektur), starten.
#
# Aufruf: deploy/deploy.sh [Optionen]
#   --allow-dirty   trotz uncommitteter Änderungen an versionierten Dateien deployen
#                   (deployt trotzdem nur den committeten HEAD, die Änderungen bleiben außen vor)
#   --no-up         Archiv hochladen und app/ austauschen, aber nichts bauen/starten
#   --update-now    nach dem Start einen Daten-Update im Hintergrund anstoßen
#                   (OSM-Auszug laden, Kacheln bauen; sonst erst Dienstag 02:23)
#   -h, --help      diese Hilfe
# Einstellungen (Umgebung hat Vorrang vor deploy/deploy.env, Vorlage: deploy/deploy.env.example):
#   DEPLOY_HOST     ssh-Ziel, Pflicht (Host oder Alias aus ~/.ssh/config)
#   DEPLOY_DIR      Verzeichnis auf dem Server (/srv/capercailye); dort muss .env liegen, siehe deploy/README.md
set -euo pipefail

tmp=""

usage() { sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "${BASH_SOURCE[0]}"; }

# Skript für den Server, wird über ssh auf stdin an bash geschickt.
# Argumente: DIR SHA TARBALL UP(0|1) UPDATE_NOW(0|1). DOCKER=echo für Trockenläufe.
remote_script() {
  cat <<'REMOTE'
set -euo pipefail
dir=$1 sha=$2 tarball=$3 up=$4 update_now=$5
docker="${DOCKER:-docker}"
trap 'rm -f "$tarball"' EXIT

if [ ! -f "$dir/.env" ]; then
  echo "FEHLER: $dir/.env fehlt. Vorlage kopieren und anpassen:" >&2
  echo "  scp deploy/.env.example <host>:$dir/.env   (dann dort DOMAIN usw. prüfen)" >&2
  exit 1
fi
if [ ! -f "$tarball" ]; then
  echo "FEHLER: $tarball nicht gefunden" >&2
  exit 1
fi

cd "$dir"
mkdir -p live work

# Entpacken in app.new/, dann tauschen: app → app.prev (der vorletzte Stand wird gelöscht)
rm -rf app.new
mkdir app.new
tar -xzf "$tarball" -C app.new
echo "$sha" > app.new/REVISION
rm -rf app.prev
if [ -d app ]; then mv app app.prev; fi
mv app.new app
echo "app/ ist jetzt Revision $sha (vorher: app.prev/)"

if [ "$up" = 1 ]; then
  cd app/deploy
  "$docker" compose --env-file "$dir/.env" up -d --build </dev/null
  "$docker" compose --env-file "$dir/.env" ps </dev/null
  if [ "$update_now" = 1 ]; then
    "$docker" compose --env-file "$dir/.env" exec -d updater /opt/capercailye/update.sh </dev/null
    echo "Daten-Update im Hintergrund gestartet."
    sleep 3
  fi
else
  echo "--no-up: nichts gebaut oder gestartet. Starten: cd $dir/app/deploy && docker compose --env-file $dir/.env up -d --build"
fi
REMOTE
}

main() {
  local allow_dirty=0 up=1 update_now=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --allow-dirty) allow_dirty=1 ;;
      --no-up) up=0 ;;
      --update-now) update_now=1 ;;
      -h | --help) usage; exit 0 ;;
      *) echo "Unbekannte Option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
  if [ "$up" = 0 ] && [ "$update_now" = 1 ]; then
    echo "--update-now braucht den laufenden Updater-Container, passt nicht zu --no-up." >&2
    exit 2
  fi

  local here env_host env_dir
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  env_host="${DEPLOY_HOST:-}" env_dir="${DEPLOY_DIR:-}"
  if [ -f "$here/deploy.env" ]; then
    # shellcheck source=/dev/null
    . "$here/deploy.env"
  fi
  DEPLOY_HOST="${env_host:-${DEPLOY_HOST:-}}"
  DEPLOY_DIR="${env_dir:-${DEPLOY_DIR:-/srv/capercailye}}"
  if [ -z "$DEPLOY_HOST" ]; then
    echo "DEPLOY_HOST ist nicht gesetzt. In deploy/deploy.env eintragen (Vorlage: deploy/deploy.env.example)" >&2
    echo "oder als Umgebungsvariable übergeben: DEPLOY_HOST=mein-server deploy/deploy.sh" >&2
    exit 2
  fi

  cd "$(git -C "$here" rev-parse --show-toplevel)"

  local sha dirty
  sha="$(git rev-parse --short HEAD)"
  # Nur versionierte Dateien: untracked ist egal, gehört nicht ins Archiv
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ -n "$dirty" ]; then
    if [ "$allow_dirty" = 0 ]; then
      echo "Abbruch: uncommittete Änderungen an versionierten Dateien:" >&2
      echo "$dirty" >&2
      echo "Committen oder mit --allow-dirty deployen (dann nur der committete HEAD)." >&2
      exit 1
    fi
    echo "ACHTUNG: --allow-dirty. Deployt wird nur der committete HEAD $sha;"
    echo "diese Änderungen sind NICHT dabei:"
    echo "$dirty"
  fi

  local name
  tmp="$(mktemp -d)"
  trap '[ -z "$tmp" ] || rm -rf "$tmp"' EXIT
  name="capercailye-$sha.tar.gz"

  echo "Deploy: Commit $sha -> $DEPLOY_HOST:$DEPLOY_DIR"
  git archive --format=tar.gz -o "$tmp/$name" HEAD
  scp -o BatchMode=yes "$tmp/$name" "$DEPLOY_HOST:$DEPLOY_DIR/"

  local args
  printf -v args '%q ' "$DEPLOY_DIR" "$sha" "$DEPLOY_DIR/$name" "$up" "$update_now"
  remote_script | ssh -o BatchMode=yes "$DEPLOY_HOST" "bash -s -- $args"

  echo "Fertig: Revision $sha auf $DEPLOY_HOST."
  if [ "$update_now" = 1 ]; then
    local logdir
    printf -v logdir '%q' "$DEPLOY_DIR/work/logs"
    echo "Log verfolgen:"
    echo "  ssh $DEPLOY_HOST 'tail -n +1 -f \"\$(ls -t $logdir/update-*.log | head -1)\"'"
  fi
}

# Nur ausführen, nicht beim source (Tests)
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
