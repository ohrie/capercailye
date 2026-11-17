# capercailye – Website und Web-App

Ein Astro-Projekt (Bun) für die ganze Website: die statische Landingpage auf Englisch (`/`) und
Deutsch (`/de/`), die nur deutschen Rechtsseiten (`/impressum/`, `/datenschutz/`, `/quellen/`) und
die Karten-App (`/app/`, Deutsch und Englisch). Sprachen: siehe „Sprachen (i18n)“.
Die App ist TypeScript ohne Framework (MapLibre GL JS, PMTiles, jsPDF) und wird von
`src/pages/app/index.astro` als Client-Skript geladen. Auch das Bottom Sheet für schmale Bildschirme
([Cupertino Pane](https://github.com/roman-rr/cupertino-pane), siehe „Mobil“) ist Vanilla-TypeScript. Funktionen: Ebenen-Schalter, Photon-Suche,
GPX-Upload, Blattschnitt und mehrseitiger PDF-Export. Spec der Landingpage: `../SPEC.md`, Abschnitt 4.9.

## Befehle

```sh
bun install          # Abhängigkeiten
bun run dev          # Dev-Server auf http://localhost:5173 (Landingpage /, /de/, App /app/)
bun run i18n         # Texte kompilieren: messages/*.json -> src/paraglide/ (nicht im Repo)
bun run build        # i18n, Typprüfung (tsc) + Produktions-Build nach dist/
bun run preview      # Build ansehen (ohne Kartendaten, siehe „Daten“)
bun test             # Unit-Tests (Maßstab/Zoom, Papiermaße, Blattschnitt, Stil gegen Spec und Tile-Schema,
                     # Textkataloge, Spracherkennung); kompiliert die Texte vorher (bunfig.toml)
bun run fmt          # Formatieren mit oxfmt
bun run fmt:check    # Formatierung prüfen
bun run logo         # public/logo.svg, favicon.svg und app/logo.svg aus der Pixelmatrix erzeugen
bun run snapshots    # Landingpage-Bilder nach public/img/ rendern (siehe „Landingpage“)
```

Die Typprüfung läuft mit `tsc --noEmit` über die TypeScript-Dateien. `astro check` unterstützt
TypeScript 7 noch nicht, die `.astro`-Dateien werden deshalb nicht typgeprüft; oxfmt kennt `.astro`
nicht und lässt sie aus (`.oxfmtrc.json`).

## Daten

Die PMTiles werden nicht ins Repo kopiert. `astro preview` ruft die Preview-Hooks von Vite-Plugins nicht
auf, `/app/data/` gibt es deshalb nur im Dev-Server. Der Dev-Server liefert `/app/data/*` aus
dem Verzeichnis `CAPERCAILYE_DATA` mit Range-Requests (206) aus (`/app/data/*`). Der Wert kommt aus der Umgebung
(`CAPERCAILYE_DATA=/pfad bun run dev`) oder aus der gitignorten Datei `web/.env.local`; Standard ist
`~/.local/share/capercailye`. Erwartet wird die Datei aus `PMTILES_PATH` in `src/config.ts` (Standard `capercailye-rp.pmtiles`) (Schema:
`../tiles/SCHEMA.md`). Optional ist `capercailye-busstops.pmtiles` (GTFS-Bushaltestellen aus
`../transit/`, Layer `bus_stop`, Attribute `name`, `sat`, `sun`, `min`, Zoom 10–14, SPEC.md 5):
`src/data.ts` prüft beim Start per Range-Request auf die PMTiles-Kennung; fehlt die Datei, wird
weder Quelle noch Gruppe `busstops` in den Stil aufgenommen (sonst würde MapLibre nie `idle`
melden und Platzierung und Export hingen), und der Schalter „Bushaltestellen“ ist deaktiviert.
Die Quellenangabe der Haltestellen steht als `BUSSTOPS_CREDIT` in `src/config.ts` (Datenstand siehe „Modi, Legende, Datenstand“).

### Build-Variablen (Deployment)

| Variable            | Standard                      | Wirkung                                                                                                                                       |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_PMTILES_PATH` | `data/capercailye-rp.pmtiles` | PMTiles-Datei relativ zu `/app/`; aus dem Namen (`capercailye-<gebiet>.pmtiles`) wird das Relief-Credit-Gebiet abgeleitet (`rp`, `bw`, `de`). |

Die Seite läuft an der Wurzel (`base: "/"`), die App liegt fest unter `/app/` (`APP_BASE` in
`src/config.ts`); Schriften (`/app/fonts/`) und Daten (`/app/data/`) hängen daran. Astro gibt
Variablen sonst nur mit Präfix `PUBLIC_` frei, `vite.envPrefix` in `astro.config.mjs` ergänzt `VITE_`.

Beispiel: Deutschland-Build

```sh
VITE_PMTILES_PATH=data/capercailye-de.pmtiles bun run build
```

Das Relief (Schummerung und Höhenlinien) kommt online vom Mapterhorn-Kacheldienst (Terrarium-DEM,
512-px-WebP) und wird über [maplibre-contour](https://github.com/onthegomap/maplibre-contour)
(BSD-3-Clause) verarbeitet. Die Höhenlinien entstehen clientseitig im Browser, es gibt dafür keine
Kacheldatei.

## Aufbau

```
src/
├── main.ts          Karte, Zustand, Modi, Export-Ablauf (Fortschritt, Abbruch), window.__capercailye
├── sidebar.ts       Suche, Modusschalter, Druck-Einstellungen, GPX-Panel, Ebenen-Schalter mit Legende (Abschnitte, Unterschalter), Einklappen
├── mode.ts          Modi Erkunden/Zeichnen/Seiten (rein): interactionFor, dragRect, areaOutside
├── legend.ts        Legenden-Symbole der Schalter (rein): legendSvg(groupId)
├── credits.ts       Quellenangaben mit Datenstand (rein): formatStand, osmStand, gtfsStand, buildCredits (HTML, Sidebar-Teile, PDF-Zeile)
├── search.ts        Photon-Suche (photonUrl, parsePhoton rein und getestet; initSearch: Feld, Liste, Sprung)
├── gpx.ts           GPX-Upload (normalizeTrack, areaForTrack, trackLengthKm rein und getestet; Datei, Drag-and-drop)
├── state.ts         kleiner beobachtbarer App-Zustand (Modus, Druck, Druckansicht, Sichtbarkeit, GPX-Track)
├── tiles.ts         MapLibre-Worker, pmtiles://-Protokoll, DemSource (maplibre-contour), Kachel-Log
├── config.ts        Startansicht, Pfade, Quellenangaben (Funktionen, je Sprache)
├── i18n.ts          Sprache der App (Paraglide-Strategie: ?lang=, Browser, en), detectLocale, Zahlenformat
├── translate-dom.ts Statisches App-Markup in die aktive Sprache setzen (data-i18n), ganz zu Beginn
├── paraglide/       ERZEUGT aus ../messages/*.json (gitignored): `m.<schlüssel>()`, runtime
├── style/           Stil als TS-Module, je Feature-Gruppe ein Baustein (index.ts setzt zusammen;
│                    gpx.ts Track-Linie und Start/Ende; palette.ts Farben, units.ts mm/pt + Zoom-Skalierung, style.test.ts prüft
│                    Spec, Layer-Ids und alle Attribute gegen ../tiles/SCHEMA.md)
├── osmc/            Wegzeichen-Bilder (SPEC.md 4.5): parse.ts OSMC-Grammatik, shapes.ts Formen,
│                    render.ts SVG je Zeichen, Rückfallkette ref/colour → ref → Namenskürzel
│                    (kombinierte Bilder nur für Legende/Musterblatt); index.ts Bild-Id
│                    (waymarkImageId) und Bildlieferant „waymark:“
├── waymarks/        Wegzeichen einzeln entlang der Wege (SPEC.md 4.5), rein und getestet:
│                    clip.ts (Linie auf Tile-Fläche), routes.ts (Routen, Netz-Schalter je Route),
│                    signs.ts (Zeichen je Abschnitt, Größe in mm), graph.ts (Stücke → Abschnitte
│                    zwischen Gabelungen), plan.ts (Positionen, Überdeckungsfreiheit); tiles.ts
│                    (Layer `routes`/`poi` der z12-Tiles aus der PMTiles-Datei), index.ts
│                    (computeWaymarks, WaymarkController)
├── placement/       Druck-Platzierung (SPEC.md 4.4): displace.ts Verdrängung (rein, getestet),
│                    collect.ts Features → Papier-mm → GeoJSON, layers.ts Klon-Layer,
│                    thin.ts Ausdünnung in Städten (Gastronomie, Toiletten, Hotels; greedy), index.ts Steuerung für
│                    Vorschau (Druckansicht) und Export
└── print/           scale.ts (Maßstab↔Zoom), paper.ts, layout.ts (Blattschnitt, rein, getestet),
                     frame.ts (Gebiet, Griffe, Blattrahmen), draw.ts (Gebiet aufziehen), render.ts (versteckte Karte),
                     pdf.ts (jsPDF, Blattrand), export.ts (Schleife über die Blätter)
public/app/fonts/    Noto Sans Regular/Italic/Medium als Glyph-PBF (Bereiche 0–511, 8192–8447;
                     aus protomaps/basemaps-assets, Lizenz OFL 1.1, siehe OFL.txt), unter /app/fonts/
vite-plugin-serve-data.ts   /app/data/ mit Range-Unterstützung
```

Außerhalb von `src/` (Website und Konfiguration):

```
astro.config.mjs    Astro- und Vite-Konfiguration (serveData, envPrefix, Build-Ziel, Lizenzdatei)
src/pages/          index.astro (Landingpage en, /), de/index.astro (Landingpage de, /de/; beide rendern
                    components/Landing.astro), impressum/, datenschutz/, quellen/ (nur deutsch),
                    app/index.astro (App-Hülle, lädt src/main.ts)
src/layouts/        Base.astro (<head>, Analytics), Site.astro (+ Stylesheet, theme-color),
                    Legal.astro (Rechtsseiten: Kopf, Fuß, mail.js)
src/components/     Analytics.astro, SiteFooter.astro, Landing.astro (die Landingpage, Sprache als Prop)
messages/           en.json, de.json: alle übersetzten Texte (Paraglide, inlang-Nachrichtenformat)
project.inlang/     inlang-Projekt (Sprachen, Plugin); paraglide.config.mjs: Compiler-Optionen
bunfig.toml         kompiliert die Texte vor `bun test`
src/site.css        Farb-Tokens (aus src/style/palette.ts) und Layout der Landingpage und Rechtsseiten
public/             wird unverändert nach / kopiert: logo.svg, favicon.svg, robots.txt, sitemap.xml,
                    mail.js, img/ (Karten-Screenshots), app/ (Schriften, logo.svg, licenses-extra.txt)
scripts/            logo.ts (Logo aus Pixelmatrix), snapshots.ts (Screenshots), sample-dahn.gpx
```

## Mobil

Unter 768 px Breite (`MOBILE_QUERY` in `src/sheet.ts`, dieselbe Grenze in `app.css`) liegt die
Sidebar nicht mehr als Spalte neben der Karte, sondern in einem Bottom Sheet ([Cupertino
Pane](https://github.com/roman-rr/cupertino-pane), framework-frei). Die Karte füllt den Bildschirm.
Das Sheet ist immer offen, ohne Backdrop, nicht schließbar (kein Close-Button, kein Wegwischen nach
unten) und hat drei Rastpunkte: eingeklappt (Griff, Kopfzeile, Suchfeld; die Höhe wird gemessen),
halb, fast ganz. Der Inhalt scrollt nur im obersten Rastpunkt; darunter und bei Inhalt ganz oben
zieht ein Wisch das Sheet (Verhalten der Bibliothek).

- `src/mobile-sheet.ts` baut die Sidebar nicht nach: das vorhandene `#sidebar` wird per
  `appendChild` in das Pane verschoben und beim Wechsel auf Desktop an seinen Platz in `.app`
  zurückgesetzt (das Pane wird dabei zerstört, beim Zurückwechseln neu angelegt). Die Listener aus
  `sidebar.ts` bleiben, die Reihenfolge der Initialisierung ist egal (`sidebar.ts` sucht per Id im
  Dokument). Initialisiert wird in einem eigenen `<script>` auf `src/pages/app/index.astro`,
  unabhängig vom Start der Karte.
- Die Bibliothek wird nur auf schmalen Bildschirmen per dynamischem `import()` geladen (eigener
  Chunk, rund 64 kB roh, 14 kB gzip); auf dem Desktop wird sie nicht abgerufen.
- Die Rastpunkte sind Pixelhöhen (halbe Fensterhöhe, Fensterhöhe minus 40 px, gemessene
  Einklapphöhe) und werden bei Größenänderung und Drehen neu gesetzt.
- Die Optik kommt aus den CSS-Variablen `--cupertino-pane-*` und wenigen Überschreibungen am Ende
  von `app.css` (Tokens der App, keine eigenen Farben).
- `collapseSheet()` (`src/sheet.ts`) klappt das Sheet ein; `main.ts` ruft es beim Wechsel in den Modus
  „Zeichnen“ oder „Seiten“ und beim Exportstart, `search.ts` nach der Wahl eines Suchtreffers. Ein
  Fokus im Suchfeld öffnet das Sheet auf halbe Höhe, damit die Trefferliste sichtbar ist.
- `#sidebar-collapse` und `#sidebar-expand` sind mobil ausgeblendet.

## Landingpage

Statische Seite in zwei Sprachen (`src/components/Landing.astro`, aufgerufen von `src/pages/index.astro`
(en) und `src/pages/de/index.astro` (de); `src/site.css`, kein Client-Framework), SEO-Meta, Open Graph
und JSON-LD stehen im `<head>` der Seite (je Sprache übersetzt, mit `canonical`, `hreflang` und
`og:locale`). Spec: `../SPEC.md`, Abschnitt 4.9.

- `public/mail.js` setzt die Kontaktadresse erst im Browser zusammen (Impressum, Datenschutz).
- `src/pages/impressum/`, `datenschutz/`: Rechtsseiten (deutsch). `quellen/`: Quellen und Lizenzen
  (deutsch; OSM, Relief je Land, Haltestellen, Schriften, Bibliotheken); verlinkt aus dem Fuß, der
  App-Sidebar und der Karten-Attribution; noindex, nicht in der Sitemap.
- `public/img/`: Karten-Screenshots (`dahn`, `calmont`, `schwarzwald`, `feldberg`, `gpx`, `print`, je
  `.jpg` und `@2x.jpg`) und `og-image.jpg`, erzeugt von `scripts/snapshots.ts`. Das Skript braucht
  zwei Dev-Server (`bunx astro dev --port 5180` für Rheinland-Pfalz, ein zweiter auf 5181 mit einem
  `CAPERCAILYE_DATA`-Verzeichnis, in dem `capercailye-rp.pmtiles` auf die Baden-Württemberg-Datei
  zeigt) und einen Chrome (`CHROME_PATH`), Details im Kopf des Skripts.
- Die Domain steht fest in `canonical`, `hreflang`, `og:*`, `twitter:image`, JSON-LD (`ORIGIN` in
  `Landing.astro`), `robots.txt` und `sitemap.xml` (mit `/de/` und `xhtml:link`-Alternativen).

### Sprachen (i18n)

Alles Übersetzte (Landingpage und App) steht in einem Katalog: `messages/en.json` (Basissprache) und
`messages/de.json`, verwaltet mit [Paraglide JS](https://paraglidejs.com) (`@inlang/paraglide-js`
2.x, inlang-Projekt in `project.inlang/`). Impressum, Datenschutz und Quellen sind bewusst nur
deutsch (deutsches Recht); ihre Sprachauswahl im Kopf speichert nur die Wahl und führt zur Landingpage
in der gewählten Sprache. Sonst gibt es keinen verlinkten Wechsel zwischen den Sprachen (nur
`hreflang` im `<head>`).

**Wie die Sprache bestimmt wird**

- _Landingpage:_ Die Sprache steckt in der URL, `/` ist Englisch (Standardsprache, ohne Präfix),
  `/de/` Deutsch (Astro-i18n-Routing, `astro.config.mjs`). Beide Seiten rendern dieselbe Komponente
  mit `locale` als Prop; jede Nachricht wird zur Bauzeit mit `m.schlüssel(eingaben, { locale })`
  geholt, nichts hängt am Browser. Wer von `/` nach `/de/` kommt, entscheidet nginx anhand von
  `Accept-Language` (`../deploy/web/nginx.conf`): ist die erste Sprache Deutsch, gibt es auf `/` ein
  302 nach `/de/`, sonst die englische Seite (`Vary: Accept-Language, Cookie`). Ein Cookie `lang=de|en`
  hat Vorrang vor `Accept-Language` (`lang=de` leitet um, `lang=en` nie); es wird nur gesetzt, wenn
  jemand in der Sprachauswahl wählt (`src/components/LangSelect.astro`, im Kopf der Landingpage, der
  Rechtsseiten und der App-Sidebar identisch; `src/lang-switch.ts`, `src/lang-cookie.ts`).
  `/de/` und alle anderen Pfade werden nie umgeleitet. Im Dev-Server gibt es die
  Weiterleitung nicht, `/de/` ruft man direkt auf.
- _App:_ Die App ist eine einzige statische HTML-Datei, die Sprache wird im Browser bestimmt
  (`detectLocale` in `src/i18n.ts`, als eigene Paraglide-Client-Strategie `custom-appLanguage`,
  siehe `paraglide.config.mjs`): 1. URL-Parameter `?lang=de|en` (zum Testen und Verlinken, wird nicht
  gespeichert), 2. das Cookie `lang` (`de|en`), 3. die erste Sprache in `navigator.languages`, die mit
  `de` oder `en` beginnt, 4. sonst Englisch. Das Cookie schreibt nur die Sprachauswahl (links neben dem Einklappen-Knopf im
  Kopf der Sidebar), und nur bei der Wahl: Cookie setzen, Seite neu laden (ein `?lang=` wird dafür aus
  der URL entfernt). Beim Start zeigt sie die erkannte Sprache (`initLangSelect(getLocale())`). Es gibt kein localStorage.
  `src/pages/app/index.astro` wird einmal auf Englisch gerendert (Texte per `data-i18n="schlüssel"`,
  Attribute per `data-i18n-title`, `-aria-label`, `-placeholder`, `-alt`); `src/translate-dom.ts`
  setzt als erstes Skript der Seite `<html lang>`, `<title>` und alle Texte in die aktive Sprache,
  bevor die Karte startet. Bis dahin ist die Sidebar per Inline-Style unsichtbar (kein Aufflackern).
  Alle Texte im TypeScript kommen aus `m.…()` (Zeilen der Sidebar, Suche, Exportstatus, PDF-Rand,
  Quellenangaben); Zahlen und Daten nutzen die aktive Locale (`formatNumber` in `src/i18n.ts`,
  `formatStand` in `credits.ts`, `formatScale`/`formatDistance` in `print/scale.ts`). Die Suche
  fragt Photon mit `lang=<Sprache>`; Ortsnamen auf der Karte bleiben, wie sie in OSM stehen. Die
  Meldungen des Dev-Servers (`vite-plugin-serve-data.ts`) sind nicht übersetzt.

**Wo die Texte liegen und wie man einen hinzufügt**

1. Schlüssel (`bereich_name`, Kleinbuchstaben und Unterstriche) mit Text in beiden Dateien eintragen,
   gleicher Schlüssel, gleiche Platzhalter (`{name}`): `"app_status_page": "Seite {n} von {total} …"`.
   Mehrzahl: Variantennachricht mit `local countPlural = count: plural` (Beispiel `app_pages_count`).
   Enthält ein Text Links oder `<b>`, endet der Schlüssel auf `_html` und kommt per `set:html` in die
   Seite (nur Konstanten einsetzen); Link-Ziele als Platzhalter (`{url}`).
2. `bun run i18n` (oder `bun run dev`, das beim Start und bei Änderungen neu kompiliert). Danach gibt
   es `m.neuer_schluessel(eingaben?, { locale? })` aus `src/paraglide/messages.js` (typisiert, Tippfehler
   scheitern an `tsc`).
3. Im Code `m.neuer_schluessel(...)` aufrufen (ohne `locale` gilt die aktive Sprache), im App-Markup
   `data-i18n` ergänzen (und denselben Text im Markup per `t("…")` einsetzen), in `Landing.astro`
   `t("…")` verwenden. Texte nie beim Import in Konstanten auswerten (die Sprache steht erst nach
   dem Laden von `src/i18n.ts` fest): Getter oder Funktionen, wie `LayerGroup.label` und `osmCredit()`.
4. `bun test`: `src/messages.test.ts` prüft, dass beide Dateien dieselben Schlüssel, keine leeren Werte
   und je Schlüssel dieselben Platzhalter haben und dass alle im Markup verwendeten Schlüssel
   existieren.

`src/paraglide/` ist erzeugt und nicht im Repo. Es entsteht bei `astro dev` und `astro build` (Vite-
Plugin) und durch `bun run i18n` (`scripts/i18n-compile.ts`), das `bun run build` vor `tsc` und
`bun test` über `bunfig.toml` vorab ausführt; der Docker-Build ruft `bun run build` auf und braucht
nichts weiter. Tests, die Texte prüfen, geben die Sprache ausdrücklich mit (`buildCredits({ locale })`,
`formatScale(…, "de")`); ohne Angabe gilt im Test Englisch.

**Begriffe (de ↔ en)**: App und Landingpage verwenden dieselben Wörter.

| Deutsch                                                                                | Englisch                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Seiten (A4-Seiten des Blattschnitts), Seitenzahl; im PDF „Blatt 3 von 6“               | pages, number of pages; in the PDF "Page 3 of 6"                     |
| Gebiet (zu druckender Ausschnitt), Gebiet zeichnen                                     | area, draw area                                                      |
| Erkunden · Zeichnen · Seiten (Modi 1–3)                                                | Explore · Draw · Pages                                               |
| Maßstab, Druckansicht, Druckzoom, Ausrichtung Hoch/Quer                                | scale, print view, print zoom, orientation Portrait/Landscape        |
| A4-PDF exportieren                                                                     | export an A4 PDF                                                     |
| Ebenen, Schummerung, Höhenlinien                                                       | layers, hillshade, contour lines                                     |
| Wanderrouten, Wegzeichen, Wegweiser                                                    | hiking routes, waymarks, guideposts                                  |
| Schutzhütten, Einkehr, Wanderparkplätze, Rast- und Grillplätze                         | shelters, places to eat, hiking car parks, picnic and barbecue sites |
| GPX-Track, Gebiet auf Track setzen                                                     | GPX track, set area to track                                         |
| bearbeitet, ausgewertet, Stand                                                         | modified, analysed, as of                                            |
| Impressum, Datenschutz, Quellen und Lizenzen (Fuß; Ziele bleiben die deutschen Seiten) | Legal notice, Privacy, Sources and licences                          |

Die Lizenznamen (ODbL, CC BY 4.0, dl-de/by-2-0 …) und die Herausgeber (GeoBasis-DE, LVermGeoRP, LGL,
DELFI) bleiben in beiden Sprachen gleich; der Hinweis auf die Bearbeitung („bearbeitet“/„modified“,
„ausgewertet“/„analysed“) muss in jeder Fassung stehen (Lizenzpflicht, siehe `credits.test.ts`).

### Logo

`MATRIX` in `scripts/logo.ts` bearbeiten (24 × 24, ein Zeichen je Pixel, `.` = leer) und
`bun run logo` ausführen. Ein `<path>` je Farbe, `shape-rendering="crispEdges"`. Legende: `K` Körper
`#1f1f1f`, `T` Schwanzfedern `#3a3a3a`, `B` Flügel `#6e5a46`, `G` Brustschimmer `#3c7d3f`, `R`
Rose `#be2230`, `W` Schnabel / weiße Flecken `#eeebc6`. Geschrieben werden `public/logo.svg`,
`public/favicon.svg` und `public/app/logo.svg` (Favicon der App).

### Bilder-Rückfall

Die Galerie hat eine einzeilige Bildquelle (OSM, Relief, Bushaltestellen, Link auf `/quellen/`); sie
muss zu dem passen, was die Screenshots zeigen.

Jedes Bild steckt in einer `.shot`-Figure mit Hintergrund `--forest-light` und Seitenverhältnis 3:2.
Das `<img>` zeigt schon auf seine endgültige Datei und ist in der Figure absolut positioniert.
Fehlt die Datei, hat das Bild `color: transparent; font-size: 0` (Alt-Text unsichtbar), und ein
`img::after` in der Platzhalterfarbe verdeckt das Symbol für das kaputte Bild (Chrome und Firefox
zeichnen Pseudo-Elemente auf kaputten Bildern, geladene Bilder nicht). Der Alt-Text bleibt für
Screenreader erhalten.

### Bereitstellung

Landingpage unter `/`, App unter `/app/`; alle Buttons verlinken auf `/app/`. Astros gehashte Dateien
liegen unter `/_astro/` (der MapLibre-Worker `.mjs` auch).

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
- **Blattschnitt** (M5, `print/layout.ts`, SPEC.md 4.3): Der Nutzer legt ein **Gebiet** fest
  (`state.print.area`, Länge/Breite; gestricheltes Rechteck mit vier Eckgriffen zum Aufziehen und
  einem Mittelgriff zum Verschieben, beim Start 90 % eines Kartenfelds bei 1:25 000, nicht
  gespeichert). Daraus entsteht ein Raster aus A4-Blättern, mittig über dem Gebiet, als
  nummerierte Rahmen auf der Karte (zeilenweise von links oben; Nachbarn nur über die vier
  Kanten). Die Griffe verschieben immer das ganze Raster samt Gebiet; einzelne Blätter lassen
  sich nicht verschieben, sonst wäre die Überlappung kaputt. Während des Ziehens zeichnet nur der
  Rahmen neu, `setState` kommt erst bei `pointerup`.
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
    plus 5 mm Zugabe. Im Export wird jedes Blatt einzeln platziert (Blatt + Zugabe):
    in den Überlappungen können verdrängte Symbole oder Namen deshalb leicht abweichen; Linien und
    Flächen sind deckungsgleich.
  - **Blattrand im PDF** (`print/pdf.ts`): Maßstabszahl, Leiste (höchstens 40 mm), Nordpfeil,
    „Blatt n von N“ (nur bei mehr als einem Blatt) laufen über einen Cursor von links nach rechts;
    die Nachbarblätter stehen als Nummer mit Pfeil mittig an jeder Kante außerhalb des Rahmens.
    Dazu der Druckhinweis (oben rechts) und die einzeilige Quellenzeile über die volle Streifenbreite
    (`creditFontSize`: bis 4 pt verkleinert, wenn sie breiter ist).
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
- **Symbole entfallen im Druck nie** (SPEC.md 4.4): Symbol-Layer mit Metadaten
  `"capercailye:placement": "displace"` (Piktogramme) werden in der Druckansicht und im Export
  durch Klone auf der GeoJSON-Quelle `placement` ersetzt (Layer beliebiger Vektorquellen, auch
  `busstops`; Features ohne id werden über Koordinate und Name dedupliziert). `src/placement` holt die Punkte aus den
  Kacheln, rechnet sie in Papier-mm und schiebt überlappende Symbole nach Priorität
  (`symbol-sort-key`) um höchstens 4 mm auseinander; ab 0,5 mm Abstand zur wahren Lage zeigt ein
  feiner Strich dorthin. Namen sind ein eigener Layer und dürfen entfallen. `"fixed"` (Gipfelpunkte,
  Ortsnamen) bleibt stehen und hält Piktogramme fern. Die Wegzeichen (siehe nächster Punkt) haben
  keine Rolle: ihre berechneten Kästen gehen als Hindernisse (`PlaceOptions.obstacles`) in die
  Platzierung. Außerhalb der Druckansicht gilt MapLibres normale Kollision.
- **Ausdünnung in Städten (Gastronomie, Toiletten, Hotels):** Restaurants/Cafés, Toiletten und
  Hotels mit `urban=true` werden greedy ausgedünnt (`placement/thin.ts`, `greedyThin`: absteigend
  nach Rang `weight`, `tags`, ID; ein Eintrag bleibt, wenn kein behaltener **derselben Gruppe**
  näher als `URBAN_THIN_MIN_MM` (8 mm) liegt). Die Gruppen (`THIN_GROUPS`, `thinGroup(kind)`) sind
  getrennt: Gastronomie (Restaurant + Café), Toiletten, Hotels; ein Hotel verdrängt nie eine
  Toilette. Greedy hängt von der ganzen Nachbarschaft ab; damit Vorschau und alle Exportseiten
  übereinstimmen, wird die Menge der behaltenen Einträge **einmal je Blattschnitt** aus den
  z12-Tiles berechnet (gleiche Grundlage und gleicher Durchlauf wie die Wegzeichen,
  `computeWaymarks(...).urban`, auch bei ausgeschalteten „Wanderrouten“) und an `computePlacement`
  übergeben (`PlacementRequest.urban`, Ersatz ohne Menge: `thinUrban` rechnet greedy über die
  eigenen Kandidaten).
- **Wegzeichen** (`src/waymarks`, Layer `waymarks-signs` in `style/routes.ts`): Die App liest den
  Layer `routes` der z12-Tiles selbst aus der PMTiles-Datei (`waymarks/tiles.ts`, `pmtiles` +
  `@mapbox/vector-tile`; unabhängig vom Viewport und von `querySourceFeatures`), beschneidet die
  Linien auf die Tile-Fläche und fügt die Stücke zu Abschnitten zwischen Gabelungen zusammen
  (`graph.ts`, Fangtoleranz 3 Einheiten ≈ 5 m, T-Stöße werden aufgetrennt). Je Abschnitt setzt
  `plan.ts` jedes Zeichen **einzeln** und aufrecht: ein Endblock an beiden Enden (kurz nach der
  Gabelung steht auf jedem Ast das Zeichen der dort laufenden Routen), dazwischen reihum, jedes
  Zeichen spätestens alle 60 mm Papier (`WAYMARK_SPACING_MM`); danach weicht ein Zeichen entlang
  der Linie aus (höchstens 10 mm, `maxShiftMm`), bis seine Box frei ist, sonst entfällt es: Zeichen überdecken
  einander nie. Gleiche Zeichen mehrerer Routen erscheinen einmal (mit Rückfallkette).
  Ergebnis: GeoJSON-Punktquelle `waymark-signs` (ein Bild je Punkt, `img` = Bild-Id mit genau einer
  Route) und die Kästen der Zeichen. Der Layer zeichnet sie mit `icon-allow-overlap: true`, ab
  z11,5, bei 1:50 000 verkleinert (`SMALL_SCALE_FACTOR`); die Kästen sind **Hindernisse** der
  Piktogramm-Platzierung (Wegzeichen zuerst, Piktogramme weichen aus).
  **Einmal je Blattschnitt:** In der Druckansicht und im Export wird alles **einmal für den ganzen
  Blattschnitt** gerechnet (`layout.regionMm` beim Layout-Zoom, Tiles mit 30 mm Rand); Vorschau
  und jede Exportseite verwenden dasselbe Ergebnis (Ergebnis-Cache nach Schlüssel in
  `waymarks/index.ts`), die Überlappungen der Blätter sind also identisch. Außerhalb der
  Druckansicht rechnet der `WaymarkController` dasselbe für den Viewport beim aktuellen Zoom
  (nach `moveend`, 200 ms entprellt); unter z11,5 gibt es keine Zeichen. Mehr als 400 Tiles: keine
  Zeichen (Warnung in der Konsole).
  **Schalter:** Die Wegzeichen haben keinen eigenen Schalter, sie gehören zur Route (Gruppe
  `waymarks` mit `toggledBy: "routes"`, wie `shields` bei `labels`). Das Zeichen einer Route
  erscheint, wenn „Wanderrouten“ an ist **und** der Schalter ihres eigenen Netzes an ist
  (`routeVisible`: iwn → `net-iwn`, nwn → `net-nwn`, rwn → `net-rwn`, alles andere inkl. leer →
  `net-lwn`, `networkGroup`). Standard: alles an, also auch lokale Zeichen. „Wanderrouten“ aus:
  keine Zeichen (die Ausdünnungsdaten werden trotzdem geladen).
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
  | 0         | Wegzeichen (Ebene `waymarks-signs`, immer oben, vor den Piktogrammen platziert)                                                                                   |
  | 1 (10–14) | Anreise und Schutz: Bahnhof, Haltepunkt, Bushaltestelle, Alpen-/Wildnishütte, Unterstand                                                                          |
  | 2 (20–24) | Wasser: Trinkwasser, Quelle                                                                                                                                       |
  | 3 (30–36) | Ziele: Aussichtsturm, Burg, Burgruine, Ruine, Höhle, Wasserfall, Aussichtspunkt                                                                                   |
  | 4 (40–43) | Einkehr: Restaurant, Café                                                                                                                                         |
  | 5 (50–55) | Wanderinfrastruktur: Parkplatz, benannter Wegweiser, Toiletten, Rastplatz, Grillstelle                                                                            |
  | 6 (60–64) | Übernachtung: Campingplatz, Herberge, Caravanplatz, Hotel                                                                                                         |
  | 7 (70–73) | Kirchen: Kirche, Kapelle, Gotteshaus, Denkmal                                                                                                                     |
  | 8 (80–89) | Kleine Landmarken (`*-minor`): Türme, Masten, Windräder, Wegkreuze, Bildstöcke, Gedenksteine, Brunnen, Felsen, Dolinen, Wehre; unbenannter Wegweiser zuletzt (89) |

  Gipfelpunkte und Ortsnamen bleiben `fixed`.

- **Aussichtspunkte** (Standard „an“): nur benannte stehen in den Tiles (`viewpoint`, eigene Ebene
  `viewpoints-main`; ausgeblendet nimmt er nicht an der Platzierung teil; Aussichtstürme sind immer
  da). **Schalter mit Standard „aus“:** „Wegweisernamen“ (Gruppe `guidepostnames` ohne eigene Ebenen: sie setzt das `text-field` von
  `guideposts-main` und seines Namensklons; die Fähnchen bleiben). „Wegweisernamen“ ist
  Unterschalter von „Wegweiser“.

### M6: Schalter, Suche, GPX, Oberfläche

- **Schalter** (Panel „Ebenen“, drei klappbare `<details>`-Abschnitte, alle zunächst offen).
  Jede beschriftete Gruppe in `GROUPS` (`style/index.ts`) trägt `section` (`routes`, `terrain`,
  `symbols`) und optional `parent` (Unterschalter: eingerückt, bei ausgeschaltetem Elternschalter
  `disabled`, sein Wert bleibt). Die Anzeigereihenfolge steht in `UI_ORDER` (die Zeichenreihenfolge
  ist die Reihenfolge in `GROUPS`). `onToggle(map, visible, visibility)` bekommt die ganze
  Sichtbarkeit.
  - **Routen:** Wanderrouten (Unterschalter International, National, Regional, Lokal); sie steuern
    Hinterlegung und Wegzeichen gemeinsam (die Wegzeichen haben keinen eigenen Schalter).
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
- **Netz-Filter** (B3): Der Tile-Layer `routes` hat je Route `networks`, `network` = _höchstes_
  Netz des Abschnitts (`iwn > nwn > rwn > lwn`, fehlt sonst; wird nicht zum Filtern benutzt) und `nets` = die Schalter-Klassen der Routen des Abschnitts (`iwn|nwn|rwn|lwn`,
  alles andere inkl. leer ist `lwn`). Die Netz-Schalter steuern **Hinterlegung und Wegzeichen**:
  Ein Abschnitt bekommt ein Band, wenn **mindestens eine seiner Routen** in einem eingeschalteten
  Netz liegt (`routeNetworkFilter(visibility)` in `style/routes.ts`, rein: Teilsuche `|k|` in
  `|nets|`, `null`, wenn alle an sind); dieselbe Bedingung, unter der mindestens eine Route des
  Abschnitts ihr Zeichen zeigt. **Breite, Deckkraft und Sortierung** folgen dem höchsten
  _sichtbaren_ Netz (`major` = ein eingeschaltetes iwn/nwn/rwn in `nets`). Eine Funktion
  (`routeBandExpressions`) liefert Filter, Sortierschlüssel, Breite und Deckkraft; sie steckt beim
  Stilbau im Layer (der Export stimmt also) und wird auf der Hauptkarte von `setRouteNetworks`
  gesetzt. `networkGroup` (`waymarks/routes.ts`) muss der Abbildung des Profils entsprechen. Die
  Wegzeichen werden bei jedem Schalterwechsel neu berechnet (`main.ts` →
  `WaymarkController.update()`).
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

### Modi, Legende, Datenstand

- **Drei Modi** (`AppState.mode`, `src/mode.ts`; nicht zu verwechseln mit `print.mode` = Seitenzahl
  oder Maßstab führend). Segmentschalter unter der Suche mit Schrittnummern 1 bis 3 in Kreisen, Start: Erkunden.
  - **Erkunden:** Karte normal, kein Blattrahmen, keine Maske, keine Griffe, kein Druck-Panel. Das
    Gebiet bleibt im Zustand (beim Start das Vorgabegebiet, damit `currentLayout()` nie `null` ist).
  - **Zeichnen:** Fadenkreuz; Ziehen mit der primären Taste (Maus, Finger, Stift) zeichnet ein
    gestricheltes Rechteck (`print/draw.ts`, `AreaDrawer`, Pointer-Capture auf dem Canvas-Container).
    `dragPan`, `boxZoom`, `doubleClickZoom`, `touchZoomRotate` sind aus (ein zweiter Finger bricht
    das Ziehen ab), Mausrad und Tastatur bleiben. Loslassen mit mindestens 12 px je Seite setzt
    `print.area` und wechselt zu **Seiten**; ein Klick oder ein schmaler Streifen tut nichts,
    `pointercancel` verwirft. **Esc** bricht ab und kehrt in den Modus vor dem Zeichnen zurück (nicht
    in Textfeldern und Auswahllisten; auf dem Modusschalter selbst gilt es).
  - **Seiten:** Blattschnitt, Nummern, Griffe, Maske und das Panel „Druck“ (Vorgabe
    „Seitenzahl | Maßstab“, Ausrichtung, Schalter „Druckansicht“,
    „PDF exportieren“). Der Wechsel von Erkunden hierher setzt das Gebiet auf die Kartenmitte, wenn
    es ganz außerhalb des Ausschnitts liegt (`areaOutside`), sonst bleibt es. Nur der Schalter
    in der Seitenleiste tut das; `setState({ mode })` von außen nicht.
  - Invariante (in `setState`): `printView` ist nur in „Seiten“ wahr; jeder Wechsel weg von Seiten
    schaltet es aus, beim Zurückkehren bleibt es aus.
  - GPX laden (Knopf, Ablegen, `loadGpx`) und „Gebiet auf Track setzen“ setzen das Gebiet und
    schalten zu „Seiten“. Die Suche arbeitet in allen Modi gleich. Während eines Exports ist der
    Modusschalter gesperrt; `__capercailye.exportPdf` ist modusunabhängig.
  - Welche MapLibre-Handler an sind, entscheidet die reine Funktion `interactionFor(mode, printView)`.
- **Legende:** Die Seitenleiste ist die Legende. `legendSvg(groupId)` (`src/legend.ts`) liefert ein
  Bild je beschrifteter Gruppe (außer den Unterschaltern `net-*`, `guidepostnames`, die eine leere
  Zelle behalten), angezeigt als `<img class="switch__legend">` mit `LEGEND_SCALE = 1.25` in einer
  Zelle von 40 × 18 px. Alle Bilder kommen aus den Quellen der Karte: Piktogramme aus `poiIconSvg`
  (höchstens zwei Arten je Gruppe, `PoiCategory.legend`), das Beispiel-Wegzeichen (aus `osmcToSvg`) auf dem Routenband von „Wanderrouten“, Farben
  aus `COLORS`, Breiten aus den exportierten Konstanten der Stilmodule (`BAND_MAJOR_MM`,
  `CONTOUR_MM`, `HILLSHADE_SHADOW`, `PROTECTED_BANDS`, `BUILDING_OUTLINE_MM`, `PATH_MM`). Die
  Signaturen (Routenband, Höhenlinien, Schummerung, Schutzgebiet, Gebäude, „Aa“) zeichnet
  `legend.ts` in einem Feld von 40 × 16 Einheiten, Breiten über `mm()`, mindestens 1 px. Keine
  Legende im PDF.
- **Datenstand:** Muster je Quelle `<Quelle> (<Lizenz>, Stand <Datum>)` (`src/credits.ts`), Datum
  `TT.MM.JJJJ` aus dem UTC-Datumsteil; ohne bekannten Stand entfällt nur „, Stand …“. Der Stand
  erscheint **nur auf der Website** (Sidebar-Fuß, Karten-Attribution), **nicht im PDF-Blattrand**: der
  trägt dieselben Quellen in Kurzform, ohne Stand (`credits.line`): mit `openstreetmap.org/copyright`, den
  Änderungsvermerken „bearbeitet“ (Relief) und „ausgewertet“ (Haltestellen) und am Ende `Lizenzen: <Host>/quellen`
  (Host aus `window.location.host`, nicht fest verdrahtet).
  - **OSM:** `planetiler:osm:osmosisreplicationtime` aus den PMTiles-Metadaten
    (`pmtilesMetadata` in `src/data.ts`, `new PMTiles(url).getMetadata()`; kein Tile-Neubau).
  - **GTFS:** `transit/build.sh` schreibt `feed_date=YYYY-MM-DD` (aus dem Feed-Verzeichnis
    `de_full-YYYYMMDD`) in die Beschreibung der Busstops-Datei; die App liest es per Regex.
  - **Relief:** Mapterhorn liefert keinen abfragbaren Datenstand, deshalb steht das Jahr
    **statisch** je Gebiet in `RELIEF_CREDITS` (`src/config.ts`; Herkunft: `access_year` in
    `attribution.json`, abgerufen 2026-11-14). Unbekanntes Gebiet: ohne Stand.
  - **Links und Lizenzpflichten:** `SourceCredit` hat `href` (OSM: `openstreetmap.org/copyright`, Relief und
    Haltestellen: `/quellen/`) und `print` (PDF-Wortlaut). Die Karten-Attribution bekommt HTML (`creditHtml`,
    MapLibre bereinigt es; `a` mit `href`/`target`/`rel` bleibt), der Sidebar-Fuß wird aus `CreditPart`s mit
    DOM-APIs gebaut (`setAttribution`, kein `innerHTML`). Die Lizenzseite ist `src/pages/quellen/`; Hintergrund und
    Pflichten: SPEC.md 4.8.
  - Datenfluss: `buildStyle({ credits })` (Standard: ohne Stand) für die Karten-Attribution,
    `setAttribution(credits.sidebar)` für den Fuß, `ExportOptions.credits` für das PDF.
    `window.__capercailye.credits` enthält die gebauten Texte (`osm`/`relief`/`busstops` als HTML, `sidebar` als
    Teile, `line` für das PDF).
  - **Bibliothekslizenzen:** `build.license` in `astro.config.mjs` schreibt `dist/app/third-party-licenses.txt`;
    `public/app/licenses-extra.txt` ergänzt, was darin ohne Text bleibt (pmtiles) oder nicht erfasst ist (in MapLibres
    Bundles eingebaute Bibliotheken). Beide sind unter `/app/` erreichbar und auf der Lizenzseite verlinkt.
- Beim Drucken „Tatsächliche Größe“ / 100 % wählen, nicht „An Seite anpassen“; die
  Maßstabsleiste auf dem Ausdruck nachmessen.
