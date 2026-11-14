# Image `web`: Landingpage (/) + Karten-App (/app/) hinter nginx.
# Build-Kontext ist die Repo-Wurzel:  docker build -f deploy/web/Dockerfile .

# --- 1. App bauen -----------------------------------------------------------------------
FROM oven/bun:1.4.2 AS build
WORKDIR /src/web
ARG VITE_BASE=/app/
ARG VITE_PMTILES_PATH=data/capercailye-de.pmtiles
ENV VITE_BASE=$VITE_BASE VITE_PMTILES_PATH=$VITE_PMTILES_PATH
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# --- 2. Landingpage: Domain eintragen -----------------------------------------------------
FROM alpine:3.22 AS site
ARG DOMAIN
COPY site/ /site/
RUN test -n "$DOMAIN" || { echo "Build-Arg DOMAIN fehlt (z. B. DOMAIN=karte.example.com)" >&2; exit 1; } \
 && cd /site \
 && rm -rf scripts node_modules package.json bun.lock README.md \
 && sed -i "s#https://example\.org#https://${DOMAIN}#g" index.html robots.txt sitemap.xml \
 && ! grep -rq "example\.org" .

# --- 3. Ausliefern ------------------------------------------------------------------------
FROM nginx:1.30-alpine
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=site /site/ /usr/share/nginx/html/
COPY --from=build /src/web/dist/ /usr/share/nginx/html/app/
# Mountpunkt für die PMTiles-Dateien (Volume ${DATA_ROOT}/live, nur lesend)
RUN mkdir -p /usr/share/nginx/html/app/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
