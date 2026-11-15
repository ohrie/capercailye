# Image `updater`: baut jede Woche Kacheln und Bushaltestellen neu (update.sh) und tauscht sie in live/.
# Build-Kontext ist die Repo-Wurzel:  docker build -f deploy/updater/Dockerfile .

# --- 1. tippecanoe aus dem Quelltext (gleiche Ubuntu-Basis wie das Endimage) -----------------------
FROM ubuntu:24.04 AS tippecanoe
ARG TIPPECANOE_VERSION=2.79.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libsqlite3-dev zlib1g-dev git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$TIPPECANOE_VERSION" https://github.com/felt/tippecanoe /src \
 && cd /src && make -j"$(nproc)" && make install

# --- 2. Endimage ------------------------------------------------------------------------------
# JDK statt JRE: tiles/build.sh startet CapercailyeProfile.java direkt (Source-Launcher, braucht javac).
FROM eclipse-temurin:21-jdk-noble
ARG PLANETILER_VERSION=0.10.2
ARG SUPERCRONIC_VERSION=0.2.51
# SHA1 je Architektur laut Release-Notes von supercronic v0.2.51
ARG SUPERCRONIC_SHA1_AMD64=1692066e350a88ff4d7d6474fe3c7a6c41ec5e89
ARG SUPERCRONIC_SHA1_ARM64=9d4c2000493215a1898502b2fc2dada3e8ea8c7a
# Wird von BuildKit gesetzt (amd64/arm64); ohne BuildKit leer, dann gilt dpkg unten
ARG TARGETARCH
# Benutzer im Container; /srv/capercailye auf dem Host muss für diese UID beschreibbar sein
ARG UPDATER_UID=1000

# time: /usr/bin/time -v misst den Speicherbedarf je Schritt (update.sh); util-linux liefert flock
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates libsqlite3-0 zlib1g libstdc++6 util-linux time tzdata \
 && rm -rf /var/lib/apt/lists/*

COPY --from=tippecanoe /usr/local/bin/tippecanoe /usr/local/bin/tile-join /usr/local/bin/
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun

RUN arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
 && case "$arch" in \
      amd64) sha1="${SUPERCRONIC_SHA1_AMD64}" ;; \
      arm64) sha1="${SUPERCRONIC_SHA1_ARM64}" ;; \
      *) echo "supercronic: Architektur $arch nicht unterstützt" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-${arch}" \
 && echo "${sha1}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/supercronic

RUN mkdir -p /opt/planetiler \
 && curl -fsSL -o /opt/planetiler/planetiler.jar \
      "https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"
ENV PLANETILER_JAR=/opt/planetiler/planetiler.jar

WORKDIR /opt/capercailye
# check.ts braucht pmtiles (transit/ hat keine Abhängigkeiten)
COPY deploy/updater/package.json deploy/updater/bun.lock ./
RUN bun install --frozen-lockfile
COPY tiles/ tiles/
COPY transit/ transit/
COPY deploy/updater/update.sh deploy/updater/check.ts deploy/updater/crontab ./
RUN chmod +x update.sh tiles/build.sh transit/build.sh

# Der Basis-Image hat schon einen Benutzer mit UID 1000 ("ubuntu"); er wird ersetzt.
RUN (id -un "${UPDATER_UID}" >/dev/null 2>&1 && userdel -r "$(id -un "${UPDATER_UID}")" || true) \
 && useradd --uid "${UPDATER_UID}" --create-home --shell /bin/bash updater
USER updater

ENV TZ=Europe/Berlin
CMD ["supercronic", "/opt/capercailye/crontab"]
