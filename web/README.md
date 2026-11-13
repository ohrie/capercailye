# capercailye – Web-App

Bun + Vite + TypeScript (ohne Framework), MapLibre GL JS, PMTiles, jsPDF. Stand: Meilenstein M6
(Schalter, Photon-Suche, GPX-Upload, Feinschliff der Oberfläche).

## Befehle

```sh
bun install          # Abhängigkeiten
bun run dev          # Dev-Server auf http://localhost:5173
bun run build        # Typprüfung (tsc) + Produktions-Build nach dist/
bun run preview      # Build ansehen (liefert /data/ ebenfalls aus)
bun test             # Unit-Tests (Maßstab/Zoom, Papiermaße, Blattschnitt, Stil gegen Spec und Tile-Schema)
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
├── main.ts          Karte, Zustand, Export-Ablauf (Fortschritt, Abbruch), window.__capercailye
├── sidebar.ts       Suche, Druck-Einstellungen, GPX-Panel, Ebenen-Schalter (Abschnitte, Unterschalter), Einklappen
├── search.ts        Photon-Suche (photonUrl, parsePhoton rein und getestet; initSearch: Feld, Liste, Sprung)
├── gpx.ts           GPX-Upload (normalizeTrack, areaForTrack, trackLengthKm rein und getestet; Datei, Drag-and-drop)
├── state.ts         kleiner beobachtbarer App-Zustand (Druck, Druckansicht, Sichtbarkeit, GPX-Track)
├── tiles.ts         MapLibre-Worker, pmtiles://-Protokoll, DemSource (maplibre-contour), Kachel-Log
├── config.ts        Startansicht, Pfade, Quellenangabe
├── style/           Stil als TS-Module, je Feature-Gruppe ein Baustein (index.ts setzt zusammen;
│                    gpx.ts Track-Linie und Start/Ende; palette.ts Farben, units.ts mm/pt + Zoom-Skalierung, style.test.ts prüft
│                    Spec, Layer-Ids und alle Attribute gegen ../tiles/SCHEMA.md)
├── osmc/            Wegzeichen (PLAN.md 3): parse.ts OSMC-Grammatik, shapes.ts Formen,
│                    render.ts SVG je Zeichen, Rückfallkette ref/colour → ref → Namenskürzel und
│                    kombiniertes Bild aller Routen eines Abschnitts; index.ts Bild-Id
│                    (waymarkImageExpression) und Bildlieferant „waymark:“
├── placement/       Druck-Platzierung (PLAN.md 4a): displace.ts Verdrängung (rein, getestet),
│                    collect.ts Features → Papier-mm → GeoJSON, layers.ts Klon-Layer,
│                    rendered.ts gesetzte Wegzeichen als Hindernisse, index.ts Steuerung für
│                    Vorschau (Druckansicht) und Export
└── print/           scale.ts (Maßstab↔Zoom), paper.ts, layout.ts (Blattschnitt, rein, getestet),
                     frame.ts (Gebiet, Griffe, Blattrahmen), render.ts (versteckte Karte),
                     pdf.ts (jsPDF, Blattrand), export.ts (Schleife über die Blätter)
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
- **Blattschnitt** (M5, `print/layout.ts`, PLAN.md 4): Der Nutzer legt ein **Gebiet** fest
  (`state.print.area`, Länge/Breite; gestricheltes Rechteck mit vier Eckgriffen zum Aufziehen und
  einem Mittelgriff zum Verschieben, beim Start 90 % eines Kartenfelds bei 1:25 000, nicht
  gespeichert). Daraus entsteht ein Raster aus A4-Blättern, mittig über dem Gebiet, als
  nummerierte Rahmen auf der Karte (zeilenweise von links oben; Nachbarn nur über die vier
  Kanten). Die Griffe verschieben immer das ganze Raster samt Gebiet; einzelne Blätter lassen
  sich nicht verschieben, sonst wäre die Überlappung kaputt. Während des Ziehens zeichnet nur der
  Rahmen neu, `setState` kommt erst bei `pointerup`. „Gebiet zur Kartenmitte“ verschiebt das Gebiet
  (Größe bleibt).
  - **Kartenfeld** = druckbare Fläche minus Legendenstreifen (Hochformat 194 × 270 mm). Die
    Überlappung (`OVERLAP_MM` = 10 mm) wird zwischen den Kartenfeldern gerechnet: der Streifen
    deckt die unteren 11 mm des Kartenbilds ab, mit Überlappung auf der druckbaren Fläche gäbe es
    zwischen übereinanderliegenden Blättern eine Lücke. Das Kartenbild wird über die ganze
    druckbare Fläche gerendert, Renderpunkt ist deren Mitte.
  - **Ein Zoom** für alle Blätter: `zoomForScale(Maßstab, Breite der Gebietsmitte)`
    (`layout.zoom`). Druckansicht, Platzierung und Export nutzen genau diesen Zoom. Gerechnet wird
    in globalen Papier-mm (`placement/geo.ts`), dort ist Mercator linear.
  - **Modus „Maßstab“** (Standard): 1:15 000 / 25 000 / 50 000 wählen, die Seitenzahl ergibt sich
    (`cols = ceil((w−10)/(Feldbreite−10))`, entsprechend `rows`).
  - **Modus „Seiten“:** 1, 2, 3, 4, 6, 8, 9 oder 12 Seiten wählen, der Maßstab wird berechnet:
    für jede Zerlegung `c × r = N` der Maßstab, bei dem das Raster das Gebiet gerade deckt; die
    Zerlegung mit dem kleinsten Maßstab gewinnt, aufgerundet auf volle 1 000. Grenzen 1:10 000
    (darunter ist das Raster größer als das Gebiet) und 1:50 000 (Gültigkeitsbereich der
    Stilgrößen); wird 1:50 000 überschritten, steht „Gebiet passt nicht auf N Seiten, mehr Seiten
    wählen“ da (`areaCovered = false`), der Export bleibt möglich.
  - **Höchstens 24 Blätter** (`MAX_SHEETS`): bei mehr (Maßstab-Modus) gibt es keine Blätter, nur den
    Gebietsumriss und den Hinweis „Gebiet zu groß“; der Export ist gesperrt.
  - **Druckansicht** nutzt `layout.zoom`; die Platzierungsregion ist das Raster (druckbare Flächen)
    plus 5 mm Zugabe. Im Export wird jedes Blatt einzeln platziert (Blatt + Zugabe, wie bisher):
    in den Überlappungen können verdrängte Symbole oder Namen deshalb leicht abweichen; Linien und
    Flächen sind deckungsgleich.
  - **Blattrand im PDF** (`print/pdf.ts`): Maßstabszahl, Leiste (höchstens 40 mm), Nordpfeil,
    „Blatt n von N“ (nur bei mehr als einem Blatt) laufen über einen Cursor von links nach rechts;
    die Nachbarblätter stehen als Nummer mit Pfeil mittig an jeder Kante außerhalb des Rahmens.
    Dazu Kontrollstrecke und Quellenzeile wie bisher.
- **Mehrseitiger Export** (`print/export.ts`): **ein** PDF, die Blätter in Nummernfolge, je Blatt
  eine versteckte Karte mit eigenem Mittelpunkt und gemeinsamem Zoom (300 dpi fest). Der Canvas
  wird nach `addImage` freigegeben. Die Statuszeile zeigt „Seite 3 von 6 wird gerendert …“, der
  Knopf wird währenddessen zu „Abbrechen“ (geprüft wird vor jedem Blatt, das laufende wird fertig;
  danach „Export abgebrochen“, kein Download). Dateiname `capercailye-1-21000-hoch-6-seiten.pdf`,
  bei einem Blatt `capercailye-1-25000-hoch.pdf`. Relief-Fehler werden über alle Seiten summiert.
- Automatisierter Export (z. B. aus Playwright):
  `await window.__capercailye.exportPdf({ mode: "pages", pages: 6, orientation: "portrait", area: { west: 7.70, south: 49.10, east: 7.86, north: 49.20 } })`
  liefert `{ blob, meta }` ohne Download (immer 300 dpi, `EXPORT_DPI` in `print/paper.ts`; ein
  `dpi`-Parameter existiert nur für Tests). `mode`, `pages`, `area`, `scale`, `orientation` und
  `signal` (AbortSignal) überschreiben `state.print` nur für diesen Export; ohne `area` gilt das
  Gebiet der Oberfläche (`center` ersatzweise: ein Standardblatt um diesen Punkt). `meta`:
  `scale, zoom, orientation, dpi, cols, rows, pageCount, pageMm, imageMm, reliefErrors, reduced,
  effectiveDpi, totalMs, imageFormat` und `pages[]` mit `number, col, row, center, imagePx,
  actualCanvasPx, effectiveDpi, reduced, tileZooms, renderMs, reliefErrors` je Blatt.
  `window.__capercailye.layout(settings?)` liefert das berechnete Layout (Maßstab, Zoom, Raster,
  Blätter mit `fieldMm`/`printMm`/`center`/`neighbours`, `areaCovered`, `tooLarge`) für die Prüfung.
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

  | Stufe     | Inhalt                                                                                                                                                            |
  | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0         | Wegzeichen (Ebene `waymarks-line`, immer oben, Rolle `obstacle`)                                                                                                  |
  | 1 (10–14) | Anreise und Schutz: Bahnhof, Haltepunkt, Bushaltestelle, Alpen-/Wildnishütte, Unterstand                                                                          |
  | 2 (20–24) | Wasser: Trinkwasser, Quelle                                                                                                                                       |
  | 3 (30–36) | Ziele: Aussichtsturm, Burg, Burgruine, Ruine, Höhle, Wasserfall, Aussichtspunkt                                                                                   |
  | 4 (40–43) | Einkehr: Restaurant, Café                                                                                                                                         |
  | 5 (50–55) | Wanderinfrastruktur: Parkplatz, benannter Wegweiser, Toiletten, Rastplatz, Grillstelle                                                                            |
  | 6 (60–64) | Übernachtung: Campingplatz, Herberge, Caravanplatz, Hotel                                                                                                         |
  | 7 (70–73) | Kirchen: Kirche, Kapelle, Gotteshaus, Denkmal                                                                                                                     |
  | 8 (80–89) | Kleine Landmarken (`*-minor`): Türme, Masten, Windräder, Wegkreuze, Bildstöcke, Gedenksteine, Brunnen, Felsen, Dolinen, Wehre; unbenannter Wegweiser zuletzt (89) |

  Gipfelpunkte und Ortsnamen bleiben `fixed`.

- **Schalter mit Standard „aus“:** „Aussichtspunkte“ (`viewpoint`, eigene Ebene `viewpoints-main`;
  ausgeblendet nimmt er nicht an der Platzierung teil; Aussichtstürme sind immer da) und
  „Wegweisernamen“ (Gruppe `guidepostnames` ohne eigene Ebenen: sie setzt das `text-field` von
  `guideposts-main` und seines Namensklons; die Fähnchen bleiben). „Wegweisernamen“ ist
  Unterschalter von „Wegweiser“.

### M6: Schalter, Suche, GPX, Oberfläche

- **Schalter** (Panel „Ebenen“, drei klappbare `<details>`-Abschnitte, alle zunächst offen).
  Jede beschriftete Gruppe in `GROUPS` (`style/index.ts`) trägt `section` (`routes`, `terrain`,
  `symbols`) und optional `parent` (Unterschalter: eingerückt, bei ausgeschaltetem Elternschalter
  `disabled`, sein Wert bleibt). Die Anzeigereihenfolge steht in `UI_ORDER` (die Zeichenreihenfolge
  ist die Reihenfolge in `GROUPS`). `onToggle(map, visible, visibility)` bekommt die ganze
  Sichtbarkeit.
  - **Routen:** Wanderrouten (Unterschalter International, National, Regional, Lokal), Wegzeichen
    (eigener Schalter, nicht mehr an die Routen gekoppelt).
  - **Gelände und Karte:** Schummerung, Höhenlinien, Schutzgebiete, Gebäude, Beschriftung.
  - **Symbole:** neun Kategorien (siehe unten), Aussichtspunkte (Standard aus), Wegweiser mit
    Unterschalter Wegweisernamen (Standard aus), Bushaltestellen, „Weitere Symbole“ (Gruppe
    `poi`: Bahnhöfe, Kirchen, Höhlen, Quellen, Türme, Kreuze …).
- **POI-Kategorien** (`style/poi.ts`, Tabelle `POI_CATEGORIES`): Schutzhütten, Einkehr,
  Wanderparkplätze, Rast- und Grillplätze, Unterkünfte, Toiletten, Trinkwasser/Brunnen,
  Burgen/Ruinen/Denkmäler, Wegweiser. Jede Kategorie ist eine **eigene Gruppe mit eigenen Ebenen**
  `<id>-main` (und `<id>-minor` für die kleinen Arten, z. B. Brunnen, Gedenkstein, unbenannter
  Wegweiser). Grund: `placement/collect.ts` liest den Filter aus der ursprünglichen Spec; ein
  Laufzeit-`setFilter` auf `poi-main` käme dort nicht an. Ein- und Ausschalten geht wie bei
  `viewpoints` über die Sichtbarkeit. `poi-main` und `poi-minor` schließen alle Kategorie-Arten
  (und die Aussichtspunkte) aus; unbekannte Arten bleiben in `poi-main`. Gruppen-IDs dürfen kein
  Präfix fremder Ebenen-IDs sein (daher `drinking`).
- **Netz-Filter** (B3): Der Tile-Layer `routes` hat nur `network` = _höchstes_ Netz des
  Abschnitts (`iwn > nwn > rwn > lwn`, fehlt sonst). `routeNetworkFilter(visibility)` (`style/routes.ts`,
  rein) liefert den Ausschluss (oder `null`, wenn alle an sind); er steckt beim Stilbau in
  `routes-band` und `waymarks-line` (der Export stimmt also) und wird auf der Hauptkarte per
  `setFilter` gesetzt (`setRouteNetworks`). „Lokal“ umfasst auch Abschnitte ohne `network`.
  Wegzeichen sind Rolle `obstacle`: die Platzierung liest deren gesetzte Kästen, daher wirkt
  `setFilter` dort. **Grenze:** gefiltert wird nach dem höchsten Netz. Ein Abschnitt mit
  regionaler und lokaler Route verschwindet, wenn „Regional“ aus und „Lokal“ an ist, und ein
  sichtbarer Abschnitt zeigt im Wegzeichenbild weiter alle Zeichen, auch die eines
  ausgeschalteten Netzes. Sauber ginge es nur mit dem Netz je Route in den Tiles.
- **Photon-Suche** (`src/search.ts`): Feld oben in der Seitenleiste, ab 3 Zeichen, 300 ms
  Entprellung, laufende Anfrage wird abgebrochen. Anfrage:
  `GET https://photon.komoot.io/api?q=…&lang=de&limit=8&lat=…&lon=…`, **nur diese Parameter**; `lat`/`lon`
  sind die Kartenmitte auf drei Nachkommastellen (etwa 100 m) als Ortsbezug, kein Zoom, keine
  IDs, `credentials: "omit"`, `referrerPolicy: "no-referrer"`. Datenschutz: komoot sieht also
  Suchtext, grobe Kartenmitte und die IP-Adresse; nichts davon wird gespeichert oder an andere
  weitergegeben. Ergebnisliste als `combobox`/`listbox` (↑/↓, Enter, Escape; `/` fokussiert das
  Feld außerhalb von Eingabefeldern); Enter ohne Auswahl springt zum ersten Treffer. Sprung: mit
  `extent` `fitBounds` (Rand 40 px, höchstens Zoom 15), sonst `flyTo` Zoom 14; in der
  Druckansicht nur `setCenter`. Das Gebiet bleibt, wo es ist. Photon liefert `extent` als
  `[minLon, maxLat, maxLon, minLat]`, `parsePhoton` dreht das um. Fehler (offline, HTTP-Fehler,
  10 s ohne Antwort): „Suche nicht erreichbar – Internetverbindung prüfen“. Die Quelle steht in
  der Fußzeile der Seitenleiste (nicht im PDF-Blattrand).
- **GPX** (`src/gpx.ts`, `@tmcw/togeojson`): „GPX-Datei laden“ oder Datei auf die Karte ziehen.
  Tracks und Routen (`trk`, `rte`) werden Linien, Wegpunkte werden ignoriert. Danach liegt das
  **Gebiet auf dem Track** (Hülle plus 10 % je Seite, mindestens 300 m, `areaForTrack`) und die
  Karte zeigt es (in der Druckansicht nur Mitte, Zoom bleibt gesperrt). Das Panel zeigt Name,
  Länge (Haversine) und die Knöpfe „Gebiet auf Track setzen“ und „Track entfernen“. Der Track wird
  nicht gespeichert (wie das Gebiet). Fehler: „Keine Spur in der Datei“, „Datei ist kein lesbares
  GPX“.
  - **Darstellung** (`style/gpx.ts`): Magenta `COLORS.gpx` (`#d4007f`, Aufdruckfarbe der
    Orientierungslauf-Karten), Linie 0,7 mm bei 80 % Deckkraft, über den Straßen und unter den
    Namen (Gruppe `gpx` ohne Schalter). Start: weißer Kreis mit magentafarbenem Rand, Ende:
    derselbe Kreis mit magentafarbenem Punkt (2,4 mm außen, Rand 0,4 mm, Punkt 1,0 mm; Konstanten in
    `style/sizes.ts`). Start und Ende sind Kreis-Ebenen der Rolle `fixed`: sie bewegen sich nie,
    Piktogramme weichen aus. Die Linie ist kein Hindernis.
  - **Datenfluss:** Die Quelle `gpx` (GeoJSON, Features mit `_kind` `line`/`start`/`end`) ist
    immer im Stil (leer ohne Track), damit `withPlacementLayers` die `fixed`-Ebenen von Anfang an
    kennt. `StyleOptions.gpx` füllt sie; `currentStyle()` in `main.ts` übergibt den Track an die
    versteckte Export-Karte, die Hauptkarte bekommt ihn per `setData` (danach `placement.sync()`).
- **Automationshaken:** `window.__capercailye.loadGpx(text)` verhält sich wie die Dateiauswahl
  (Zustand, Gebiet, Kartenausschnitt; liefert `{ track }` oder `{ error }`),
  `window.__capercailye.clearGpx()` entfernt den Track.
- Der Export hat immer 300 dpi (kein Umschalter).
- Beim Drucken „Tatsächliche Größe“ / 100 % wählen, nicht „An Seite anpassen“; die
  Kontrollstrecke (10 cm) auf dem Ausdruck nachmessen.
