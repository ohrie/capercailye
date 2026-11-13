# capercailye

Wanderkarten on demand aus OpenStreetMap: Gebiet wählen, Anzahl A4-Seiten wählen, Vorschau prüfen,
PDF exportieren und selbst drucken. Alles läuft lokal im Browser (MapLibre GL JS auf eigenen
PMTiles); Umfang und Entscheidungen stehen in [PLAN.md](PLAN.md).

## Voraussetzungen

- **Java 21 oder neuer** (getestet mit 27; Planetiler-Lauf in `tiles/build.sh`; die `planetiler.jar` lädt das Skript beim
  ersten Mal selbst nach `$CAPERCAILYE_DATA/`), `curl`
- **Bun** (Web-App, Bushaltestellen-Skript)
- **tippecanoe**, `unzip` – nur für `transit/build.sh` (Bushaltestellen)
- osmium wird nicht gebraucht

Speicher: Baden-Württemberg und Rheinland-Pfalz laufen mit dem Standard-Heap von 4 GB
(`JAVA_XMX=8g` zum Ändern).

## Kartendaten erzeugen

Alle Ergebnisse liegen in `$CAPERCAILYE_DATA/` (Standard `~/.local/share/capercailye`, anderes Verzeichnis: `CAPERCAILYE_DATA=/pfad`,
das gilt für die Build-Skripte und den Dev-Server).

### 1. OSM-Extrakt laden

Geofabrik-Extrakt eines Bundeslandes (oder `germany`, `europe`), Beispiel Rheinland-Pfalz:

```sh
mkdir -p "$CAPERCAILYE_DATA"
curl -fL -o $CAPERCAILYE_DATA/rheinland-pfalz-latest.osm.pbf \
  https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf
```

Rheinland-Pfalz hat rund 270 MB, Baden-Württemberg rund 640 MB, ganz Deutschland rund 4,9 GB.

### 2. Vektorkacheln bauen

```sh
tiles/build.sh [input.osm.pbf] [gebiet]
tiles/build.sh $CAPERCAILYE_DATA/rheinland-pfalz-latest.osm.pbf          # → capercailye-rp.pmtiles
tiles/build.sh $CAPERCAILYE_DATA/baden-wuerttemberg-latest.osm.pbf       # → capercailye-bw.pmtiles
tiles/build.sh $CAPERCAILYE_DATA/foo-latest.osm.pbf mein-gebiet          # → capercailye-mein-gebiet.pmtiles
```

Der Gebietsname im Dateinamen ergibt sich aus dem Namen des Extrakts (`baden-wuerttemberg` → `bw`,
`rheinland-pfalz` → `rp`, `germany` → `de`, `europe` → `eu`, sonst der volle Name) oder aus dem
zweiten Argument. Ausgabe: `capercailye-<gebiet>.pmtiles` plus `….layerstats.tsv.gz`
(Kachelstatistik je Layer). Zusätzliche Planetiler-Argumente nach `--`, z. B.
`tiles/build.sh in.pbf de -- --threads=8`. Das Skript schreibt kein Log; wer eines will, leitet die
Ausgabe um (`… > $CAPERCAILYE_DATA/build-rp.log 2>&1`). Dauer: Rheinland-Pfalz knapp 1 Minute,
Baden-Württemberg etwa 2 Minuten. Das Schema der Kacheln steht in [tiles/SCHEMA.md](tiles/SCHEMA.md).

### 3. Bushaltestellen (optional)

```sh
transit/build.sh            # lädt beim ersten Mal den gtfs.de-Feed, baut capercailye-busstops.pmtiles
transit/build.sh --refresh  # Feed neu laden
```

Die Datei deckt ganz Deutschland ab und ist unabhängig vom Gebiet der OSM-Kacheln; sie muss nicht
je Gebiet neu gebaut werden. Der kostenlose Feed gilt nur 30 Tage, die Haltestellenkarte ist also
ein Schnappschuss und sollte gelegentlich mit `--refresh` aufgefrischt werden. Quelle, Regeln und
Optionen: [transit/README.md](transit/README.md). Fehlt die Datei, läuft die App ohne
Bushaltestellen.

### 4. Relief

Schummerung und Höhenlinien kommen online vom Mapterhorn-Kacheldienst und werden im Browser
berechnet. Dafür gibt es keinen Build-Schritt (Internetverbindung nötig).

## Web-App starten

```sh
cd web
bun install
bun run dev        # http://localhost:5173
```

Der Dev-Server liefert die Dateien aus `$CAPERCAILYE_DATA/` unter `/data/` aus. Weitere
Befehle und der Aufbau: [web/README.md](web/README.md).

### Gebiet wechseln

Die App lädt die Datei aus `PMTILES_PATH` in `web/src/config.ts`, derzeit
`data/capercailye-rp.pmtiles` (Rheinland-Pfalz); eine Umschaltung zur Laufzeit gibt es nicht. Für
ein anderes Gebiet dort den Dateinamen ändern (z. B. `data/capercailye-bw.pmtiles`) und die
Startansicht (`INITIAL_CENTER`, `INITIAL_ZOOM`, derzeit Dahn im Pfälzerwald) ins Gebiet
verschieben. Die Bushaltestellen-Datei braucht keine Anpassung.
