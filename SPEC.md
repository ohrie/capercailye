# capercailye – Spezifikation

Maßgebliches Dokument für Coding-Agents: was das Projekt ist, wie es gebaut ist, was entschieden ist.
Beschrieben ist, was **gebaut ist** (Stand 2026-11-15, geprüft am Code). Was nur geplant oder
zurückgestellt ist, steht in 4.10 und 8. Bei Widerspruch zwischen Doku und Code gilt der Code; dann die
Doku korrigieren. Tiefendokumentation je Bereich: `web/README.md`, `tiles/SCHEMA.md`,
`transit/README.md`, `deploy/README.md`, `site/README.md`.

## 1. Zweck und Umfang

**Was:** Wanderkarten on demand aus OpenStreetMap. Der Nutzer wählt ein Gebiet (aufziehen oder per
GPX-Track), die App legt ein Raster aus A4-Blättern darüber, zeigt es als Vorschau und exportiert ein
mehrseitiges PDF, das man selbst druckt. Eigener Kartenstil, ausgelegt auf Lesbarkeit im Druck bei
1:25 000, mit allen Wegen und den echten Wegzeichen (`osmc:symbol`) der Wanderrouten.

**Für wen:** Wanderer, die Papier statt Bildschirm mitnehmen wollen. Öffentlicher Dienst, kostenlos,
Quellcode MIT. Kartendaten: Deutschland (Tile-Build mit Planetiler läuft für jedes Geofabrik-Extrakt;
im Betrieb ganz Deutschland; lokal zum Testen die Extrakte von Rheinland-Pfalz und Baden-Württemberg).

**Bewusst nicht:**
- kein Backend, keine Konten, keine Speicherung von Nutzerdaten (Gebiet, GPX und Einstellungen sind
  nicht persistent)
- keine Navigation, keine Routenplanung, keine Live-/Standortfunktionen
- nur Wanderrouten (`route=hiking|foot`), keine Rad-, Reit- oder Skirouten
- keine Stromleitungen, keine Höhenprofile, keine Kilometermarken
- kein Vektor-PDF: die Karte steckt als Rasterbild (300 dpi) im PDF, nur der Blattrand ist Vektor
- keine Offline-Nutzung: Relief (Mapterhorn) und Ortssuche (Photon) sind externe Dienste
- kein Monitoring (siehe 6)
- Optionale Kartenfeatures siehe 4.10

## 2. Festgelegte Entscheidungen

Nicht neu verhandeln, solange der Nutzer sie nicht ausdrücklich öffnet.

| Thema | Entscheidung | Grund |
|---|---|---|
| Stack Web | Bun + Vite + TypeScript ohne Framework, MapLibre GL JS, `pmtiles`, jsPDF, `@tmcw/togeojson`, `maplibre-contour`; Formatierer oxfmt, kein Linter | Die Oberfläche ist eine Sidebar mit Schaltern; ein Framework wäre Ballast. jsPDF wird gepflegt und kann Vektor-Elemente (Blattrand). |
| Rendering und PDF | Alles im Browser: MapLibre rendert Vorschau **und** Export, je Blatt eine versteckte Karte mit `pixelRatio = dpi/96`, Bild in mm ins PDF | WYSIWYG (gleiche Labels an gleichen Stellen), ein Stil, ein Renderer, kein Server. Eine A4-Seite bei 300 dpi (2480 × 3508 px) passt in einen Canvas, nichts muss gekachelt werden. Verworfen: MapLibre Native, Mapnik/PostGIS (Vektor-PDF, aber zwei Stile), Headless-Chromium, QGIS. |
| Auflösung | Export immer 300 dpi, kein Umschalter | Einfachheit; Canvas-Größe wird geprüft, bei Reduktion warnt die App (`effectiveDpi`, `reduced`). |
| Tile-Format | Vektorkacheln als **PMTiles** (eine Datei, Range-Requests, kein Tile-Server), Zoom 0–14 | Statisches Hosting; ein Dateiaustausch genügt für ein Update. |
| Tile-Erzeugung | **Planetiler** mit eigenem Java-Profil (`tiles/CapercailyeProfile.java`, eine Datei ohne Maven) | Zwei-Phasen-API für Relationen (Routen auf Wege übertragen), schreibt PMTiles direkt, Minuten statt Stunden. Verworfen: Planetiler-YAML (Routen-Relationen unzureichend), Tilemaker, osm2pgsql, OpenMapTiles/Shortbread (keine Wege-Details/Routen pro Weg). |
| Relief | Schummerung und Höhenlinien **clientseitig** aus Mapterhorn-DEM-Kacheln (Terrarium-WebP, weltweit), Höhenlinien mit `maplibre-contour` | Kein Download, kein Build-Schritt, weltweit gleiche Quelle. Preis: Internet nötig, Abhängigkeit von Mapterhorn; ohne Relief läuft die Karte weiter. |
| Druckmaßstab | Ein Zoom für das ganze Blattraster (`z = log2(40075016,686·cos φ·96 / (512·S·0,0254))`, bei 1:25 000 und 48,5° N ≈ 12,94), gerechnet an der Breite der Gebietsmitte; Stilgrößen in Papier-mm | Mercator-Abweichung über wenige Blattreihen ≈ ±0,2 %, unter der Genauigkeit eines Heimdruckers. |
| Vollständigkeit im Druck | Pictogramme und Wegzeichen entfallen nie (Verdrängung statt Ausblenden), eigene Platzierung in der App | Papier kann man nicht zoomen. Ausnahmen: Zusammenfassen/Ausdünnen in Städten, 4.4. |
| Wegzeichen | `osmc:symbol` wird in der App aus SVG gezeichnet (Parser + Formen portiert aus `mueschel/OsmcToSVG`, CC0); jedes Zeichen einzeln, von der App entlang der Wege gesetzt; Rückfallkette `ref`+`colour` → `ref` → Namenskürzel | Echte Zeichen statt Ersatz, auflösungsunabhängig. Waymarked Trails (GPL-3.0) dient nur als Verhaltensreferenz, kein Code/SVG von dort übernommen (Lizenz MIT). |
| Verschachtelte Routen | Das spezifischste Zeichen gewinnt (Kind-Zeichen vor Elternzeichen desselben Netzes), Regeln in `tiles/SCHEMA.md` | Entspricht dem, was vor Ort angebracht ist. |
| Wegzeichen und Schalter | Kein eigener Schalter; Zeichen gehören zur Route und folgen „Wanderrouten“ plus Netz-Schalter | Nie ein Zeichen auf nicht gezeichneter Hinterlegung. |
| Bushaltestellen | Aus dem deutschlandweiten GTFS-Feed (gtfs.de, DELFI e.V., CC BY 4.0), nicht aus OSM; eigene PMTiles-Datei; nur Haltestellen mit ≥ 4 Abfahrten am Samstag **und** Sonntag | Nur Haltestellen mit brauchbarem Angebot; OSM kennt Takt nicht. Das OSM-Schema enthält kein `bus_stop`. |
| Farbpalette | Eine Palette aus `web/src/style/palette.ts` für Karte, App und Landingpage; einziger Akzent `#be2230` (Routenrot); GPX magenta `#d4007f`; nur helles Schema | Papier-Look wie die gedruckte Karte. |
| Landingpage | Statisch (`site/`: HTML + CSS, zwei winzige Skripte), Englisch, kein Build, App unter `/app/` | Kein Framework nötig, SEO. |
| Deployment | Ein nginx-Container hinter Traefik, Landingpage `/`, App `/app/`, Tiles `/app/data/`; Deploy per `scp` vom Entwicklungsrechner, Images werden auf dem Server gebaut, keine Registry, kein CI; wöchentlicher Updater-Container | Klein und reproduzierbar; Tiles sind jederzeit neu erzeugbar, deshalb kein Backup. Details 6. |
| Sprachen/Lizenz | App-UI Deutsch, Landingpage Englisch, MIT | Zielgruppe; Übersetzung der App ist getrennt zu lösen. |

## 3. Architektur und Repo-Karte

```
OSM-Extrakt (Geofabrik .osm.pbf) ─ tiles/build.sh ─▶ Planetiler + CapercailyeProfile.java ─▶ capercailye-<gebiet>.pmtiles ─┐
GTFS-Feed (gtfs.de de_full) ─────── transit/build.sh ▶ busstops.ts + tippecanoe ─────────▶ capercailye-busstops.pmtiles ──┼─▶ web/ (MapLibre-App)
Mapterhorn-DEM (online) ───────────────────────────────────────────────────────────────────────────────────────────────────┤     Vorschau, Blattraster
Photon (Suche, online), GPX-Datei (lokal) ─────────────────────────────────────────────────────────────────────────────────┘     Export: je Blatt ein Render → PDF
```

| Pfad | Zuständigkeit |
|---|---|
| `tiles/CapercailyeProfile.java`, `tiles/build.sh`, `tiles/SCHEMA.md` | Planetiler-Profil, Build-Skript (lädt `planetiler.jar` bei Bedarf), Schema der Tiles (Vertrag mit dem Stil) |
| `transit/busstops.ts`, `transit/build.sh`, `transit/README.md` | GTFS → Haltestellen → PMTiles (Layer `bus_stop`) |
| `web/` | Karten-App (Bun/Vite/TS). Details `web/README.md` |
| `web/src/main.ts` | Karte, Zustand, Modi, Export-Ablauf, `window.__capercailye` (Automationshaken) |
| `web/src/state.ts`, `mode.ts` | beobachtbarer App-Zustand; Modi Erkunden/Zeichnen/Seiten (rein) |
| `web/src/sidebar.ts`, `legend.ts`, `app.css`, `index.html` | Seitenleiste, Ebenen-Schalter mit Legendensymbolen, Gestaltung, Gerüst |
| `web/src/style/` | Stil als Module je Feature-Gruppe; `index.ts` setzt zusammen (`GROUPS`, `UI_ORDER`); `palette.ts` Farben, `units.ts` mm/pt, `sizes.ts` Symbolgrößen, `hierarchy.ts` Rangfolge, `sources.ts` Quellen/Relief-Schwellen, `poi.ts` Piktogramm-Kategorien, `routes.ts`, `transport.ts`, `hillshade.ts`, `shields.ts` (Nummernschilder) u. a.; `style.test.ts` prüft Stil gegen `tiles/SCHEMA.md` |
| `web/src/osmc/` | OSMC-Grammatik (`parse.ts`), Formen (`shapes.ts`), SVG je Zeichen (`render.ts`) |
| `web/src/waymarks/` | Platzierung der Wegzeichen entlang der Wege (rein, getestet), liest Layer `routes` der z12-Tiles selbst |
| `web/src/placement/` | Druck-Platzierung: Verdrängung (`displace.ts`), Ausdünnen in Städten (`thin.ts`), Klon-Layer (`layers.ts`) |
| `web/src/print/` | Maßstab/Zoom (`scale.ts`), Papier (`paper.ts`), Blattschnitt (`layout.ts`), Rahmen/Griffe (`frame.ts`), Zeichnen (`draw.ts`), versteckte Karte (`render.ts`), PDF mit Blattrand (`pdf.ts`), Exportschleife (`export.ts`) |
| `web/src/icons/` | Piktogramme als SVG, zur Laufzeit in Druckauflösung gerastert |
| `web/src/search.ts`, `gpx.ts`, `credits.ts`, `data.ts`, `tiles.ts`, `config.ts` | Photon-Suche; GPX-Upload; Quellenangaben mit Datenstand; Datei-/Metadaten-Prüfung; Worker, Protokolle, DemSource; Konstanten (`PMTILES_PATH`, Relief-Credits, Startansicht) |
| `web/public/fonts/` | Noto Sans als Glyph-PBF (OFL), `web/public/logo.svg` Kopie von `site/logo.svg`, `web/public/licenses-extra.txt` (Lizenztexte, die der Build-Bericht nicht enthält) |
| `web/vite-plugin-serve-data.ts` | Dev-/Preview-Server liefert `<base>data/` aus `$CAPERCAILYE_DATA` (Standard `~/.local/share/capercailye`) mit Range-Requests |
| `site/` | Landingpage, Logo-/Screenshot-Skripte (`site/scripts/`), Impressum, Datenschutz, Quellen und Lizenzen |
| `deploy/` | Compose, nginx, Updater (`updater/update.sh`, `check.ts`, `crontab`), `deploy.sh` |
| `IDEEN.md` | loses Ideen-Backlog, nichts davon eingeplant; bei Widerspruch gilt diese Spezifikation |

Große Daten (PMTiles, `planetiler.jar`, GTFS) liegen außerhalb des Repos im Verzeichnis `CAPERCAILYE_DATA`
(Standard `~/.local/share/capercailye`; für den Dev-Server auch in `web/.env.local`).

## 4. Funktionsumfang

### 4.1 App: Modi

`AppState.mode` (nicht zu verwechseln mit `print.mode`): Segmentschalter unter der Suche mit
Schrittnummern 1 bis 3 in Kreisen, Start in Erkunden.

- **Erkunden:** normale Karte, kein Blattrahmen, kein Druck-Panel.
- **Zeichnen:** Fadenkreuz; Ziehen (Maus, Finger, Stift) zeichnet ein Rechteck. Loslassen (≥ 12 px je Seite)
  setzt `print.area` und wechselt zu Seiten. Esc bricht ab. Karten-Handler (`dragPan` usw.) schaltet
  `interactionFor(mode, printView)`.
- **Seiten:** Blattraster, nummerierte Rahmen, Eckgriffe zum Aufziehen, Mittelgriff zum Verschieben,
  Panel „Druck“ (Vorgabe Seitenzahl | Maßstab, Ausrichtung, Schalter „Druckansicht“, „PDF exportieren“).
- Invariante: `printView` ist nur in Seiten wahr. GPX laden und „Gebiet auf Track setzen“ schalten zu Seiten.
  Während eines Exports ist der Modusschalter gesperrt.
- Zustand (Gebiet, GPX, Druckeinstellungen) wird nicht gespeichert.

### 4.2 App: Ebenen, Legende

- Panel „Ebenen“ mit drei Abschnitten: **Routen** (Wanderrouten mit Netz-Unterschaltern International,
  National, Regional, Lokal), **Gelände und Karte** (Schummerung, Höhenlinien, Schutzgebiete, Gebäude,
  Beschriftung), **Symbole** (Kategorien, Aussichtspunkte, Wegweiser mit Unterschalter Wegweisernamen,
  Bushaltestellen, „Weitere Symbole“). Standard: alles an außer „Wegweisernamen“. Ohne Busstops-Datei ist
  der Schalter „Bushaltestellen“ deaktiviert.
- Piktogramm-Kategorien (`style/poi.ts`, `POI_CATEGORIES`): Schutzhütten, Einkehr, Wanderparkplätze, Rast-
  und Grillplätze, Unterkünfte, Toiletten, Trinkwasser/Brunnen, Burgen/Ruinen/Denkmäler, Wegweiser; jede
  mit eigenen Ebenen `<id>-main`/`<id>-minor` (nötig, weil die Platzierung den Filter aus der Original-Spec
  liest). Gruppen-IDs dürfen kein Präfix fremder Ebenen-IDs sein.
- Weitere Kartenelemente ohne Schalter: Wege nach Art/Ausbau/Schwierigkeit (`sac_scale`,
  `trail_visibility`, `access`), Gewässer, Felswände, Wald/Landnutzung, Orts-/Flurnamen, Gipfel, Nummernschilder
  (Autobahn blau, Bundesstraße gelb, aus `ref`; folgen „Beschriftung“), Gebäude in Industrie-/Gewerbeflächen grau.
- **Legende:** die Seitenleiste. Jeder Schalter zeigt sein Symbol aus denselben Quellen wie die Karte
  (`legendSvg(groupId)`). Keine Legende im PDF.
- Wichtigkeits-Hierarchie (Rangfolge, welches Symbol am Ort bleibt): `style/hierarchy.ts`, einzige Quelle.
  Symbolgrößen in Papier-mm: `style/sizes.ts`, einzige Quelle.
- Karten-Mindestgrößen in Papier-mm: Schrift ≥ 6,5 pt, Pfad 0,25 mm, Fahrweg 0,35 mm, Höhenlinie 0,12 mm,
  Wegzeichen-Schild 3,4 mm. Zwischen z11,5 und z14,5 (1:10 000 bis 1:50 000) gelten sie exakt.

### 4.3 Druck und PDF

- **Blattraster:** druckbare Fläche = A4 minus 8 mm Rand; unten ein 11-mm-Streifen (Maßstab, Druckhinweis,
  Quellen), Kartenfeld hochkant 194 × 270 mm. Überlappung 10 mm (zwischen Kartenfeldern gerechnet). Raster
  mittig über dem Gebiet; einzelne Blätter sind nicht verschiebbar, nur das ganze Raster.
- **Modus „Maßstab“** (Standard): 1:15 000 / 1:25 000 / 1:50 000 wählen, Seitenzahl ergibt sich. **Modus
  „Seiten“:** 1, 2, 3, 4, 6, 8, 9 oder 12 Seiten, Maßstab wird berechnet (auf volle 1 000 aufgerundet,
  Grenzen 1:10 000 und 1:50 000; sonst „Gebiet passt nicht auf N Seiten“). Höchstens 24 Blätter
  (`MAX_SHEETS`), sonst „Gebiet zu groß“, Export gesperrt.
- **Druckansicht:** Vorschau auf den Druckzoom, Platzierung wie im Export.
- **Export** (`print/export.ts`): ein PDF, Blätter in Nummernfolge, je Blatt eine versteckte Karte mit 5 mm
  Zugabe ringsum (danach abgeschnitten), 300 dpi, Canvas nach `addImage` freigegeben, Fortschritt und
  Abbruch (Knopf „Abbrechen“, geprüft vor jedem Blatt). Dateiname `capercailye-1-25000-hoch.pdf` bzw.
  `…-hoch-6-seiten.pdf`. Relief-Fehler (Timeout je DEM-Kachel 15 s) lassen den Export weiterlaufen und
  werden gewarnt.
- **Blattrand (Vektor, `print/pdf.ts`):** Rahmen, Maßstabszahl, Maßstabsleiste, Nordpfeil, „Blatt n von N“
  (nur bei mehr als einem Blatt), Nachbarblatt-Nummern mit Pfeil an den Kanten,
  einzeilige Quellenzeile über die ganze Streifenbreite (4.8; ohne Datenstand), Hinweis „Drucken mit 100 % (nicht
  „An Seite anpassen“)“ oben rechts. Die Maßstabsleiste dient zur Kontrolle.
- Automatisierter Export: `window.__capercailye.exportPdf({...})` liefert `{ blob, meta }` ohne Download
  (Parameter und `meta` siehe `web/README.md`); `layout()`, `loadGpx(text)`, `clearGpx()`, `setState()`, `credits`.

### 4.4 Vollständigkeit im Druck (Platzierung)

- **Symbole entfallen nie.** In Druckansicht und Export ersetzt `src/placement` MapLibres Kollisionsprüfung für
  Piktogramme (auch Aussichtspunkte, Bushaltestellen): überlappende Symbole werden nach Rang um höchstens
  4 mm verdrängt, ab 0,5 mm Abstand zur wahren Lage zeigt ein feiner Strich dorthin. `"fixed"` (Gipfel,
  Ortsnamen, GPX-Start/Ende) bleibt stehen. Namen sind eigene Layer und dürfen entfallen; das Symbol nie.
  Außerhalb der Druckansicht gilt MapLibres normale Kollision.
- **Zusammenfassen beim Tile-Build:** gleichartige Objekte näher als 75 m werden ein Symbol (Parkplatz,
  Wegweiser, Bildstock, Stein, Fels, Mast, Toiletten, Brunnen; Picknickplatz + Grillstelle + Schutzhütte →
  ein Rastplatz). Bushaltestellen ebenso (75 m, Repräsentant = die mit den meisten Abfahrten). Details
  `tiles/SCHEMA.md` („Merging“), `transit/README.md` (Regel 9).
- **Ausdünnen in Städten (App):** Restaurants/Cafés, Toiletten und Hotels in Städten (`urban=true`, nur
  `place=town|city`) werden nach Papierabstand (8 mm) ausgedünnt, je Gruppe getrennt, nach `weight` (dann
  `tags`). Dörfer und Außenbereich: nichts entfällt. Die Menge der behaltenen Einträge wird einmal je Blattschnitt
  gerechnet, damit Vorschau und alle Seiten übereinstimmen.
- **Toiletten** nur öffentlich zugängliche (Filter Q im Profil), **Aussichtspunkte** nur mit Namen
  (Aussichtstürme immer).
- Bei 1:50 000 gilt derselbe Verkleinerungsfaktor für Piktogramme, Haltestellen und Wegzeichen
  (`SMALL_SCALE_FACTOR`); „vollständig“ heißt: was gewählt ist, wird gezeichnet.
- Keine automatische Kontrollzählung; Vollständigkeit wird visuell geprüft.

### 4.5 Wanderrouten und Wegzeichen

- Tiles liefern je Wegabschnitt **alle** Routen einzeln (`ids`, `networks`, `symbols`, `refs`, `names`,
  `colours`, `nets`, `network`), ohne Kappung. Hinterlegung: farbiges Band (dunkelrot) unter dem Weg.
- Netz-Schalter steuern Hinterlegung und Zeichen gemeinsam: ein Abschnitt hat ein Band, wenn mindestens eine
  seiner Routen in einem eingeschalteten Netz liegt; Breite/Deckkraft folgen dem höchsten sichtbaren Netz.
  `networkGroup` (`waymarks/routes.ts`) muss der Abbildung des Profils entsprechen.
- **Platzierung** (`waymarks/plan.ts`, rein, getestet; Standardwerte `PLAN_DEFAULTS`): Gabelung = Knoten mit
  mindestens drei Ästen mit sichtbaren Zeichen; Zeichen stehen auf der freien Strecke ≥ 8 mm von
  Gabelungen, jedes Zeichen mindestens einmal je Kante zwischen zwei Gabelungen (Stück ≥ 25 mm), spätestens
  alle 60 mm Papier, gleiche Zeichen nicht näher als ≈ 25 mm, auf gemeinsamen Kanten reihum. Zeichen
  überdecken einander nie; Ausweichen entlang der Linie bis 10 mm, sonst entfällt ein (nicht verpflichtendes)
  Zeichen. Gleiche Zeichen mehrerer Routen erscheinen einmal.
- Berechnet **einmal je Blattschnitt** (Druckansicht und Export, Ergebnis-Cache), sonst für den Viewport
  (ab z11,5, nach `moveend` entprellt; > 400 Tiles: keine Zeichen). Die Kästen der Zeichen sind
  Hindernisse der Piktogramm-Platzierung (Wegzeichen haben Vorrang).
- Bilder: ein Bild je Zeichen, per `styleimagemissing`/Bildlieferant „waymark:“ aus SVG in Druckauflösung.
  Rückfallkette bei fehlendem/unlesbarem `osmc:symbol`. Kombinierte Bilder gibt es nur für Legende/Musterblatt.

### 4.6 GPX

`gpx.ts`: Datei laden oder auf die Karte ziehen; Tracks und Routen (`trk`, `rte`) werden Linien, Wegpunkte
ignoriert. Danach liegt das Gebiet auf dem Track (Hülle + 10 %, mind. 300 m). Panel zeigt Name und Länge,
Knöpfe „Gebiet auf Track setzen“, „Track entfernen“. Darstellung: Magenta, 0,7 mm, 80 % Deckkraft, über den
Straßen und unter den Namen, Start/Ende als Kreise (fixed). Track erscheint in Vorschau und PDF.

### 4.7 Suche

`search.ts`: Photon (`photon.komoot.io`), ab 3 Zeichen, 300 ms Entprellung. Gesendet werden nur `q`, `lang=de`,
`limit=8` und die Kartenmitte (`lat`/`lon` auf 3 Nachkommastellen), `credentials: omit`, `referrerPolicy:
no-referrer`. Ergebnisliste als `combobox`/`listbox`, `/` fokussiert das Feld. Fehler: „Suche nicht erreichbar
– Internetverbindung prüfen“. Die Quelle steht in der Seitenleiste, nicht im PDF.

### 4.8 Quellenangaben, Datenstand, Lizenzseite

Muster `<Quelle> (<Lizenz>, Stand <TT.MM.JJJJ>)` (`credits.ts`, Konstanten in `config.ts`). Stand nur auf der
Website (Sidebar-Fuß, Karten-Attribution), nicht im PDF-Blattrand. OSM-Stand aus
`planetiler:osm:osmosisreplicationtime` der PMTiles-Metadaten; GTFS-Stand aus `feed_date=` in der
Beschreibung der Busstops-Datei; Relief-Jahr statisch je Gebiet (`RELIEF_CREDITS`: `bw`, `rp`, `de`).
Credit-Texte gehören zur Lizenzprüfung und werden nicht ohne Abstimmung umformuliert.

**Lizenzpflichten, wie umgesetzt** (Quellen: OSMF-Attributionsrichtlinien, ODbL 1.0, dl-de/by-2-0 § 2, CC BY 4.0
§ 3 a, BSD/MIT-Lizenztexte):
- **OSM:** „© OpenStreetMap-Mitwirkende“ ist in der Karten-Attribution (MapLibre, als HTML) und im Sidebar-Fuß
  (per DOM gebaut) auf `https://www.openstreetmap.org/copyright` verlinkt; die PDF-Zeile nennt
  `openstreetmap.org/copyright` als Text. Die ausgelieferten PMTiles sind eine abgeleitete Datenbank (ODbL): ihre
  Metadaten-`attribution` nennt „ODbL 1.0“ mit Link (Profil, `tiles/SCHEMA.md`; die Stil-Attribution der App
  überschreibt sie auf dem Bildschirm).
- **Relief** (Mapterhorn, DGM der Länder, je Land dl-de/by-2-0, CC BY 4.0 oder dl-de/zero-2-0): der Credit nennt
  „bearbeitet“ (Schummerung und Höhenlinien sind berechnet) und verlinkt auf die Lizenzseite.
- **Haltestellen** (DELFI e.V./gtfs.de, CC BY 4.0): „ausgewertet“ (nur Haltestellen mit ≥ 4 Abfahrten am Samstag
  und Sonntag), Link auf die Lizenzseite.
- **Lizenzseite** `site/quellen/` (`/quellen/`, deutsch, noindex, nicht in der Sitemap wie Impressum/Datenschutz):
  Quellen mit Lizenz-URLs, Tabelle der deutschen Relief-Hersteller je Land (wörtlich aus
  `download.mapterhorn.com/attribution.json`, abgerufen 2026-11-15; 17 Einträge, Baden-Württemberg hat zwei),
  Änderungsvermerke, Schriften (OFL), Bibliotheken. Verlinkt von Landingpage-Fuß, Impressum, Datenschutz,
  Seitenleiste der App und den Credits (Relief, Haltestellen).
- **PDF-Zeile:** `OSM-Text, openstreetmap.org/copyright · Relief: …, bearbeitet · Fahrplandaten: …, ausgewertet
  (CC BY 4.0) · Lizenzen: <Host>/quellen`; der Host kommt zur Laufzeit aus `window.location.host` (die Domain
  steht nicht im App-Code). Die Zeile steht einzeilig über die ganze Streifenbreite, bei Bedarf bis 4 pt
  verkleinert (`creditFontSize`).
- **Bibliotheken:** `vite.config.ts` schreibt mit `build.license` `third-party-licenses.txt` (alle gebündelten Pakete
  mit Lizenztext) nach `dist/` (`/app/third-party-licenses.txt`). Was dort fehlt (pmtiles liefert keine
  Lizenzdatei; in MapLibres fertige Bundles eingebaute Bibliotheken) steht in `web/public/licenses-extra.txt`.
  DOMPurify („MPL-2.0 OR Apache-2.0“) wird unter Apache-2.0 verwendet (Hinweis auf der Lizenzseite).
  Bei neuen oder aktualisierten Abhängigkeiten `licenses-extra.txt` prüfen.

### 4.9 Landingpage (`site/`)

- Statisch, `lang="en"`, `site/index.html` + `styles.css` (Tokens = Palette, 1,5-px-Konturen, Radius 4 px, ohne
  Schatten/Verläufe, Systemschrift). Alle CTAs zeigen auf `/app/`. Feste Domain (`capercailye.chilla.dev`) in
  `canonical`, `og:*`, JSON-LD, `robots.txt`, `sitemap.xml`; `DOMAIN` in `deploy/.env` steuert nur die Traefik-Regel.
- Abschnitte: Header (sticky), Hero (Dahner Felsenland, Höhenlinien-Ornament), „Less screen, more trail.“,
  Features (Print it, Bring your GPX, A style made for hiking mit POI-Chips), „Paper is harder than screens.“,
  How it works (Schritte 1–3 wie in der App), Galerie (4 Bilder) mit Bildnachweis-Zeile darunter (OSM, Relief "modified", Haltestellen "analysed", Link auf `/quellen/`), Coverage-Satz, „Free and open source“
  (Danksagung/Quellen), Abschluss-CTA, Footer mit Quellen und Links zu Impressum/Datenschutz/Quellen.
- Bilder `site/img/` (`dahn`, `calmont`, `schwarzwald`, `feldberg`, `gpx`, `print` je `.jpg` und `@2x.jpg`,
  `og-image.jpg` 1200 × 630), erzeugt mit `site/scripts/snapshots.ts` (`playwright-core`, lokaler Chrome,
  zwei Dev-Server für RP und BW) aus der echten App; GPX-Beispiel `site/scripts/sample-dahn.gpx`. Logo:
  8-Bit-Auerhahn, `site/scripts/logo.ts` erzeugt `logo.svg`/`favicon.svg` aus einer 24 × 24-Matrix (nach
  `web/public/logo.svg` kopiert).
- Seiten `site/impressum/`, `site/datenschutz/` und `site/quellen/` (Quellen und Lizenzen; deutsch). Skripte: `site/mail.js` (setzt die E-Mail-Adresse
  erst im Browser zusammen) und das Umami-Analytics-Skript (cookielos, eigene Analytics-Subdomain; steht
  in `site/index.html`, `web/index.html` und ist in der Datenschutzerklärung beschrieben). Die
  Seitenleiste der App verlinkt Impressum, Datenschutz und Quellen als absolute Pfade `/impressum/`, `/datenschutz/`,
  `/quellen/`.
- Landingpage-Texte nennen nur Funktionen, die es gibt; keine erfundenen Zahlen.

### 4.10 Nicht gebaut (bewusst zurückgestellt oder ausgeschlossen)

Nicht ohne neuen Auftrag bauen:
- Routenlegende am Blattrand (B5), Zeichenerklärung als PDF-Seite, Übersichtsblatt mit Blattschnitt,
  UTM-Gitter, GPX-Kilometermarken (die Legende lebt nur in der Seitenleiste)
- Routennamen entlang der Linie, Seilbahnen/Lifte, Wegoberfläche als Signatur, Furten/Tore/Schranken,
  Laub-/Nadelwald-Signatur, Einzelbäume/Hecken, Friedhöfe/Sportplätze/Parks, Gemeinde-/Kreisgrenzen, Infotafeln,
  Touristeninfo/Museen/Sehenswürdigkeiten, Bäder, Hochsitze, Bänke
- Stromleitungen (kein Layer `power`)
- Deutschland/Europa als lokaler Daten-Standard: lokal sind RP und BW; Europa-Extrakt fehlt (Plattenplatz)

## 5. Daten und Tiles

- **Schema:** `tiles/SCHEMA.md` ist der Vertrag zwischen Profil und Stil (Version `0.3.1-m7`, Planetiler 0.10.2,
  Zoom 0–14). `web/src/style/style.test.ts` prüft Layer-Ids und Attribute dagegen; wer das Schema ändert,
  zieht die Liste im Test mit.
- **Layer:** `transport`, `routes` (ab z11), `landcover`, `protected_area`, `water`, `waterway`, `cliff`,
  `building` (jedes Gebäude bei z12–14; Merkmal `industrial`), `place`, `peak`, `poi` (ab z12, Art-Tabelle mit
  `rank`). Booleans nur wenn wahr; optionale Attribute fehlen statt leer; Flächen-POIs ergeben einen Punkt.
  Bushaltestellen stehen nicht im Schema, sondern in einer eigenen Datei (`bus_stop`: `name`, `sat`, `sun`, `min`, z10–14).
- **Druckzoom:** Die App lädt Tiles beim gebrochenen Druckzoom gerundet (`VECTOR_TILE_ZOOM = "round"`: 1:25 000
  → z13, 1:50 000 → z12); alle druckrelevanten Features müssen deshalb ab z12 mit geringer Vereinfachung in den
  Tiles sein (z12: 0,1 px, keine Mindestlänge). Wegzeichen und Ausdünnung lesen den Layer `routes`/`poi` der z12-Tiles.
- **Build:** `tiles/build.sh [pbf] [gebiet]` → `capercailye-<gebiet>.pmtiles` (`bw`, `rp`, `de`, `eu` aus dem
  Extraktnamen). Heap `JAVA_XMX` (Standard 4g), `PLANETILER_JAR` für eine fertige Jar. BW etwa 2 Minuten.
- **Bushaltestellen:** `transit/build.sh [--refresh]` (bun, curl, unzip, tippecanoe). Normale Woche, nur
  Bus (ohne Bedarfsverkehr und Schienenersatz), Masten zusammengefasst, Auswahl `min(sat, sun) ≥ 4`, dann Zusammenfassen
  auf 75 m. Der kostenlose Feed gilt nur 30 Tage: Schnappschuss, regelmäßig auffrischen. Regeln in `transit/README.md`.
- **Relief:** Mapterhorn-Kacheln (`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`), eine `DemSource` (`tiles.ts`),
  Höhenlinien-Schwellen nach Kachelzoom (z13/14: 10 m / Zähllinie 50 m; z12: 20/100; z11: 50/250).
- **Gebietswahl in der App:** nur ein PMTiles-Gebiet je Build (`VITE_PMTILES_PATH`, Standard
  `data/capercailye-rp.pmtiles`, Startansicht Dahn); keine Umschaltung zur Laufzeit. `VITE_BASE` setzt den URL-Präfix
  (`/app/` im Deployment). Fehlende Busstops-Datei: App läuft ohne.

## 6. Deployment und Betrieb

Hier: Form, Begründungen, Messwerte, Risiken. Befehle, Einrichtung, Rollback, Lokaltest und Updater-Betrieb
stehen in `deploy/README.md` (maßgeblich, nicht hier duplizieren).

- **Form:** Compose-Projekt `capercailye` mit zwei Diensten. `web`: Multi-Stage (Bun-Build der App mit
  `VITE_BASE=/app/`, `VITE_PMTILES_PATH=data/capercailye-de.pmtiles`) → `nginx:alpine`; liefert `/`, `/app/`
  (SPA-Fallback), `/app/data/` (PMTiles read-only, ohne gzip, Range-Requests). `updater`: Planetiler + bun +
  tippecanoe + supercronic, kein Port, `traefik.enable=false`. **Traefik** terminiert
  TLS und routet per Label (`Host(DOMAIN)`); er hängt sich an das projekteigene Netzwerk `capercailye_network`.
  Keine Kompression-Middleware an diesem Router (würde Range-Antworten der PMTiles verändern).
- **Warum so:**
  - *Ein nginx statt zwei Containern oder eigenem Traefik:* Landingpage und App sind statische Dateien aus
    einem Repo und werden zusammen ausgeliefert. Traefik besitzt Port 80/443 und TLS; ein
    zweiter wäre ein Konflikt. Er braucht nur eine Regel (`Host(DOMAIN)`), nginx übernimmt Pfade, Cache-Header,
    Range-Requests und gzip in schlichter Konfiguration; Traefik bleibt Router.
  - *Bind-Mount mit `live/` und `work/` auf einem Dateisystem:* nur dann ist der Tausch ein atomares
    `rename`; laufende Anfragen beenden sich auf dem alten Inode.
  - *supercronic im Container statt Host-Cron:* Zeitplan, Zeitzone und Abhängigkeiten reisen mit dem Image,
    am Host ist nichts einzurichten.
  - *Build auf dem Server per `scp` statt CI/Registry:* ein Betreiber, ein Server; die Images entstehen für
    dessen Architektur, keine Zugangsdaten für eine Registry, keine CI-Infrastruktur.
  - *PMTiles ohne Kompression, kurzer Cache:* gzip würde Range-Antworten verändern. `Cache-Control`
    `max-age=300, must-revalidate` plus ETag/Last-Modified und kein `open_file_cache`: eine ersetzte Datei
    gilt ab dem nächsten Request, der wöchentliche Tausch zeigt sich also binnen Minuten.
- **Deploy:** `deploy/deploy.sh` packt `git archive HEAD`, `scp` auf den Server, dort `docker compose up -d --build`.
  Einstellungen in `deploy/deploy.env` (`DEPLOY_HOST`, `DEPLOY_DIR`) und `deploy/.env` bzw. die `.env` auf dem Server
  (`DOMAIN`, `DATA_ROOT`, RAM-/CPU-Limits); beide Dateien sind gitignored, die `*.example`-Vorlagen im Repo
  enthalten nur Platzhalter. Rollback: `app.prev/` bzw. `work/prev/`.
- **Updater:** jeden **Dienstag 02:23 Europe/Berlin** (`updater/crontab`): OSM-Extrakt `germany-latest` laden
  (nur wenn neuer, md5-geprüft), Tiles bauen, Haltestellen bauen, mit `check.ts` prüfen (lesbar, maxzoom 14,
  ≥ 70 % der alten Größe, OSM-Stand nicht älter), dann je Datei atomarer `mv` nach `live/` (Vorgänger als
  Hardlink in `work/prev/`). Schlägt etwas fehl, bleibt `live/` unverändert. `flock` verhindert Doppelläufe.
  Geofabrik veröffentlicht `germany-latest` abends (UTC), um 02:23 liegen also die Daten vom Montag vor; Zeitumstellungen
  fallen auf Sonntage, der Termin entfällt nie und läuft nie doppelt. Geofabrik leitet `-latest` auf einen Spiegel
  um, die `.md5` liegt dort neben der Datei (das Skript folgt der Weiterleitung und holt die Prüfsumme vom Spiegel).
- **GTFS-Regel:** Feed nur laden, wenn keiner da ist oder der neueste älter als der letzte Fahrplanwechsel
  (**15. Dezember**) ist; Haltestellen nur dann (oder wenn die Datei in `live/` fehlt) neu bauen. Übersteuern mit
  `GTFS_REFRESH=1|0`.
- **Grenzen:** Updater `mem_limit` 5g, `JAVA_XMX` 3g, `cpus` 4
  (und 4 Planetiler-Threads, mindestens ein Kern bleibt für nginx), Schritte nacheinander,
  `nice 10`, mindestens 60 GB freie Platte (`MIN_FREE_GB`); `web` 256m. Alles in `.env` überschreibbar. Planetiler hält
  Knotendaten in mmap-Dateien (Seitencache, wird bei Druck freigegeben): langsamer, kein OOM.
- **Gemessen (erster Deutschland-Lauf, 2026-11-15):** 82 min gesamt; Download 46 s; Tiles 80 min bei 4,1 GB RSS;
  Haltestellen 101 s bei 1,4 GB RSS; Ausgabe 4,3 GB + 23 MB; `work/` danach 6,9 GB. Planetiler ist bei knappem Seitencache
  plattengebunden (Knoten-Lookups passen nicht in den Cache); bei Engpässen den Zeitpunkt verschieben oder `JAVA_XMX` senken.
- **Risiken:**
  - *Photon (komoot):* öffentliche Instanz mit Fair-Use-Grenzen; bei Last selbst hosten.
  - *Mapterhorn:* Relief hängt an einem externen Dienst (siehe 8); Nutzungsbedingungen für den öffentlichen
    Betrieb prüfen (8, Lizenzen).
  - *Origin-Traffic:* viele Range-Requests je Kartenansicht, kein CDN; bei Bedarf für `/app/data/` ergänzen.
  - *Speicherbedarf des Laufs* (siehe Messwerte).
  - Backup: nur `.env`; Daten sind jederzeit neu erzeugbar.
- Fehler des Updaters zeigen sich in den Logs (`work/logs/`, die letzten 8) und daran, dass `live/` alt bleibt.
- Datenstand erneuert sich von selbst: die App liest ihn zur Laufzeit aus den Dateien.

## 7. Konventionen für Agents

- **Befehle** (in `web/`): `bun install`; `bun run dev` (Port 5173, `/data/` aus `$CAPERCAILYE_DATA`);
  `bun test`; `bun run fmt` bzw. **`bun run fmt:check`**; **`bun run build`** (`tsc --noEmit` + Vite). Vor dem
  Abschluss `bun test`, `bun run fmt:check` und `bun run build` grün. Ein zweiter Dev-Server braucht einen eigenen Port
  (`bunx vite --port 5180`). Tiles: `tiles/build.sh`, `transit/build.sh`; Landingpage-Skripte `bun run logo`,
  `bun run snapshots` in `site/`.
- **Sprachen:** App-Oberfläche Deutsch; Landingpage Englisch (Impressum/Datenschutz Deutsch); Code-Kommentare
  Englisch; Dokumentation (`*.md`) Deutsch (`tiles/SCHEMA.md` ist englisch). Übersetzung der App ist nicht Teil dieser
  Spezifikation und wird getrennt behandelt.
- **Stil des Codes:** reine Logik von DOM/MapLibre trennen und testen (`*.test.ts` neben dem Modul); Größen in Papier-mm;
  Symbolgrößen nur in `style/sizes.ts`, Rangfolge nur in `style/hierarchy.ts`, Farben nur in `style/palette.ts`. Keine
  `DemSource` in Tests oder `style/` erzeugen (startet einen Worker). Zeichenreihenfolge = Reihenfolge in `GROUPS`.
- **Workflow:** Agents committen nicht ohne ausdrückliche Anweisung. Nach einem Meilenstein
  kurzer Statusbericht, Weiterarbeit nach Freigabe.
- **Das Repo ist öffentlich.** Nie committen: Hostnamen, IPs, Benutzernamen des Servers, Namen anderer Projekte auf
  dem Server. Echte Werte nur in den gitignorten Dateien `deploy/.env` und `deploy/deploy.env` (Vorlagen mit
  Platzhaltern). Die öffentliche Domain der Seite darf vorkommen (steht in `site/`). Vor dem Abschluss
  `git grep` nach Server-Namen/IPs.
- **Lizenz/Quellen:** Der Projektcode ist MIT. Fremde GPL-Quellen (z. B. Waymarked Trails) nicht kopieren. Änderungen an
  Quellenangaben (`config.ts`, Landingpage-Danksagung, Datenschutz) nur mit Absicht und Prüfung der Lizenzen.
- **Doku pflegen:** Ändert sich Verhalten, diese Spezifikation und den jeweiligen Bereichs-README mitziehen;
  Tile-Schema nur in `tiles/SCHEMA.md` ändern, nicht hier duplizieren.

## 8. Offene Punkte und bekannte Grenzen

- **Lizenzen öffentlicher Betrieb:** die Pflichtangaben sind umgesetzt (4.8). Offen ist die Entscheidung des
  Betreibers, ob für das Impressum (§ 5 DDG) ein zweiter, schneller Kontaktweg neben der E-Mail-Adresse angegeben
  wird.
- **Relief hängt am Netz:** ohne Mapterhorn fehlen Schummerung und Höhenlinien (Export läuft mit Warnung weiter).
- **GTFS ist ein Schnappschuss** (30 Tage gültig, Fahrplanwechsel-Regel, Landesfeiertage und Ferien nicht berücksichtigt).
- **Raster-PDF:** keine Vektorkarte; Qualität hängt an 300 dpi und Canvas-Limit des Browsers.
- **Grenzen der Blattschnitt-Logik:** Maßstab 1:10 000 bis 1:50 000 (Gültigkeit der Stilgrößen), höchstens 24 Blätter,
  Wegzeichen nur bis 400 Tiles im Viewport. Im Export werden verdrängte Symbole/Namen je Blatt einzeln
  platziert, in Überlappungen können sie leicht abweichen (Linien, Flächen, Wegzeichen sind deckungsgleich).
- **Dichte Tiles:** Stadt-Kacheln bei z12 bis ≈ 3 MB (akzeptiertes Budget); `parking` unfiltert, unbenannte
  `guidepost`, `mast` bleiben dicht und hängen an der App-Platzierung.
- **Exotische `osmc:symbol`-Werte:** Rückfallkette fängt sie auf; die häufigsten Werte sind abgedeckt, ein
  Abgleich anderer Regionen steht aus (Stichprobe nur BW).
- **Namen von Restaurants/Bäckereien/Cafés** (wann sichtbar) ist ungeklärt (Eintrag in `IDEEN.md`).
- **Ideen-Backlog `IDEEN.md`:** offen sind unter anderem eine Legende im Blattrand/auf einer PDF-Seite und ein npm-Paket
  für die OSMC-Wegzeichen.
