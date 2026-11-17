# deploy/ – Betrieb mit Docker Compose

Die Karten-App läuft als ein nginx-Container (`web`) hinter **Traefik**: Landingpage unter `/` (englisch) und `/de/` (deutsch), App unter `/app/`, PMTiles unter `/app/data/`. Begründungen,
Messwerte und Risiken: [../SPEC.md](../SPEC.md), Abschnitt 6.

```
compose.yaml          Dienste web (Traefik-Labels, Volume mit den PMTiles) und updater, eigenes Netzwerk
compose.local.yaml    Zusatz für lokale Tests: Wegwerf-Traefik auf http://localhost:8080
.env.example          Vorlage für die Server-Konfiguration (.env, nur auf dem Server)
deploy.sh             Deploy vom Entwicklungsrechner per scp (ohne Registry, ohne CI)
deploy.env.example    Vorlage für deploy/deploy.env (DEPLOY_HOST, DEPLOY_DIR; nicht im Repo)
web/Dockerfile        Bun-Build (Astro) von Landingpage und App mit eingetragener Domain → nginx
web/nginx.conf        Pfade, Cache-Header, Range-Requests, Gzip
updater/              Image für den wöchentlichen Neuaufbau (Dockerfile, update.sh, check.ts, crontab)
```

## Ablauf

`deploy.sh` packt den committeten Stand (`git archive HEAD`), kopiert ihn per `scp` auf den Server
und startet dort `docker compose up -d --build`. Die Images werden **auf dem Server** gebaut (dessen
Architektur), es gibt keine Registry. Layout auf dem Server (`DEPLOY_DIR`):

```
/srv/capercailye/
├── .env      Konfiguration, nur auf dem Server; deploy.sh fasst sie nie an
├── app/      entpackter Code des letzten Deploys (REVISION = Commit); wird bei jedem Deploy ersetzt
├── app.prev/ der Stand davor (für den Rollback)
├── live/     PMTiles, die nginx ausliefert
└── work/     Updater: OSM-Auszug, GTFS, Zwischenstände, prev/, logs/
```

## Voraussetzungen

- Server mit Docker und Compose-Plugin (v2.24 oder neuer); der Benutzer darf `docker` aufrufen
- ssh-Zugang vom Entwicklungsrechner (Schlüssel, ohne Passwortabfrage: `deploy.sh` nutzt `BatchMode`)
- Ein laufender Traefik mit Docker-Provider, Entrypoints `web` (HTTP) und `websecure` (HTTPS) und einem
  Zertifikats-Resolver `letsencrypt` (andere Namen: `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERTRESOLVER` in `.env`)
- DNS-Eintrag (A und gegebenenfalls AAAA) der Domain auf den Server

## Einmalige Einrichtung

Auf dem Server (Pfad = `DEPLOY_DIR`):

```sh
sudo mkdir /srv/capercailye
sudo chown "$USER": /srv/capercailye     # der Updater im Container läuft mit UID 1000, siehe „Rechte“
```

Auf dem Entwicklungsrechner:

```sh
cp deploy/deploy.env.example deploy/deploy.env     # DEPLOY_HOST (ssh-Ziel) eintragen
scp deploy/.env.example <ssh-ziel>:/srv/capercailye/.env
ssh <ssh-ziel> nano /srv/capercailye/.env          # DOMAIN prüfen, RAM-Werte anpassen
```

**Traefik an das Projektnetzwerk hängen.** `compose.yaml` legt das Netzwerk `capercailye_network`
selbst an; der Traefik muss darin Mitglied sein, sonst erreicht er den Container nicht. Das Netzwerk
muss dafür **zuerst existieren**, also zuerst einmal deployen (Traefik kennt es noch nicht, der
Container läuft aber schon):

```sh
deploy/deploy.sh
```

Danach im Compose-File des Proxys den Dienst `traefik` zusätzlich in dieses Netzwerk hängen:

```yaml
services:
  traefik:
    networks:
      - capercailye_network      # zu den vorhandenen Netzwerken hinzufügen
networks:
  capercailye_network:
    external: true
```

und den Proxy neu starten (im Verzeichnis dieses Compose-Files, mit `sudo`, falls es root gehört):
`docker compose up -d`. Ohne diesen Schritt liefert die Domain „Gateway Timeout“ oder 404.
Das Zertifikat holt Traefik beim ersten HTTPS-Aufruf selbst (Resolver `letsencrypt`).

Traefik veröffentlicht Container möglicherweise standardmäßig
(`exposedbydefault=true`); der Updater hat deshalb `traefik.enable=false`.

## Deploy

```sh
deploy/deploy.sh                 # committeten HEAD bauen und starten
deploy/deploy.sh --update-now    # zusätzlich sofort einen Daten-Update starten (erste Daten!)
```

Weitere Optionen: `--allow-dirty` (trotz uncommitteter Änderungen; deployt trotzdem nur den
committeten HEAD und listet die ausgelassenen Dateien auf), `--no-up` (nur hochladen und `app/`
austauschen, nichts bauen), `--help`. `DEPLOY_HOST`/`DEPLOY_DIR` stehen in `deploy/deploy.env` oder
in der Umgebung. Die Domain der Landingpage (`canonical`, `hreflang`, `og:*`, `robots.txt`,
`sitemap.xml`) steht fest in `web/src/components/Landing.astro` und `web/public/`; `DOMAIN` in `.env` steuert nur die Traefik-Regel.

### Sprachen der Landingpage

Die Landingpage gibt es unter `/` (englisch) und `/de/` (deutsch). `web/nginx.conf` leitet nur bei
exakt `/` weiter: Ist die **erste** Sprache im `Accept-Language`-Header Deutsch (`de`, `de-DE`,
`de-AT`, `de-CH` …), gibt es ein 302 auf `/de/`, sonst die englische Seite; die Antwort auf `/`
trägt `Vary: Accept-Language, Cookie`. Ein Cookie `lang=de|en` hat Vorrang (`lang=de` leitet
immer um, `lang=en` nie); nginx setzt es nie, es kommt von der Sprachauswahl der Seite. `/de/` und
alle anderen Pfade werden nie umgeleitet. Die Rechtsseiten (`/impressum/`, `/datenschutz/`, `/quellen/`) gibt es nur deutsch. Die
Sprache der App wird im Browser bestimmt, nginx ist daran nicht beteiligt (siehe `web/README.md`,
„Sprachen (i18n)“).

Der Build auf dem Server (Bun-Build der App, Planetiler-JAR, tippecanoe aus dem Quelltext) dauert beim
ersten Mal einige Minuten; danach nutzt Docker seinen Schichtcache.

### Erste Daten

Die Kacheln entstehen beim ersten Updater-Lauf (Auszug ~4–5 GB, dauert für Deutschland länger):

```sh
deploy/deploy.sh --update-now
# Log verfolgen (der Befehl wird am Ende ausgegeben):
ssh <ssh-ziel> 'tail -n +1 -f "$(ls -t /srv/capercailye/work/logs/update-*.log | head -1)"'
```

Bis die Kacheln in `live/` liegen, zeigt die App keine Karte. Wer sie schon lokal gebaut hat, kopiert
sie stattdessen: `scp capercailye-de.pmtiles capercailye-busstops.pmtiles <ssh-ziel>:/srv/capercailye/live/`.
Der Dateiname `capercailye-de.pmtiles` ist im App-Build festgelegt (`VITE_PMTILES_PATH` im Dockerfile).

### Rollback

- **App:** der vorige Stand liegt in `app.prev/`:
  ```sh
  cd /srv/capercailye && rm -rf app.bad && mv app app.bad && mv app.prev app
  cd app/deploy && docker compose --env-file /srv/capercailye/.env up -d --build
  ```
- **Daten:** `work/prev/` (siehe „Betrieb“ unter „Updater“).

### Speichergrenzen

Der Updater wird über diese Werte in `.env` eingestellt:
`UPDATER_MEM_LIMIT=5g`, `JAVA_XMX=3g`, `UPDATER_CPUS=4` (alles in `.env`). Planetiler legt
Knotendaten in mmap-Dateien: bei Speicherdruck wird der Lauf langsamer statt abgebrochen. Reicht das
Limit nicht (Container wird beendet, `docker inspect` zeigt `OOMKilled`), `JAVA_XMX` senken oder das
Limit erhöhen. nginx braucht unter 100 MB.

## Lokal testen

Mit einem Wegwerf-Traefik, auf dem Entwicklungsrechner (Docker-Build der eigenen Architektur):

```sh
cd deploy
cp .env.example .env
# in .env: DOMAIN=localhost und DATA_ROOT=$HOME/capercailye-data (absoluter Pfad); die lokale .env steht in .gitignore
mkdir -p ~/capercailye-data/live
cp $CAPERCAILYE_DATA/capercailye-de.pmtiles ~/capercailye-data/live/   # oder -rp/-bw umbenannt

docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Das startet zusätzlich einen Wegwerf-Traefik (HTTP, Port 8080) im Netzwerk `capercailye_network`. Prüfen:

```sh
curl -sI http://localhost:8080/               # 200, Landingpage (englisch), Vary: Accept-Language
curl -sI -H 'Accept-Language: de-AT,en;q=0.8' http://localhost:8080/
                                              # 302, Location: /de/
curl -sI -H 'Accept-Language: fr,de;q=0.8' http://localhost:8080/
                                              # 200 (erste Sprache ist nicht Deutsch)
curl -sI -H 'Accept-Language: de' http://localhost:8080/de/   # 200, keine Weiterleitung
curl -sI http://localhost:8080/app            # 301, Location: /app/
curl -sI http://localhost:8080/app/           # 200, Cache-Control: no-cache
curl -sI http://localhost:8080$(curl -s http://localhost:8080/app/ | grep -o '/app/assets/[^"]*\.js' | head -1)
                                              # 200, Cache-Control: public, max-age=31536000, immutable
curl -sI -H 'Range: bytes=0-16383' http://localhost:8080/app/data/capercailye-de.pmtiles
                                              # 206, Content-Range, Content-Type: application/vnd.pmtiles,
                                              # kein Content-Encoding
```

Im Browser: <http://localhost:8080/>. Aufräumen: `docker compose -f compose.yaml -f compose.local.yaml down`.

## Updater

Der Dienst `updater` baut jeden **Dienstag um 02:23 Uhr (Europe/Berlin)** die Kacheln für
Deutschland neu (supercronic, `updater/crontab`) und tauscht sie ohne Ausfall in `live/` ein:
OSM-Auszug von Geofabrik laden (nur wenn neuer, md5-geprüft), Kacheln mit Planetiler bauen,
Bushaltestellen aus dem GTFS-Feed bauen, mit `updater/check.ts` prüfen, dann je Datei
`mv` (atomar). Schlägt etwas fehl, bleibt `live/` unverändert. Begründungen: [../SPEC.md](../SPEC.md), Abschnitt 6.

**GTFS-Feed (Bushaltestellen):** Der Feed (gtfs.de) wird nur geladen, wenn in `work/gtfs/` noch keiner
liegt oder der neueste älter ist als der letzte Fahrplanwechsel (15. Dezember). Die
Haltestellen-Datei wird nur neu gebaut, wenn so ein Feed geladen wird oder `live/capercailye-busstops.pmtiles`
fehlt; sonst steht im Log „Haltestellen: kein neuer Fahrplan, übersprungen“. Übersteuern mit
`GTFS_REFRESH=1` (immer laden) oder `0` (nie laden); Standard ist `auto`.

### Rechte

Der Container läuft als Benutzer mit UID 1000 (Build-Arg `UPDATER_UID`, z. B. `docker compose build --build-arg UPDATER_UID=1001 updater`). `DATA_ROOT` (`/srv/capercailye`) muss für diese UID beschreibbar sein:
`sudo chown -R 1000:1000 /srv/capercailye` (hat der Benutzer, der deployt, die UID 1000, passt das schon). nginx liest `live/` nur (`:ro`); die Dateien sind
weltlesbar (umask 022).

### Erster Lauf von Hand

Auf dem Server (Alternative zu `deploy.sh --update-now`, im Vordergrund):

```sh
cd /srv/capercailye/app/deploy
docker compose --env-file /srv/capercailye/.env build updater
docker compose --env-file /srv/capercailye/.env run --rm updater /opt/capercailye/update.sh
```

Das lädt den Auszug (~4–5 GB) und den GTFS-Feed (~0,3 GB), baut alles und füllt `live/`. Läuft im Vordergrund
(Strg-C bricht ab, `live/` bleibt unberührt). Speicher beobachten, in einem zweiten Terminal:
`docker stats` (Spalte MEM USAGE; Obergrenze `UPDATER_MEM_LIMIT`). Am Ende druckt das Skript eine Zusammenfassung mit
Dauer und größtem Speicherverbrauch (RSS) je Schritt. Danach `deploy/deploy.sh`: der Updater läuft dann
dauerhaft und startet nach Zeitplan.

### Betrieb

- **Zeitplan:** Dienstag 02:23 (`updater/crontab`, `CRON_TZ=Europe/Berlin`). Zeitumstellungen fallen
  auf Sonntage, der Termin entfällt also nie und läuft nie doppelt.
- **Logs:** `docker compose logs updater` (Cron-Meldungen und die Ausgabe jedes Laufs); je Lauf eine Datei
  `work/logs/update-JJJJMMTT-HHMM.log`, die letzten 8 bleiben.
- **Von Hand während der Dienst läuft:** `deploy/deploy.sh --update-now` oder auf dem Server (im Verzeichnis `app/deploy`, mit `--env-file`) `docker compose exec -d updater /opt/capercailye/update.sh`.
  Eine Sperre (`work/update.lock`) verhindert zwei Läufe gleichzeitig; der zweite bricht sofort ab.
  Für einen anderen Auszug lässt sich z. B. `-e PBF_URL=… -e AREA=…` an `exec` anhängen (nur zum Testen).
- **Rollback:** Die Vorgängerversion jeder getauschten Datei liegt in `work/prev/`. Zurück:
  ```sh
  mv -f /srv/capercailye/work/prev/capercailye-de.pmtiles /srv/capercailye/live/capercailye-de.pmtiles
  ```
  (gleich für `capercailye-busstops.pmtiles`; laufende Anfragen beenden sich auf dem alten Inode).
- **Fehler:** zeigen sich in `work/logs/` und daran, dass `live/` alt bleibt.
- **Neues Image** (jeder `deploy.sh`-Lauf baut neu): Wird das Updater-Image dabei ersetzt, bricht ein
  gerade laufender Update-Lauf ab; `live/` bleibt unverändert.

### Speicher und Platte

- **RAM:** Container-Limit `UPDATER_MEM_LIMIT` (Standard 5g), Java-Heap `JAVA_XMX` (Standard 3g) in `.env`. Planetiler legt Knotendaten in
  mmap-Dateien (Seitencache, wird bei Druck freigegeben: langsamer statt OOM). Die Schritte laufen nacheinander.
  Zu wenig Speicher: `JAVA_XMX` senken (z. B. 2g).
- **CPU:** `UPDATER_CPUS=4` (`.env`) begrenzt den Container und setzt die Planetiler-Threads; der Lauf
  läuft mit `nice -n 10`. Mindestens einen Kern für nginx freilassen.
- **Platte:** mindestens 60 GB frei auf der Platte von `DATA_ROOT` (`MIN_FREE_GB`; das Skript bricht sonst vor
  dem Download ab): Auszug ~5 GB, Planetiler-Zwischendateien ~20–30 GB (nur während des Laufs), GTFS ~2,5 GB (Zip und entpackt),
  Kacheln je ~5 GB für `live/` und `work/prev/`. `work/` und `live/` müssen auf demselben Dateisystem
  liegen (Standard: ein Bind-Mount), sonst ist der Tausch nicht atomar.
