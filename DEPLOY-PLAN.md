# Deployment plan: Docker Compose behind Traefik, all of Germany, weekly update

Goal: run capercailye on one server for the public, covering all of Germany. Landing page at `/`,
app at `/app/`, vector tiles for Germany (`capercailye-de.pmtiles`) plus bus stops. Every
**Tuesday at 02:23 (Europe/Berlin)** a fresh OSM extract and GTFS feed are downloaded, the tiles are
rebuilt and swapped in without downtime. Keep it simple; the updater's memory use is capped in `.env`.

Status: deployment target decided (scp deploy, images built on the server; see 2, 3, 6); Phase 1 and 2 done (2026-11-14, Phase 2 tested locally with compose.local.yaml); Phase 3 written and tested outside Docker (Bremen extract), first Germany run in Docker pending. Replaces the "nur lokal" line in PLAN.md once done.

## 1. Facts this plan builds on

- The app is fully static (Vite build, MapLibre, PMTiles read via HTTP Range requests). No backend.
- Tiles: `tiles/build.sh <pbf> <area>` → Planetiler + `tiles/CapercailyeProfile.java`. BW (640 MB
  PBF) takes ~2 min with 4 GB heap and gives 594 MB of tiles.
- Bus stops: `transit/build.sh --refresh` (bun + tippecanoe + unzip), already Germany-wide. The free
  gtfs.de feed is only valid 30 days, so a weekly refresh fits.
- Data dates are read from the files at runtime (`planetiler:osm:osmosisreplicationtime`,
  `feed_date=` in the bus stop description) → the "Stand" in the credits updates by itself.
- Relief (Mapterhorn) and search (Photon/komoot) are external services, called from the browser.
- The target is a server with Docker and Traefik as reverse proxy (owns ports 80/443, handles TLS). It runs
  in its own compose project and joins one external network per project; it may publish containers
  by default, so every service sets `traefik.enable` explicitly.

## 2. Architecture (option B: one nginx behind Traefik)

```
      Traefik (80/443, TLS)           ── Host(DOMAIN) ──►  web (nginx)
                                                           /          → site/ (landing page)
                                                           /app/      → web/dist (map app)
                                                           /app/data/ → /srv/capercailye/live (ro)

      updater  (no ports, `traefik.enable=false`, only on the project's default network)
        supercronic "23 2 * * 2" → update.sh → builds in work/, swaps into live/
```

`compose.yaml` has two services:

| Service | Image | Job |
|---|---|---|
| `web` | own, multi-stage: `oven/bun` build → `nginx:alpine` | Serves landing page, app and tiles. Joins the project's own network `capercailye_network` (created by this compose project, fixed name) with a few labels: HTTPS router plus an HTTP router that redirects to HTTPS. Traefik is added to that network in the proxy's own compose file. |
| `updater` | own: `eclipse-temurin:21-jre` + bun + tippecanoe + supercronic | Weekly build and swap. `mem_limit: 5g`. |

Why one nginx instead of two containers routed by Traefik: both parts are static files from one
repo, deployed together. One Traefik rule (`Host(DOMAIN)`) and nginx does path routing, cache
headers, Range requests and gzip in plain config. Traefik stays a router.

Data on the host under one bind mount (one filesystem, so the swap is an atomic `mv`):

```
/srv/capercailye/live/   capercailye-de.pmtiles, capercailye-busstops.pmtiles   (web: ro)
/srv/capercailye/work/   germany-latest.osm.pbf, gtfs/, build/, prev/, logs/    (updater only)
```

## 3. Resources (Germany)

| Resource | Plan |
|---|---|
| RAM | updater `mem_limit: 5g`, `JAVA_XMX=3g` (both overridable in `.env`). Planetiler keeps node data in mmap files (page cache, reclaimable) → slower under pressure, not OOM. Steps run sequentially, never in parallel. nginx < 100 MB. |
| Unknown | memory of `transit/busstops.ts` on the full German GTFS feed – measure in Phase 3 |
| CPU | `cpus: 4` and 4 Planetiler threads on the updater (≥ 1 core left for nginx); `nice -n 10` |
| Disk | PBF 5 GB + Planetiler tmp ~20–30 GB + GTFS ~8 GB + tiles ~5 GB × 2 (live + prev) → ≥ 60 GB free |

## 4. Phase 1 – app changes (no Docker yet)

1. `web/vite.config.ts`: `base` from `VITE_BASE` (default `/`). All runtime URLs go through
   `appUrl()` / `import.meta.env.BASE_URL`; nothing hard-codes `/`.
2. `web/src/config.ts`: `PMTILES_PATH` from `VITE_PMTILES_PATH` (default
   `data/capercailye-rp.pmtiles`); typed in a `vite-env.d.ts`.
3. Relief credit entry `de` in `RELIEF_CREDITS`, wording checked against Mapterhorn's
   `attribution.json`.
4. Check: `bun test`, `bun run fmt:check`, `bun run build` with defaults and with
   `VITE_BASE=/app/ VITE_PMTILES_PATH=data/capercailye-de.pmtiles`; the `/app/` build loads tiles,
   fonts and bus stops from `/app/…` when served under that prefix.

The `TODO: domain` placeholders in `site/` are replaced at image build time in Phase 2 (build arg).

## 5. Files (Phases 2–3)

```
.dockerignore                 node_modules, dist, .git, *.pmtiles, *.osm.pbf (nicht *.pbf: Schriftkacheln!), *.jar
deploy/
├── README.md                 setup, first run, manual update, rollback
├── compose.yaml
├── compose.local.yaml        Wegwerf-Traefik für lokale Tests (HTTP, Port 8080)
├── deploy.sh                 scp deploy: git archive HEAD → server, `docker compose up -d --build` there
├── deploy.env.example        DEPLOY_HOST, DEPLOY_DIR (real deploy.env is gitignored)
├── .env.example              DOMAIN, DATA_ROOT=/srv/capercailye, JAVA_XMX=3g, UPDATER_MEM_LIMIT=5g,
│                             UPDATER_CPUS=4, HEALTHCHECK_URL; TRAEFIK_ENTRYPOINT/CERTRESOLVER optional
├── web/Dockerfile            bun build (VITE_BASE=/app/, VITE_PMTILES_PATH=…-de…; sed DOMAIN into
│                             site/) → nginx:alpine with site/ at /, dist at /app/
├── web/nginx.conf
└── updater/
    ├── Dockerfile            temurin 21 JDK (the profile runs as a source file, needs javac) + curl unzip
    │                         bun tippecanoe (built from source, pinned) + supercronic (pinned)
    │                         + planetiler.jar (pinned) + tiles/ + transit/
    ├── crontab               23 2 * * 2 /opt/capercailye/update.sh   (CRON_TZ=Europe/Berlin)
    ├── update.sh
    ├── check.ts              validates a new PMTiles file before the swap
    └── package.json, bun.lock  (pmtiles, for check.ts)
```

### compose.yaml (shape)

- top-level `name: capercailye`; `web` joins `capercailye_network` (declared with that fixed name, created
  by this project; Traefik joins it from the proxy's compose file); labels: router `capercailye`
  (`Host(\`${DOMAIN}\`)`, `websecure`, tls, certresolver `letsencrypt`) + router `capercailye-http`
  (`web` entrypoint, `redirectscheme` middleware to https, permanent), service port 80, `traefik.docker.network`;
  volume `${DATA_ROOT}/live:/usr/share/nginx/html/app/data:ro`; healthcheck; `restart: unless-stopped`.
- `updater`: volume `${DATA_ROOT}:/srv/capercailye`; `mem_limit: ${UPDATER_MEM_LIMIT:-5g}`; `cpus: 4`; `traefik.enable=false`; env
  `JAVA_XMX`, `TZ`, `HEALTHCHECK_URL`; `restart: unless-stopped`; default network only.
- No compression middleware in Traefik for this router (compressing range responses breaks PMTiles).

### nginx.conf

- `/` landing page; `/app/` → `try_files $uri $uri/ /app/index.html`.
- `/app/assets/` (hashed): `Cache-Control: public, max-age=31536000, immutable`; HTML: `no-cache`.
- `/app/data/*.pmtiles`: type `application/vnd.pmtiles`, `gzip off`,
  `Cache-Control: public, max-age=300, must-revalidate`, no `open_file_cache` (renamed file is
  picked up on the next request).
- `gzip on` for html/css/js/json/svg; font `.pbf` gzip off. `server_tokens off`.

### update.sh

`flock` against overlapping runs; log to stdout and `work/logs/` (keep 8).

1. Abort if < 60 GB free.
2. Download `https://download.geofabrik.de/europe/germany-latest.osm.pbf` with `curl -z` to `.part`,
   verify `.md5`, `mv` into place. Generic user agent `capercailye-updater`.
3. `nice -n 10 tiles/build.sh work/germany-latest.osm.pbf de` into `work/build/` with
   `JAVA_XMX` (default 3g; small change to `tiles/build.sh`: honour `PLANETILER_JAR` for the baked-in jar).
4. Bus stops: download a new GTFS feed only if none exists in `work/gtfs` or the newest is older
   than the last 15 December (Fahrplanwechsel); rebuild the bus stop file only then or when it is
   missing from `live/`. Keep only the newest GTFS dir. On failure keep the old bus stop file and
   continue. Override: `GTFS_REFRESH=1` (always) / `0` (never).
5. `check.ts`: file readable, `maxzoom == 14`, size > 70 % of the live file, OSM replication time
   newer than live.
6. Swap per file: `ln -f live/X work/prev/X` (rollback copy), then `mv -f work/build/X live/X`
   (atomic rename; in-flight requests finish on the old inode).
7. Clean up tmp; keep the PBF for next week's `curl -z`.
8. Ping `HEALTHCHECK_URL` (or `/fail`) if set; exit non-zero on failure with live files untouched.

Geofabrik publishes `germany-latest` in the evening (UTC), so 02:23 gets Monday's data. DST changes
fall on Sundays, so Tuesday 02:23 is never skipped or doubled.

## 6. Phases

1. **App ready for `/app/` and Germany** (section 4).
2. **web image + compose**, tested locally against a throwaway Traefik on a test network: `/`,
   `/app/`, `206` on a Range request, no `Content-Encoding` on `.pmtiles`, immutable assets.
3. **updater image, first Germany build** (`deploy/deploy.sh --update-now` or by hand on the server
   with `docker compose run --rm updater /opt/capercailye/update.sh`); record duration, peak RAM per step, disk peak, output size.
4. **Server**: DNS, `mkdir /srv/capercailye` (owned by the deploy user), `.env` copied from
   `.env.example`, first `deploy/deploy.sh` from the dev machine (scp, images built on the server, no
   registry, no CI; creates `capercailye_network`), add Traefik to that network in the proxy's compose
   file, initial data (`deploy.sh --update-now` or `scp` a local build into `live/`). Details: `deploy/README.md`.
5. **Schedule and failure paths**: cron fires; failed download leaves live untouched and pings
   `/fail`; `flock` blocks a second run; open app survives the swap; rollback from `work/prev/`.
6. **Docs**: `deploy/README.md`, README.md, PLAN.md "Betrieb".

## 7. Risks and open points

| Point | Risk | Proposal |
|---|---|---|
| RAM 5 GB | Planetiler or `busstops.ts` exceed the cap on Germany | Measure in Phase 3; lower `JAVA_XMX`, or stream GTFS in `busstops.ts` if needed |
| Photon (komoot) | Public instance with fair-use limits | Fine at launch; self-host later if traffic grows |
| Mapterhorn, gtfs.de | Terms for a public site | Check before launch |
| Origin traffic | Many range requests per map view | No CDN at start; add one for `/app/data/` if needed |
| Backups | Data is reproducible | Back up `.env` only |
