# capercailye – Web-App

Bun + Vite + TypeScript (ohne Framework), MapLibre GL JS, PMTiles, jsPDF. Stand: Meilenstein M0
(Durchstich: Karte mit vorläufigem Stil, eine A4-Seite als PDF).

## Befehle

```sh
bun install          # Abhängigkeiten
bun run dev          # Dev-Server auf http://localhost:5173
bun run build        # Typprüfung (tsc) + Produktions-Build nach dist/
bun run preview      # Build ansehen (liefert /data/ ebenfalls aus)
bun test             # Unit-Tests (Maßstab/Zoom, Papiermaße, Stil gegen Spec und Tile-Schema)
bun run fmt          # Formatieren mit oxfmt
bun run fmt:check    # Formatierung prüfen
```

## Daten

Die PMTiles werden nicht ins Repo kopiert. Der Dev-Server liefert `/data/*` aus
`$CAPERCAILYE_DATA/` mit Range-Requests (206) aus; ein anderes Verzeichnis per
`CAPERCAILYE_DATA=/pfad bun run dev`. Erwartet wird `capercailye-bw.pmtiles` (Schema:
`../tiles/SCHEMA.md`). Optional ist `capercailye-busstops.pmtiles` (GTFS-Bushaltestellen aus
`../transit/`, Layer `bus_stop`, Attribute `name`, `sat`, `sun`, `min`, Zoom 10–14, PLAN.md 4c):
`src/data.ts` prüft beim Start per Range-Request auf die PMTiles-Kennung; fehlt die Datei, wird
weder Quelle noch Gruppe `busstops` in den Stil aufgenommen (sonst würde MapLibre nie `idle`
melden und Platzierung und Export hingen), und der Schalter „Bushaltestellen“ ist deaktiviert.
Die Quellenangabe der Haltestellen steht als `BUSSTOPS_ATTRIBUTION` in `src/config.ts`. Die Schummerung kommt online vom Mapterhorn-Kacheldienst.

## Aufbau

```
src/
├── main.ts          Karte, Zustand, Export-Ablauf, window.__capercailye
├── sidebar.ts       Druck-Einstellungen, Ebenen-Schalter, Einklappen
├── state.ts         kleiner beobachtbarer App-Zustand
├── tiles.ts         MapLibre-Worker, pmtiles://-Protokoll, Kachel-Log
├── config.ts        Startansicht, Pfade, Quellenangabe
├── style/           Stil als TS-Module, je Feature-Gruppe ein Baustein (index.ts setzt zusammen;
│                    palette.ts Farben, units.ts mm/pt + Zoom-Skalierung, style.test.ts prüft
│                    Spec, Layer-Ids und alle Attribute gegen ../tiles/SCHEMA.md)
├── osmc/            Wegzeichen (PLAN.md 3): parse.ts OSMC-Grammatik, shapes.ts Formen,
│                    render.ts SVG je Zeichen, Rückfallkette ref/colour → ref → Namenskürzel und
│                    kombiniertes Bild aller Routen eines Abschnitts; index.ts Bild-Id
│                    (waymarkImageExpression) und Bildlieferant „waymark:“
├── placement/       Druck-Platzierung (PLAN.md 4a): displace.ts Verdrängung (rein, getestet),
│                    collect.ts Features → Papier-mm → GeoJSON, layers.ts Klon-Layer,
│                    rendered.ts gesetzte Wegzeichen als Hindernisse, index.ts Steuerung für
│                    Vorschau (Druckansicht) und Export
└── print/           scale.ts (Maßstab↔Zoom), paper.ts, frame.ts (Blattrahmen),
                     render.ts (versteckte Karte), pdf.ts (jsPDF), export.ts
public/fonts/        Noto Sans Regular/Italic/Medium als Glyph-PBF (Bereiche 0–511, 8192–8447;
                     aus protomaps/basemaps-assets, Lizenz OFL 1.1, siehe OFL.txt)
vite-plugin-serve-data.ts   /data/ mit Range-Unterstützung
```

## Hinweise

- Stilgrößen sind in Papier-Millimetern gedacht (`style/units.ts`): beim Druckzoom ist 1 CSS-px
  = 0,2646 mm. Zwischen z11,5 und z14,5 (alle Druckmaßstäbe 1:10 000–1:50 000) gelten die Werte
  exakt, darunter werden Linien dünner, darüber (nur Bildschirm) breiter.
- Ändert sich `../tiles/SCHEMA.md`, die Liste in `style/style.test.ts` mitziehen.
- `VECTOR_TILE_ZOOM` in `style/sources.ts` steuert, welche Kachelstufe MapLibre beim gebrochenen
  Druckzoom lädt (`"round"`: 1:25 000 → z13, 1:50 000 → z12).
- Automatisierter Export (z. B. aus Playwright):
  `await window.__capercailye.exportPdf({ scale: 25000, orientation: "portrait", dpi: 254 })`
  liefert `{ blob, meta }` ohne Download; `meta` enthält Zoom, Canvas- und Bildgröße in px/mm
  sowie die angeforderten Kachelstufen.
- **Symbole entfallen im Druck nie** (PLAN.md 4a): Symbol-Layer mit Metadaten
  `"capercailye:placement": "displace"` (Piktogramme) werden in der Druckansicht und im Export
  durch Klone auf der GeoJSON-Quelle `placement` ersetzt (Layer beliebiger Vektorquellen, auch
  `busstops`; Features ohne id werden über Koordinate und Name dedupliziert). `src/placement` holt die Punkte aus den
  Kacheln, rechnet sie in Papier-mm und schiebt überlappende Symbole nach Priorität
  (`symbol-sort-key`) um höchstens 4 mm auseinander; ab 0,5 mm Abstand zur wahren Lage zeigt ein
  feiner Strich dorthin. Namen sind ein eigener Layer und dürfen entfallen. `"fixed"` (Gipfelpunkte,
  Ortsnamen) bleibt stehen und hält Piktogramme fern; `"obstacle"` (Wegzeichen) platziert MapLibre
  selbst, seine gesetzten Kästen halten Piktogramme ebenfalls fern. Außerhalb der Druckansicht gilt
  MapLibres normale Kollision.
- **Wegzeichen** (`style/routes.ts`, Layer `waymarks-line`): je Abschnitt des Tile-Layers `routes`
  ein kombiniertes Bild aller Routen, aufrecht entlang der Linie, etwa alle 6 cm auf dem Papier,
  ab z11,5 (alle Druckmaßstäbe), bei 1:50 000 auf 80 % verkleinert. Der Layer liegt ganz oben und
  wird vor allen anderen Symbolen platziert: Beschriftungen und Piktogramme können kein Wegzeichen
  verdrängen; `icon-allow-overlap: false` mit 2,5 mm Polster dünnt nur Wegzeichen untereinander
  aus (keine Stapel an Abzweigen; das Bild mit mehr Routen gewinnt). In der Druckansicht und im
  Export liest `placement/rendered.ts` die gesetzten Wegzeichen aus MapLibres Kollisionsindex
  (interne Struktur, Stand maplibre-gl 6.18) und lässt die Piktogramme ihnen ausweichen.
- Beim Drucken „Tatsächliche Größe“ / 100 % wählen, nicht „An Seite anpassen“; die
  Kontrollstrecke (10 cm) auf dem Ausdruck nachmessen.
