# deploy/ – Betrieb mit Docker Compose

Die Karten-App läuft als ein nginx-Container (`web`) hinter **Traefik**: Landingpage unter `/`, App unter `/app/`, PMTiles unter `/app/data/`. Plan und
Hintergründe: [../DEPLOY-PLAN.md](../DEPLOY-PLAN.md).

```
compose.yaml        Dienste web (Traefik-Labels, Volume mit den PMTiles) und updater
compose.local.yaml  Zusatz für lokale Tests: Wegwerf-Traefik auf http://localhost:8080
.env.example        Vorlage für deploy/.env
web/Dockerfile      Bun-Build der App + Landingpage mit eingetragener Domain → nginx
web/nginx.conf      Pfade, Cache-Header, Range-Requests, Gzip
updater/            Image für den wöchentlichen Neuaufbau (Dockerfile, update.sh, check.ts, crontab)
```

## Voraussetzungen

- Docker mit Compose-Plugin (v2.24 oder neuer)
- Ein laufender Traefik mit Docker-Provider. Gebraucht werden sein **Netzwerkname**
  (`docker network ls`), der Name des **HTTPS-Entrypoints** und des **Zertifikats-Resolvers**
- DNS-Eintrag der Domain auf den Server

## Einrichtung

```sh
cd deploy
cp .env.example .env        # DOMAIN, TRAEFIK_NETWORK, TRAEFIK_ENTRYPOINT, TRAEFIK_CERTRESOLVER anpassen
sudo mkdir -p /srv/capercailye/{live,work}    # DATA_ROOT aus .env
sudo chown -R 1000:1000 /srv/capercailye      # der Updater schreibt hier (UID siehe „Updater“)
```

Die Kacheln entstehen beim ersten Updater-Lauf (siehe „Updater“, dauert für Deutschland länger).
Wer sie schon lokal gebaut hat, kopiert sie stattdessen von Hand nach `live/`:

```sh
cp $CAPERCAILYE_DATA/capercailye-de.pmtiles /srv/capercailye/live/
cp $CAPERCAILYE_DATA/capercailye-busstops.pmtiles /srv/capercailye/live/
```

Der Dateiname `capercailye-de.pmtiles` ist im App-Build festgelegt (`VITE_PMTILES_PATH` im
Dockerfile).

## Start

```sh
cd deploy
docker compose up -d --build
```

Die Domain steckt beim Build in `canonical`, `og:*`, `robots.txt` und `sitemap.xml`; nach einer
Änderung von `DOMAIN` also neu bauen (der Befehl oben).

## Lokal testen

Ohne Traefik des Zielsystems, auf einem Entwicklungsrechner:

```sh
cd deploy
cp .env.example .env
# in .env: DOMAIN=localhost und DATA_ROOT=$HOME/capercailye-data (absoluter Pfad)
mkdir -p ~/capercailye-data/live
cp $CAPERCAILYE_DATA/capercailye-de.pmtiles ~/capercailye-data/live/   # oder -rp/-bw umbenannt

docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Das startet zusätzlich einen Wegwerf-Traefik (HTTP, Port 8080) und legt das Netzwerk an. Prüfen:

```sh
curl -sI http://localhost:8080/               # 200, Landingpage
curl -sI http://localhost:8080/app            # 301, Location: /app/
curl -sI http://localhost:8080/app/           # 200, Cache-Control: no-cache
curl -sI http://localhost:8080$(curl -s http://localhost:8080/app/ | grep -o '/app/assets/[^"]*\.js' | head -1)
                                              # 200, Cache-Control: public, max-age=31536000, immutable
curl -sI -H 'Range: bytes=0-16383' http://localhost:8080/app/data/capercailye-de.pmtiles
                                              # 206, Content-Range, Content-Type: application/vnd.pmtiles,
                                              # kein Content-Encoding
```

Im Browser: <http://localhost:8080/>. Aufräumen: `docker compose -f compose.yaml -f compose.local.yaml down`.

## Aktualisieren der App

```sh
git pull
cd deploy
docker compose up -d --build
```

Die Daten in `live/` bleiben dabei unberührt; nginx liest eine ersetzte PMTiles-Datei beim
nächsten Request neu ein.

## Updater

Der Dienst `updater` baut jeden **Dienstag um 02:23 Uhr (Europe/Berlin)** die Kacheln für
Deutschland neu (supercronic, `updater/crontab`) und tauscht sie ohne Ausfall in `live/` ein:
OSM-Auszug von Geofabrik laden (nur wenn neuer, md5-geprüft), Kacheln mit Planetiler bauen,
Bushaltestellen aus dem GTFS-Feed bauen, mit `updater/check.ts` prüfen, dann je Datei
`mv` (atomar). Schlägt etwas fehl, bleibt `live/` unverändert. Details: [../DEPLOY-PLAN.md](../DEPLOY-PLAN.md).

**GTFS-Feed (Bushaltestellen):** Der Feed (gtfs.de) wird nur geladen, wenn in `work/gtfs/` noch keiner
liegt oder der neueste älter ist als der letzte Fahrplanwechsel (15. Dezember). Die
Haltestellen-Datei wird nur neu gebaut, wenn so ein Feed geladen wird oder `live/capercailye-busstops.pmtiles`
fehlt; sonst steht im Log „Haltestellen: kein neuer Fahrplan, übersprungen“. Übersteuern mit
`GTFS_REFRESH=1` (immer laden) oder `0` (nie laden); Standard ist `auto`.

### Rechte

Der Container läuft als Benutzer mit UID 1000 (Build-Arg `UPDATER_UID`, z. B. `docker compose build --build-arg UPDATER_UID=1001 updater`). `DATA_ROOT` (`/srv/capercailye`) muss für diese UID beschreibbar sein:
`sudo chown -R 1000:1000 /srv/capercailye`. nginx liest `live/` nur (`:ro`); die Dateien sind
weltlesbar (umask 022).

### Erster Lauf von Hand

```sh
cd deploy
docker compose build updater
docker compose run --rm updater /opt/capercailye/update.sh
```

Das lädt den Auszug (~4–5 GB) und den GTFS-Feed (~0,3 GB), baut alles und füllt `live/`. Läuft im Vordergrund
(Strg-C bricht ab, `live/` bleibt unberührt). Speicher beobachten, in einem zweiten Terminal:
`docker stats` (Spalte MEM USAGE; Obergrenze: Speichergrenze des Containers). Am Ende druckt das Skript eine Zusammenfassung mit
Dauer und größtem Speicherverbrauch (RSS) je Schritt. Danach `docker compose up -d`: der Updater läuft dann
dauerhaft und startet nach Zeitplan.

### Betrieb

- **Zeitplan:** Dienstag 02:23 (`updater/crontab`, `CRON_TZ=Europe/Berlin`). Zeitumstellungen fallen
  auf Sonntage, der Termin entfällt also nie und läuft nie doppelt.
- **Logs:** `docker compose logs updater` (Cron-Meldungen und die Ausgabe jedes Laufs); je Lauf eine Datei
  `work/logs/update-JJJJMMTT-HHMM.log`, die letzten 8 bleiben.
- **Von Hand während der Dienst läuft:** `docker compose exec updater /opt/capercailye/update.sh`.
  Eine Sperre (`work/update.lock`) verhindert zwei Läufe gleichzeitig; der zweite bricht sofort ab.
  Für einen anderen Auszug lässt sich z. B. `-e PBF_URL=… -e AREA=…` an `exec` anhängen (nur zum Testen).
- **Rollback:** Die Vorgängerversion jeder getauschten Datei liegt in `work/prev/`. Zurück:
  ```sh
  mv -f /srv/capercailye/work/prev/capercailye-de.pmtiles /srv/capercailye/live/capercailye-de.pmtiles
  ```
  (gleich für `capercailye-busstops.pmtiles`; laufende Anfragen beenden sich auf dem alten Inode).
- **Healthcheck:** `HEALTHCHECK_URL` in `.env` (z. B. healthchecks.io): Ping nach erfolgreichem Lauf, bei
  einem Fehler `<URL>/fail`. Ein fehlgeschlagener Ping lässt den Lauf nie scheitern.
- **Neues Image** (nach `git pull`): `docker compose up -d --build`. Ein gerade laufender Update-Lauf
  wird dabei abgebrochen; `live/` bleibt unverändert.

### Speicher und Platte

- **RAM:** Container-Limit `mem_limit: 10g`, Java-Heap `JAVA_XMX=6g` (`.env`). Planetiler legt Knotendaten in
  mmap-Dateien (Seitencache, wird bei Druck freigegeben: langsamer statt OOM). Die Schritte laufen nacheinander.
  Zu wenig Speicher: `JAVA_XMX` senken (z. B. 4g).
- **CPU:** `UPDATER_CPUS=4` (`.env`) begrenzt den Container und setzt die Planetiler-Threads; der Lauf
  läuft mit `nice -n 10`. Auf dem Server mindestens einen Kern für nginx freilassen.
- **Platte:** mindestens 60 GB frei auf der Platte von `DATA_ROOT` (`MIN_FREE_GB`; das Skript bricht sonst vor
  dem Download ab): Auszug ~5 GB, Planetiler-Zwischendateien ~20–30 GB (nur während des Laufs), GTFS ~2,5 GB (Zip und entpackt),
  Kacheln je ~5 GB für `live/` und `work/prev/`. `work/` und `live/` müssen auf demselben Dateisystem
  liegen (Standard: ein Bind-Mount), sonst ist der Tausch nicht atomar.
