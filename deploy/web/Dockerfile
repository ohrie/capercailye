# Image `web`: Landingpage (/) + Karten-App (/app/) hinter nginx.
# Build-Kontext ist die Repo-Wurzel:  docker build -f deploy/web/Dockerfile .

# --- 1. Seite bauen (Astro: Landingpage, Rechtsseiten, App) -----------------------------
FROM oven/bun:1.4.2 AS build
WORKDIR /src/web
ARG VITE_PMTILES_PATH=data/capercailye-de.pmtiles
ENV VITE_PMTILES_PATH=$VITE_PMTILES_PATH
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# --- 2. Ausliefern ------------------------------------------------------------------------
FROM nginx:1.30-alpine
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist/ /usr/share/nginx/html/
# Mountpunkt für die PMTiles-Dateien (Volume ${DATA_ROOT}/live, nur lesend)
RUN mkdir -p /usr/share/nginx/html/app/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
