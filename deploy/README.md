# deploy/ – Betrieb mit Docker Compose

Die Karten-App läuft als ein nginx-Container (`web`) hinter **Traefik**: Landingpage unter `/`, App unter `/app/`, PMTiles unter `/app/data/`. Plan und
Hintergründe: [../DEPLOY-PLAN.md](../DEPLOY-PLAN.md).

```
compose.yaml        Dienst web (Traefik-Labels, Volume mit den PMTiles)
compose.local.yaml  Zusatz für lokale Tests: Wegwerf-Traefik auf http://localhost:8080
.env.example        Vorlage für deploy/.env
web/Dockerfile      Bun-Build der App + Landingpage mit eingetragener Domain → nginx
web/nginx.conf      Pfade, Cache-Header, Range-Requests, Gzip
```

Der Updater (wöchentlicher Neuaufbau der Kacheln) folgt (Phase 3).

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
```

Bis der Updater existiert, liegen die Kacheln von Hand in `live/`:

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

Folgt (Phase 3): wöchentlicher Neuaufbau der Kacheln, Tausch in `live/`, Rollback aus `work/prev/`.
