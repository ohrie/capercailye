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
`CAPERCAILYE_DATA=/pfad bun run dev`. Erwartet wird die Datei aus `PMTILES_PATH` in `src/config.ts` (derzeit `capercailye-rp.pmtiles`) (Schema:
`../tiles/SCHEMA.md`). Optional ist `capercailye-busstops.pmtiles` (GTFS-Bushaltestellen aus
`../transit/`, Layer `bus_stop`, Attribute `name`, `sat`, `sun`, `min`, Zoom 10–14, PLAN.md 4c):
`src/data.ts` prüft beim Start per Range-Request auf die PMTiles-Kennung; fehlt die Datei, wird
weder Quelle noch Gruppe `busstops` in den Stil aufgenommen (sonst würde MapLibre nie `idle`
melden und Platzierung und Export hingen), und der Schalter „Bushaltestellen“ ist deaktiviert.
Die Quellenangabe der Haltestellen steht als `BUSSTOPS_ATTRIBUTION` in `src/config.ts`.

Das Relief (Schummerung und Höhenlinien) kommt online vom Mapterhorn-Kacheldienst (Terrarium-DEM,
512-px-WebP) und wird über [maplibre-contour](https://github.com/onthegomap/maplibre-contour)
(BSD-3-Clause) verarbeitet. Die Höhenlinien entstehen clientseitig im Browser, es gibt dafür keine
Kacheldatei.

## Aufbau

```
src/
├── main.ts          Karte, Zustand, Export-Ablauf, window.__capercailye
├── sidebar.ts       Druck-Einstellungen, Ebenen-Schalter, Einklappen
├── state.ts         kleiner beobachtbarer App-Zustand
├── tiles.ts         MapLibre-Worker, pmtiles://-Protokoll, DemSource (maplibre-contour), Kachel-Log
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
- **Höhenlinien** (M4, `style/hillshade.ts`, Gruppe `contours`, Schalter „Höhenlinien“): Es gibt
  genau eine `DemSource` von maplibre-contour (`src/tiles.ts`, Worker; nicht in `src/style/` oder
  Tests erzeugen, sie startet einen Worker; eine zweite Instanz bekäme ein anderes
  Protokoll-Präfix). Sie registriert `dem-shared://` (Schummerung, Quelle `dem`) und
  `dem-contour://` (Vektorquelle `contours`, Layer `contours` mit `ele` und `level`), beide teilen
  den DEM-Cache. Die Schwellen `CONTOUR_OPTIONS.thresholds` (`style/sources.ts`) hängen vom
  gerundeten Kachelzoom ab: z13/z14 (1:15 000–1:25 000) 10 m mit Zähllinien alle 50 m, z12
  (1:50 000, Grenze bei etwa 1:35 000) 20 m / 100 m, z11 50 m / 250 m. Deshalb setzt
  `applyVectorTileZoom` für die Quelle `contours` immer `roundZoom = true`. `overzoom: 1`
  (Höhenlinien-Kachel z nutzt DEM z−1) ergibt ruhigere Linien und besser platzierbare Zahlen. Die
  Zahlen (6,5 pt, Zähllinien, ohne Tausenderpunkt) nehmen nicht an der Druck-Platzierung teil: sie
  sind die unterste Symbolebene, MapLibre setzt sie zuletzt, und Wegzeichen, Namen und Piktogramme
  verdrängen sie.
- **Relief-Fehler:** Die DemSource hat ein eigenes Fetch-Timeout (`RELIEF_TIMEOUT_MS`, 15 s). Danach
  ist die Kachel `errored`, MapLibre zählt sie als fertig, und `idle` kommt (ein hängender Request
  direkt gegen den Kachelserver ließe den Export sonst bis zum 120-s-Limit warten). Offline oder
  bei DEM-Fehlern läuft der Export weiter; `render.ts` zählt die Fehler der Quellen `dem` und
  `contours` (`meta.reliefErrors`), und die Statuszeile warnt, dass das Relief unvollständig ist.
- Ändert sich `../tiles/SCHEMA.md`, die Liste in `style/style.test.ts` mitziehen.
- `VECTOR_TILE_ZOOM` in `style/sources.ts` steuert, welche Kachelstufe MapLibre beim gebrochenen
  Druckzoom lädt (`"round"`: 1:25 000 → z13, 1:50 000 → z12).
- Automatisierter Export (z. B. aus Playwright):
  `await window.__capercailye.exportPdf({ scale: 25000, orientation: "portrait" })`
  liefert `{ blob, meta }` ohne Download (immer 300 dpi, `EXPORT_DPI` in `print/paper.ts`; ein
  `dpi`-Parameter existiert nur für Tests); `meta` enthält Zoom, Canvas- und Bildgröße in px/mm
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
  ab z11,5 (alle Druckmaßstäbe), bei 1:50 000 verkleinert (`SMALL_SCALE_FACTOR`). Der Layer liegt ganz oben und
  wird vor allen anderen Symbolen platziert: Beschriftungen und Piktogramme können kein Wegzeichen
  verdrängen; `icon-allow-overlap: false` mit 1,8 mm Polster dünnt nur Wegzeichen untereinander
  aus (keine Stapel an Abzweigen; das Bild mit mehr Routen gewinnt). In der Druckansicht und im
  Export liest `placement/rendered.ts` die gesetzten Wegzeichen aus MapLibres Kollisionsindex
  (interne Struktur, Stand maplibre-gl 6.18) und lässt die Piktogramme ihnen ausweichen.
- **Symbolgrößen: `src/style/sizes.ts`** (einzige Stelle, Papier-mm): Kasten-Piktogramme 3,4 mm
  (`ICON_MM`), kleine Kästen 3,0 mm, Wegzeichen-Schild 3,4 mm (`WAYMARK_MM`, Abstand 0,35 mm),
  Plain-Symbole in Stufen relativ dazu. Bei 1:50 000 gilt für Piktogramme, Haltestellen und
  Wegzeichen derselbe Faktor (`SMALL_SCALE_FACTOR` 0,85 unterhalb z12,4, `iconSizeByScale`).
- **Wichtigkeits-Hierarchie: `src/style/hierarchy.ts`** (einzige Quelle für Rangfolge). Kleiner =
  wichtiger: bleibt am Ort (Platzierung) und liegt oben. `PRIORITY`, `BUSSTOP_PRIORITY` und die
  Sortierschlüssel der Ebenen werden daraus abgeleitet. Die Klone aller verdrängten Ebenen
  (Piktogramme, Aussichtspunkte, Bushaltestellen) bilden **eine** Symbolebene `placement-icons`,
  deren Sortierschlüssel der Rang ist: Die Zeichenreihenfolge folgt der Hierarchie auch über
  Ebenen und Quellen hinweg (Bahnhof über Bushaltestelle über Restaurant).

  | Stufe     | Inhalt                                                                                                                                                              |
  | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0         | Wegzeichen (Ebene `waymarks-line`, immer oben, Rolle `obstacle`)                                                                                                    |
  | 1 (10–14) | Anreise und Schutz: Bahnhof, Haltepunkt, Bushaltestelle, Alpen-/Wildnishütte, Unterstand                                                                            |
  | 2 (20–24) | Wasser: Trinkwasser, Quelle                                                                                                                                         |
  | 3 (30–36) | Ziele: Aussichtsturm, Burg, Burgruine, Ruine, Höhle, Wasserfall, Aussichtspunkt                                                                                     |
  | 4 (40–43) | Einkehr: Restaurant, Café                                                                                                                                           |
  | 5 (50–55) | Wanderinfrastruktur: Parkplatz, benannter Wegweiser, Toiletten, Rastplatz, Grillstelle                                                                              |
  | 6 (60–64) | Übernachtung: Campingplatz, Herberge, Caravanplatz, Hotel                                                                                                           |
  | 7 (70–73) | Kirchen: Kirche, Kapelle, Gotteshaus, Denkmal                                                                                                                       |
  | 8 (80–89) | Kleine Landmarken (`poi-minor`): Türme, Masten, Windräder, Wegkreuze, Bildstöcke, Gedenksteine, Brunnen, Felsen, Dolinen, Wehre; unbenannter Wegweiser zuletzt (89) |

  Gipfelpunkte und Ortsnamen bleiben `fixed`.

- **Schalter mit Standard „aus“:** „Aussichtspunkte“ (`viewpoint`, eigene Ebene `viewpoints-main`;
  ausgeblendet nimmt er nicht an der Platzierung teil; Aussichtstürme sind immer da) und
  „Wegweisernamen“ (Gruppe `guidepostnames` ohne eigene Ebenen: sie setzt das `text-field` von
  `poi-main` und seines Namensklons; die Fähnchen bleiben).
- Der Export hat immer 300 dpi (kein Umschalter).
- Beim Drucken „Tatsächliche Größe“ / 100 % wählen, nicht „An Seite anpassen“; die
  Kontrollstrecke (10 cm) auf dem Ausdruck nachmessen.
