# capercailye – Umsetzungsplan

Wanderkarten on demand aus OpenStreetMap: Gebiet wählen, Anzahl A4-Seiten wählen, Vorschau prüfen, PDF exportieren und selbst drucken. Eigenständiger Kartenstil, ausgelegt auf Lesbarkeit im Druck, mit allen Wegen und korrekt dargestellten Wegzeichen (`osmc:symbol`).

Stand: 2026-11-13. Grundlage sind drei Recherchen (Tile-Erzeugung/Höhendaten, Druck-Pipeline, OSMC-Symbole bei Waymarked Trails). Nichts davon ist bisher gebaut oder gemessen; unbestätigte Annahmen stehen unter [Risiken](#7-risiken-und-offene-annahmen).

## 1. Festgelegter Umfang

| Thema | Entscheidung |
|---|---|
| Daten | OpenStreetMap, Testgebiet Baden-Württemberg (`$CAPERCAILYE_DATA/baden-wuerttemberg-latest.osm.pbf`) |
| Betrieb | nur lokal, kein Server-Deployment |
| Druck | A4 hoch/quer, wahlweise **Seitenanzahl führend** (Maßstab ergibt sich) oder **Maßstab führend** (Seiten ergeben sich) |
| Relief | Höhenlinien + Schummerung direkt vom **Mapterhorn-Kacheldienst** (weltweit, kein lokaler Download) |
| Routen | nur Wanderrouten (`route=hiking|foot`) |
| Stil | eigenständig, auf Lesbarkeit im Druck bei 1:25 000 ausgelegt, eigene Signaturen |
| Features | alle mit „Kern“ und „Empfohlen“ aus Abschnitt 8; „Optional“ und die Routenlegende (B5) sind zurückgestellt |
| Extras | GPX-Upload (abgesetzte Farbe), Suche über Photon |
| Oberfläche | minimalistisch, modern, klare Linien; Karte bzw. Seitenvorschau groß und im Fokus |
| Werkzeuge | Bun für das Web-Projekt, oxfmt für die Formatierung |
| Lizenz | MIT |
| Perspektive | Deutschland oder Europa statt nur BW: nur ein größerer Planetiler-Lauf, das Relief ist bereits weltweit |

## 2. Technologie-Entscheidung

**Gewählt: alles im Browser.** MapLibre GL JS + lokale PMTiles + ein handgeschriebener Stil. Die Vorschau und der PDF-Export nutzen denselben Renderer.

```
OSM-PBF ──Planetiler (eigenes Java-Profil)──▶ capercailye-bw.pmtiles ─┐
Mapterhorn-Kacheldienst (Höhenmodell, weltweit, online) ──────────────┼─▶ Vite-App (MapLibre GL JS)
                                                                      │     ├─ Vorschau mit Seitenraster
Photon-API (Suche), GPX-Datei (lokal) ────────────────────────────────┘     └─ Export: 1 Render pro Seite ─▶ PDF (jsPDF)
```

### 2.1 Rendering und Druck: warum Browser-MapLibre

| Variante | Druckqualität | Aufwand | Warum nicht |
|---|---|---|---|
| **1. MapLibre GL JS im Browser, Raster-PDF** | sehr gut bei 254–300 dpi | niedrig | **gewählt** |
| 2. MapLibre Native (Node / tileserver-gl) | wie 1 | mittel | Fertige Binaries nur für Ubuntu, auf Manjaro selbst bauen. Kein Laufzeit-Erzeugen von Icons, OSMC-Symbole müssten vorab als Sprite entstehen. Zwei Renderer für einen einzelnen lokalen Nutzer. |
| 3. osm2pgsql + PostGIS + Mapnik, Vektor-PDF | am besten (echtes Vektor-PDF) | hoch | Datenbank, Import, Mapnik-Stil und zusätzlich ein zweiter Renderer für die Web-Vorschau. Zwei Stile, kein WYSIWYG, ein Vielfaches an Arbeit. |
| 4. Headless Chromium rendert dieselbe Seite | wie 1 | mittel | Zusätzlicher Dienst ohne Qualitätsgewinn, eine WebGL-Karte wird ohnehin als Raster gedruckt. |
| 5. Vektor-PDF aus Vektor-Tiles (QGIS o.ä.) | Vektor, aber Stil wird verlustbehaftet übersetzt | mittel–hoch | Kein ausgereifter Renderer, der einen MapLibre-Stil nach PDF bringt. |

Die entscheidenden Punkte für Variante 1:

- **Eine A4-Seite passt in einen einzigen Render.** A4 bei 300 dpi sind 2480 × 3508 px, MapLibre erlaubt standardmäßig 4096 × 4096. Es muss nichts gekachelt und zusammengesetzt werden, damit entfallen die typischen Probleme (Labels an Nahtstellen).
- **WYSIWYG.** Der Export rendert mit gleichem Zoom und gleichem CSS-Ausschnitt wie die Vorschau, nur mit `pixelRatio = dpi/96`. Labels und Symbole landen an denselben Stellen.
- **Ein Stil, eine App, kein Backend.** Das hält das Projekt klein.
- Der Preis: das PDF enthält die Karte als Rasterbild. Bei 254–300 dpi ist das auf einem Heimdrucker nicht von Vektor zu unterscheiden. Rahmen, Maßstabsleiste und Beschriftung am Rand werden als Vektor ins PDF gezeichnet.

### 2.2 Tile-Erzeugung: warum Planetiler

| Variante | Bewertung |
|---|---|
| **Planetiler, eigenes Java-Profil** | **gewählt.** Hat eine saubere Zwei-Phasen-API für Relationen (`preprocessOsmRelation` + `relationInfo`), das offizielle Beispiel `BikeRouteOverlay.java` macht genau das für Radrouten und dient als Vorlage. Schreibt PMTiles direkt. BW sollte in wenigen Minuten bauen. Java 27 ist installiert, und du kennst Planetiler bereits. Das Profil ist eine einzelne `.java`-Datei, ohne Maven. |
| Planetiler YAML | Reicht nicht: Routen-Relationen auf Wege zu übertragen ist dort nicht verlässlich unterstützt. |
| Tilemaker (Lua) | Funktioniert grundsätzlich, aber mehrere Routen pro Weg und Superrouten sind in der Lua-API umständlicher. Nicht installiert. |
| osm2pgsql + PostGIS + Tileserver | Zu schwer für das Ziel (Datenbank, Import, SQL, Server). |
| Fertige Schemata (OpenMapTiles, Shortbread) | Enthalten keine Wanderrouten pro Weg und nicht die nötigen Weg-Details (`sac_scale`, `trail_visibility`). |

### 2.3 Relief: Mapterhorn

- Das Höhenmodell kommt direkt vom Mapterhorn-Kacheldienst (`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`, Terrarium-Kodierung, 512-px-Kacheln; Erreichbarkeit am 2026-11-13 geprüft). Damit ist die ganze Welt abgedeckt, ohne Download und ohne Build-Schritt. Für BW steckt dort das LGL-DGM1 drin (Lizenz dl-de/by-2-0).
- Folge: Für Relief braucht die App eine Internetverbindung, so wie auch für die Photon-Suche. Die OSM-Karte selbst bleibt lokal.
- **Schummerung:** MapLibre-`hillshade`-Layer direkt auf dem DEM, dezent eingestellt.
- **Höhenlinien:** clientseitig mit `maplibre-contour` (10 m, Zähllinien alle 50 m, beschriftet).
- **Rückfallweg**, falls die Höhenlinien im Druck zu langsam oder zu unruhig sind: einen Ausschnitt lokal ziehen und mit `gdal_contour` + `tippecanoe` (beides installiert) vorab berechnen. Das gälte dann nur für das jeweilige Gebiet.

### 2.4 Frontend-Stack

- **Bun + Vite + TypeScript ohne Framework.** Bun ist Paketmanager und Skript-Runner (`bun install`, `bun run dev`). Die Oberfläche ist eine Sidebar mit Checkboxen, Suchfeld und Datei-Upload; ein Framework wäre mehr Ballast als Nutzen.
- **oxfmt** formatiert den Code (`bun run fmt`). oxfmt ist ein reiner Formatierer; ein Linter (z.B. oxlint) ist nicht eingeplant.
- **Oberfläche:** schmale Sidebar links (ca. 300 px, einklappbar), der Rest gehört der Karte. Flaches, ruhiges Design mit dünnen Linien, einer Akzentfarbe und Systemschrift, ohne Schatten und Verläufe. Die Seitenvorschau liegt als Blattrahmen direkt auf der Karte; die Druckansicht zeigt die Blätter groß als Papier.
- `maplibre-gl`, `pmtiles`, `jsPDF` (aktiv gepflegt, kann auch Vektor-Elemente zeichnen; `pdf-lib` hat seit 2021 kein Release), `@tmcw/togeojson` für GPX, `proj4` nur falls das UTM-Gitter gewählt wird.
- Fertige Druck-Plugins (`maplibre-gl-export`) können weder mehrere Seiten noch einen festen Maßstab. Der Export wird selbst geschrieben, etwa 300 Zeilen.

## 3. Routen und Wegzeichen

Das ist der Kern des Projekts.

**Im Tile-Build (Planetiler):**

1. Alle Relationen `type=route|superroute` mit `route=hiking|foot` einlesen (ohne `state=proposed`), je Relation `osmc:symbol`, `ref`, `name`, `network`, `colour` merken.
2. Für jeden Weg alle Routen sammeln, die darüber laufen, einschließlich Superrouten. Kind-Relationen ohne eigenes oder mit gleichem Zeichen wie ein Vorfahr desselben Netzes bekommen kein eigenes Zeichen. Entschieden am 2026-11-13: hat das Kind ein abweichendes eigenes Zeichen, gewinnt das spezifischste, also das Kind-Zeichen (meist das vor Ort angebrachte), und der Vorfahr desselben Netzes entfällt auf diesem Abschnitt. Waymarked Trails zeigt hier stattdessen das Elternzeichen.
3. Layer `routes`: ein Linien-Feature pro Wegabschnitt mit `symbols` (deduplizierte, nach Netz-Rang sortierte Liste, mit `|` verbunden, höchstens 4; bei mehr als 4 bleiben bevorzugt die übergeordneten Routen, also höherer Netz-Rang und Routen mit Superrouten-Bezug), `refs`, `names` und `top_network`. **Geändert am 2026-11-14:** zusätzlich alle Routen des Abschnitts einzeln mit Relation-ID und Netz, ohne Kappung, damit die App jedes Zeichen einzeln setzen und Routen über Gabelungen verfolgen kann (siehe Client).
4. Benachbarte Abschnitte mit identischer Routenmenge zusammenführen, damit Zeichen nicht an jedem Wegstück neu ansetzen.

**Im Client:**

- Ein eigener kleiner Renderer `osmcToSvg()` setzt die OSMC-Grammatik um (`wegfarbe:hintergrund:vordergrund[:vordergrund2]:text:textfarbe`), mit rund 60 Formen als SVG-Pfade.
- Grundlage für Zerlegung und Formen ist `mueschel/OsmcToSVG` (Perl, CC0-1.0), nach TypeScript portiert. Waymarked Trails dient nur als Vergleich für Sonderfälle.
- Das Bild wird erst erzeugt, wenn es gebraucht wird (derselbe Mechanismus wie bei den Piktogrammen). **Geändert am 2026-11-14:** Jedes Zeichen ist ein eigenes Bild. Laufen mehrere Routen über einen Abschnitt, werden ihre Zeichen reihum hintereinander entlang der Linie gesetzt, nicht mehr als kombiniertes Bild nebeneinander. Gleiche Zeichen mehrerer Routen erscheinen einmal.
- Die Bilder werden in Druckauflösung erzeugt, damit sie bei 300 dpi scharf sind.
- Platzierung durch einen eigenen Schritt in der App (wie bei den Piktogrammen, nicht mehr `symbol-placement: line`), aufrecht, mit Vorrang vor anderen Beschriftungen. Regeln (geändert am 2026-11-14): Als Gabelung zählt nur ein Knoten, an dem mindestens drei Äste mit sichtbaren Wegzeichen zusammentreffen; verglichen werden die gezeichneten Zeichen, nicht die Relationen (Routenende, Lücke, Tile-Naht oder Eltern/Kind mit gleichem Zeichen sind keine Gabelung). Zeichen stehen auf der freien Strecke, mindestens 8 mm von Gabelungen entfernt, nicht als Block an der Gabelung. Jedes Zeichen steht auf jeder Kante zwischen zwei Gabelungen mindestens einmal, sofern sein Stück mindestens 25 mm lang ist; so ist nach jeder Verzweigung erkennbar, wohin welches Zeichen läuft. Entlang der Route kommt jedes Zeichen spätestens alle 6 cm Papier wieder, über Gabelungen hinweg gemessen, und gleiche Zeichen stehen nicht näher als etwa 2,5 cm beieinander. Auf gemeinsamen Kanten stehen die Zeichen reihum. Zeichen überdecken einander nicht; bei Platzmangel weichen sie bis 10 mm entlang der Linie aus, Pflichtzeichen gehen vor Wiederholungen, höhere Netze vor niedrigeren. Dafür liefern die Tiles je Abschnitt alle Routen einzeln mit Relation-ID und Netz, ohne Kappung auf 4.
- **Rückfallkette**, wenn `osmc:symbol` fehlt oder unlesbar ist: `ref` mit `colour` → `ref` → Namenskürzel. Das häufigste Format hat einen leeren Hintergrund (`yellow::yellow_diamond`) und muss sauber funktionieren.
- Routenlinie: farbige Hinterlegung des Weges (dunkelrot), der Weg selbst bleibt darunter lesbar.

**Lizenz:** capercailye steht unter MIT. Der Code von Waymarked Trails ist GPL-3.0 und dient deshalb nur als Referenz für Grammatik und Verhalten; die Formen werden nach der Beschreibung im OSM-Wiki neu gezeichnet, es wird kein Code und kein SVG von dort übernommen.

## 4. Druck: Maßstab, Seiten, Export

- **Maßstab → Zoom:** `z = log2(40075016,686 · cos(φ) · 96 / (512 · S · 0,0254))`. Für 1:25 000 bei 48,5° N ergibt das z ≈ 12,94.
- Ein Zoom für den gesamten Blattschnitt, berechnet für die Breite der Gebietsmitte. Die Mercator-Abweichung über drei Blattreihen liegt bei etwa ±0,2 % und damit unter der Ungenauigkeit eines Heimdruckers.
- **Blattschnitt:** druckbare Fläche = A4 minus 8 mm Rand je Seite, 10 mm Überlappung zwischen Nachbarblättern. In der Vorschau liegen die Blätter als nummerierte Rahmen auf der Karte und lassen sich verschieben.
- **Modus „Seiten führend“:** Gebiet aufziehen, Raster wählen (1, 2, 4, 6, … Seiten, hoch/quer), der Maßstab wird berechnet und angezeigt. **Modus „Maßstab führend“:** 1:15 000 / 1:25 000 / 1:50 000 wählen, die Seitenzahl ergibt sich aus dem Gebiet.
- **Druckansicht:** Ein Schalter stellt die Vorschau auf den Druckzoom, dann entspricht der Bildschirm inhaltlich dem Ausdruck.
- **Export:** Seiten nacheinander in einer versteckten Karte rendern (mit 5 mm Zugabe ringsum, die danach abgeschnitten wird, damit Labels am Blattrand nicht abreißen), als Bild ins PDF legen, Größe in Millimetern setzen.
- **Auflösung:** Standard 254 dpi, wahlweise 300 dpi.
- **Blattrand (Vektor):** Rahmen, Maßstabsleiste, Maßstabszahl, Nordpfeil, Blattnummer mit Nachbarblättern, Quellenangaben (© OpenStreetMap-Mitwirkende, Mapterhorn mit der Höhenquelle des Gebiets, z. B. LGL-BW bzw. GeoBasis-DE / LVermGeoRP, dl-de/by-2-0), dazu eine 10-cm-Kontrollstrecke. Der wichtigste Maßstabsfehler in der Praxis ist „An Seite anpassen“ im Druckdialog; die App weist darauf hin.
- Stilgrößen werden in Millimetern auf dem Papier gedacht: Schrift mindestens 6,5 pt, Pfad 0,25 mm, Fahrweg 0,35 mm, Höhenlinie 0,1–0,15 mm, Routenhinterlegung 1,2–1,5 mm.

## 4a. Grundsatz: Vollständigkeit im Druck

Eine gedruckte Karte kann man nicht zoomen. Beim Druckmaßstab muss deshalb jede Information auf dem Blatt stehen; die Kollisionsvermeidung von MapLibre, die nahe beieinander liegende Symbole ausblendet, darf im Druck nichts entfernen.

- **Symbole entfallen nie.** Die Kollisionsprüfung von MapLibre wird für Piktogramme und Wegzeichen abgeschaltet. Die Platzierung übernimmt ein eigener Schritt in der App, der für den festen Druckmaßstab rechnet.
- **Verdrängung statt Ausblenden.** Symbole, die sich überlappen würden, werden auseinandergeschoben (höchstens wenige Millimeter); ab einer Schwelle zeigt ein feiner Strich auf die wahre Lage. Wichtigere Symbole bleiben an ihrem Ort, unwichtigere weichen.
- **Zusammenfassen gleichartiger Objekte (geändert am 2026-11-14).** Auf dem Ausdruck zählt, dass das Wichtigste sichtbar ist, nicht jedes Detail. Gleichartige Objekte, die weniger als 75 m auseinanderliegen, werden beim Tile-Build zu einem Symbol zusammengefasst. Das gilt für Arten, die sich laut BW-Auswertung häufig ballen: Parkplatz, Wegweiser, Bildstock (Kreuzwegstationen), Stein, Fels, Mast, Toiletten, Brunnen. Picknickplatz, Grillstelle und Schutzhütte innerhalb von 75 m werden ein Rastplatz-Symbol (die Grillstelle wird zum Merkmal). Arten, bei denen es sich nicht lohnt (Wegkreuz, Kirche, Kapelle, Quelle, Burg, Bahnhof u. a.), bleiben einzeln.
- **Ausnahme in größeren Orten: Gastronomie, Toiletten, Hotels (2026-11-14).** Restaurants und Cafés, Toiletten und Hotels (inkl. Pensionen) in größeren Orten (Städte, `place=town|city`) werden nach Papierabstand ausgedünnt, je Gruppe getrennt: Gastronomie (Restaurants und Cafés zusammen), Toiletten und Hotels dünnen sich jeweils nur untereinander aus (ein Hotel verdrängt nie eine Toilette), Mindestabstand überall 8 mm. Innerhalb des Mindestabstands bleibt nur der Eintrag mit dem höchsten Gewicht; die Anzahl der Tags entscheidet nur bei Gleichstand. Gewicht der Gastronomie: Art, Außensitzplätze, Website, Öffnungszeiten, Wikidata, Ketten abgewertet. Gewicht der Toiletten: rollstuhlgerecht, kostenlos, Öffnungszeiten, Wickeltisch. Gewicht der Hotels: Hotel statt Pension, mindestens 3 Sterne, Wikidata, Website, Ketten abgewertet. Toiletten werden zuerst wie bisher auf 75 m zusammengefasst; ob eine Toilette in einem größeren Ort liegt, entscheidet die Lage des zusammengefassten Symbols. In Dörfern, Weilern und im Außenbereich entfällt nichts. (Gastronomie am 2026-11-14 eingeführt, Toiletten und Hotels am selben Tag ergänzt.)
- **Toiletten: nur öffentlich zugängliche (2026-11-14).** Raumkartierung (`indoor=room`, Raumnummern) sowie Innen- und Einrichtungs-Toiletten (Uni, Klinik, Schule, `indoor`/`level`) ohne Beleg für Öffentlichkeit entfallen. Belege sind Name, Öffnungszeiten, Betreiber, Gebühr, Euroschlüssel, Bezahlart. In Bahnhof, Kiosk, Toilettenhaus, Park, Garten und Tourist-Info bleibt jede. Anlass: KIT-Campus, in BW ≈ 15 % der Toiletten. Der Filter läuft vor dem Zusammenfassen.
- **Aussichtspunkte (2026-11-14).** Nur Aussichtspunkte mit Namen stehen auf der Karte, standardmäßig eingeschaltet; Aussichtstürme immer.
- **Namen.** Namen suchen sich unter mehreren Positionen eine freie. Passt ein Name wegen einer Kollision nicht, darf der weniger wichtige Name entfallen; das Symbol entfällt nie.
- **Wegzeichen (geändert am 2026-11-14).** Jedes Zeichen steht einzeln. Laufen mehrere Routen über einen Abschnitt, stehen ihre Zeichen hintereinander entlang des Weges, nicht als Reihe an einem Punkt. Auf jedem Ast nach einer echten Gabelung steht das Zeichen der dort weiterlaufenden Route(n) mindestens einmal, aber auf der freien Strecke und nicht gesammelt an der Gabelung (geändert am 2026-11-14). Zeichen überdecken einander nicht (siehe Abschnitt 3). Die Wegzeichen gehören zur Route (entschieden am 2026-11-14): Wird eine Route angezeigt, wird auch ihr Zeichen angezeigt; es gibt keinen eigenen Schalter für Wegzeichen. Die Netz-Schalter unter „Wanderrouten“ (International, National, Regional, Lokal) steuern Hinterlegung und Zeichen gemeinsam: das Zeichen einer Route erscheint, wenn „Wanderrouten“ und der Schalter ihres eigenen Netzes eingeschaltet sind. Ein Abschnitt bekommt die Hinterlegung, wenn mindestens eine seiner Routen in einem eingeschalteten Netz liegt (dann steht nie ein Zeichen auf einer nicht gezeichneten Hinterlegung); ihre Breite folgt dem höchsten sichtbaren Netz des Abschnitts. Standard: alles an, also auch lokale Wegzeichen.
- **Keine Kontrollzählung.** Ob etwas fehlt, wird visuell geprüft.
- **Gilt je Maßstab.** Bei 1:50 000 passt weniger aufs Blatt; dort wird über die Auswahl der Arten ausgedünnt, nicht über zufällige Kollisionen. Was gewählt ist, wird vollständig gezeichnet.

## 4b. Stilkorrekturen nach der Abnahme von M2

- **Gebäude in Industrie- und Gewerbegebieten** sind grau wie die Fläche, in der sie liegen, nur dunkler. Dafür bekommt jedes Gebäude beim Tile-Build ein Merkmal, ob es in einer solchen Fläche liegt (räumlicher Abgleich mit `landuse=industrial|commercial`); der Stil färbt danach.
- **Stromleitungen** erscheinen grundsätzlich nicht. Der Layer `power` entfällt aus den Tiles, die Ebene und der Schalter aus der App (Feature E8 gestrichen).
- **Nummernschilder für große Straßen:** Autobahnen bekommen das blaue Schild mit weißer Nummer, Bundesstraßen das gelbe mit schwarzer Nummer, jeweils als Symbol entlang der Straße in Druckauflösung erzeugt. Landes- und Kreisstraßen behalten die schlichte Nummer.

## 4c. Bushaltestellen aus GTFS

Bushaltestellen kommen nicht aus OSM, sondern aus dem deutschlandweiten GTFS-Fahrplandatensatz, damit nur Haltestellen mit brauchbarem Angebot auf der Karte stehen.

- **Daten:** gesamtdeutscher GTFS-Feed, abgelegt unter `$CAPERCAILYE_DATA/gtfs/`. Quelle: gtfs.de, kostenloser Feed „de_full“ (Basis: DELFI e.V., CC BY 4.0), Quellenangabe „Fahrplandaten: DELFI e.V. / gtfs.de, CC BY 4.0“ im Blattrand. Der kostenlose Feed gilt nur 30 Tage; `transit/build.sh --refresh` holt einen neuen Stand.
- **Auswahl:** nur Bus-Haltestellen mit mindestens 4 Abfahrten an einem Wochenendtag. Entschieden am 2026-11-13: gezählt werden Samstag und Sonntag getrennt in einer normalen Woche, und der schwächere der beiden Tage muss die Schwelle erreichen.
- **Verarbeitung:** ein Skript unter `transit/` liest `stops`, `stop_times`, `trips`, `routes`, `calendar` und `calendar_dates`, zählt die Abfahrten je Haltestelle und schreibt die ausgewählten Haltestellen mit Namen und Abfahrtszahl als eigene kleine PMTiles-Datei nach `$CAPERCAILYE_DATA/`. Die Schwelle ist ein Parameter.
- **Karte:** eigenes Haltestellen-Symbol, eigener Schalter „Bushaltestellen“. Die Art `bus_stop` aus OSM entfällt aus Tiles und Stil. Bahnhöfe und Haltepunkte bleiben aus OSM.
- **Masten:** Haltestellen bestehen im GTFS oft aus einem Mast je Fahrtrichtung. Entschieden am 2026-11-13: ein Symbol je Haltestelle; die Masten werden zusammengefasst und ihre Abfahrten addiert.
- **Benachbarte Haltestellen (2026-11-14).** Ausgewählte Haltestellen, die weniger als 75 m auseinanderliegen, werden zu einem Symbol zusammengefasst (Leader-Verfahren wie bei den Picknickplätzen im Tile-Profil, Option `--merge-m 75`). Entschieden: (1) Die Schwelle gilt je Haltestelle vor dem Zusammenfassen; zusammengefasst werden nur die ausgewählten (Addieren würde Fahrten benachbarter Haltestellen doppelt zählen und schwache Haltestellen über die Schwelle heben, und das Zusammenfassen ändert nicht, welche Orte eine brauchbare Verbindung haben). (2) Die Abfahrten des Symbols sind die des Repräsentanten (der mit den meisten Abfahrten, also dem Maximum der Gruppe), keine Summe. (3) Repräsentant: höchstes `min`, dann `sat + sun`, dann Name; er nimmt alle freien Haltestellen im Umkreis von 75 m um sich selbst (keine Ketten); Position und Name sind seine.

## 5. Repo-Struktur

```
capercailye/
├── PLAN.md
├── LICENSE                         # MIT
├── tiles/
│   ├── CapercailyeProfile.java     # Planetiler-Profil (eine Datei)
│   └── build.sh                    # lädt planetiler.jar, baut PMTiles nach $CAPERCAILYE_DATA/
├── transit/                        # GTFS → Bushaltestellen-PMTiles (Abschnitt 4c)
└── web/                            # Bun + Vite + TypeScript, oxfmt
    └── src/
        ├── main.ts
        ├── style/                  # Stil als TS-Module, je Feature-Gruppe ein Baustein (für die Schalter)
        ├── osmc/                   # Parser, Formen, SVG-Erzeugung, styleimagemissing
        ├── print/                  # Maßstab, Blattschnitt, Vorschau-Rahmen, Export, PDF
        ├── sidebar.ts              # Ebenen-Schalter, Druck-Einstellungen
        ├── search.ts               # Photon
        └── gpx.ts
```

Große Dateien (PMTiles, `planetiler.jar`) liegen unter `$CAPERCAILYE_DATA/` und nicht im Repo. Der Dev-Server liefert sie von dort mit Range-Requests aus.

## 6. Meilensteine

| # | Inhalt | Fertig, wenn … | Aufwand |
|---|---|---|---|
| **M0** | Durchstich: Minimal-Profil (Wege + Routen), Karte im Browser, eine A4-Seite als PDF | ein Testausdruck von Veringenstadt maßhaltig ist (Kontrollstrecke nachgemessen) und alle Wege bei Druckzoom da sind | 0,5–1 Tag |
| **M1** | Vollständiges Tile-Schema nach der Feature-Auswahl aus Abschnitt 8 | BW baut in Minuten, alle gewählten Features sind in den Tiles | 1 Tag |
| **M2** | Kartenstil: Flächen, Wege-Signaturen, Gewässer, Gebäude, Beschriftung, POI-Piktogramme | Kartenbild ist auf einem Testausdruck bei 1:25 000 gut lesbar (Blicktest auf Papier) | 2–3 Tage |
| **M2b** | Vollständigkeit im Druck und Stilkorrekturen (siehe Abschnitte 4a und 4b) | dicht liegende Symbole stehen beim Druckmaßstab nebeneinander statt zu entfallen; Gebäude in Industrie-/Gewerbegebieten sind grau; keine Stromleitungen; Autobahnen und Bundesstraßen tragen Nummernschilder | 1,5–2 Tage |
| **M2c** | Bushaltestellen aus GTFS statt aus OSM (siehe Abschnitt 4c) | Haltestellen mit mindestens 4 Abfahrten am Wochenendtag erscheinen mit eigenem Symbol, OSM-Haltestellen sind entfernt | 1 Tag |
| **M3** | OSMC-Symbole samt Rückfallkette und kombinierten Zeichen (nach denselben Regeln aus 4a) | Stichprobe von 30 Routen in BW stimmt mit Waymarked Trails überein | 1–1,5 Tage |
| **M4** | Relief: Mapterhorn-Dienst einbinden, Schummerung, Höhenlinien mit Zähllinien | Höhenlinien im Druck ruhig und lesbar | 0,5 Tage |
| **M5** | Druck: beide Modi, Blattschnitt-Vorschau, mehrseitiger PDF-Export, Blattrand | 6 Seiten exportieren ohne Fehler, Überlappungen passen aneinander | 1,5–2 Tage |
| **M6** | Sidebar-Schalter, Photon-Suche, GPX-Upload, Feinschliff der Oberfläche | alles bedienbar, GPX erscheint in Vorschau und PDF, die Oberfläche wirkt fertig | 0,5–1 Tag |

Summe: etwa 7–10 Arbeitstage. M2 ist der größte und am wenigsten planbare Block; M0 kommt zuerst, weil er die technischen Risiken aus Abschnitt 7 klärt.

**Arbeitsweise:** Die Umsetzung läuft über Subagents. Seit 2026-11-13 setzen nur Sonnet-Agents um, jeweils mit klar umrissener Aufgabe; bei komplexen Aufgaben bereitet ein Opus-Agent die Aufgabe vor (Klärung, Entscheidungen, Auftragsbeschreibung) und setzt selbst nichts um. Nach jedem Meilenstein gibt es einen kurzen Statusbericht, und es geht erst nach deiner Freigabe weiter.

## 7. Risiken und offene Annahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Beim Druckzoom (~12,9) lädt MapLibre z12-Tiles, dort könnten Details fehlen oder zu grob vereinfacht sein | Alle druckrelevanten Features ab z12 mit geringer Vereinfachung in die Tiles; alternativ Quelle so einstellen, dass z13 geladen wird. Wird in M0 geprüft. |
| Icons unscharf bei hohem `pixelRatio` | Alle Icons (OSMC und POI) zur Laufzeit aus SVG in Druckauflösung erzeugen statt aus einem Sprite |
| Browser senkt bei zu großem Canvas stillschweigend die Auflösung | Bildgröße im PDF in mm setzen (Maßstab bleibt richtig), Canvas-Größe prüfen und warnen |
| `maplibre-contour` mit aktueller MapLibre-Version und PMTiles-DEM ungetestet | Rückfallweg `gdal_contour` + `tippecanoe` |
| Relief hängt am Mapterhorn-Dienst (Verfügbarkeit, Internet nötig) | Karte funktioniert auch ohne Relief; lokaler Ausschnitt als Rückfallweg |
| Deutschland/Europa: Europa-PBF (~30 GB) braucht ein Mehrfaches an Plattenplatz | Deutschland geht mit der vorhandenen PBF; Europa erst nach Platzprüfung |
| Exotische `osmc:symbol`-Werte (rund 35 000 verschiedene weltweit, Anteil in BW ungezählt) | Rückfallkette; in M3 die BW-Werte mit `osmium` auszählen und die häufigsten zuerst abdecken |
| Der Stil frisst die meiste Zeit | Früh drucken, Größen in mm festlegen, Feature-Umfang über Abschnitt 8 begrenzen |

## 8. Karten-Features zur Auswahl

**Entschieden am 2026-11-13:** Umgesetzt werden alle Zeilen mit „Kern“ und „Empfohlen“. Alles mit „Optional“ sowie die Routenlegende (B5) ist zurückgestellt. Bei F5 heißt das: Rastplätze und Grillstellen ja, Bänke nein.

**Kern** = aus meiner Sicht nötig für eine brauchbare Wanderkarte, **Empfohlen** = klarer Mehrwert bei wenig Aufwand, **Optional** = Geschmackssache oder mehr Aufwand. Die Spalte „Schalter“ zeigt, was in der Sidebar ein- und ausblendbar wäre.

### A – Wege und Verkehr

| ID | Feature | OSM | Vorschlag | Schalter |
|---|---|---|---|---|
| A1 | Pfade und Fußwege | `highway=path|footway|steps|bridleway` | Kern | – |
| A2 | Feld- und Waldwege nach Ausbaugrad | `highway=track` + `tracktype=grade1–5` | Kern | – |
| A3 | Straßen klassifiziert (Autobahn bis Wohnstraße, mit Nummern; Autobahnen und Bundesstraßen mit Nummernschild) | `highway=*`, `ref` | Kern | – |
| A4 | Schwierigkeit alpiner Pfade (Signatur gepunktet/farbig) | `sac_scale` | Empfohlen | – |
| A5 | Schlecht sichtbare Pfade (dünner/lückig) | `trail_visibility` | Empfohlen | – |
| A6 | Radwege | `highway=cycleway` | Empfohlen | – |
| A7 | Brücken und Tunnel | `bridge`, `tunnel` | Kern | – |
| A8 | Gesperrte/private Wege kennzeichnen | `access=private|no` | Empfohlen | – |
| A9 | Bahnlinien und Bahnhöfe/Haltepunkte | `railway=*` | Kern | – |
| A10 | Bushaltestellen mit mindestens 4 Abfahrten am Wochenendtag | GTFS, nicht OSM (Abschnitt 4c) | Empfohlen | ja |
| A11 | Seilbahnen, Lifte | `aerialway=*` | Optional | – |
| A12 | Wegoberfläche (befestigt/unbefestigt) | `surface` | Optional | – |
| A13 | Furten, Tore, Schranken, Zaunübertritte | `ford`, `barrier=gate|stile|…` | Optional | ja |

### B – Wanderrouten

| ID | Feature | OSM | Vorschlag | Schalter |
|---|---|---|---|---|
| B1 | Routenlinien farbig hinterlegt | Relation `route=hiking|foot` | Kern | ja |
| B2 | Wegzeichen | `osmc:symbol`, Rückfall `ref`/`colour` | Kern | ja |
| B3 | Routen nach Netz ein-/ausblenden (international, national, regional, lokal) | `network=iwn|nwn|rwn|lwn` | Empfohlen | ja |
| B4 | Routennamen entlang der Linie | `name` | Optional | ja |
| B5 | Routenlegende am Blattrand (Zeichen + Name der Routen auf dem Blatt) | – | Empfohlen | ja |
| B6 | Wegweiser-Standorte | `information=guidepost` (+ `name`, `ele`) | Empfohlen | ja |

### C – Gelände und Bodenbedeckung

| ID | Feature | OSM / Quelle | Vorschlag | Schalter |
|---|---|---|---|---|
| C1 | Wald | `landuse=forest`, `natural=wood` | Kern | – |
| C2 | Laub-/Nadel-/Mischwald-Signatur | `leaf_type` | Optional | – |
| C3 | Wiese, Acker, Obstwiese, Weinberg | `landuse=meadow|farmland|orchard|vineyard` | Kern | – |
| C4 | Heide, Gebüsch, Moor/Feuchtgebiet | `natural=heath|scrub|wetland` | Empfohlen | – |
| C5 | Fels, Geröll, Felswände, Steinbruch | `natural=bare_rock|scree|cliff`, `landuse=quarry` | Empfohlen | – |
| C6 | Höhenlinien 10 m mit Zähllinien und Höhenzahlen | Mapterhorn | Kern | ja |
| C7 | Schummerung | Mapterhorn | Kern | ja |
| C8 | Gipfel, Sättel mit Name und Höhe | `natural=peak|saddle`, `ele` | Kern | – |
| C9 | Höhlen, Dolinen, Einzelfelsen | `natural=cave_entrance|sinkhole|rock` | Empfohlen | – |
| C10 | Einzelbäume, Baumreihen, Hecken | `natural=tree|tree_row`, `barrier=hedge` | Optional | – |
| C11 | Schutzgebietsgrenzen (NSG, Nationalpark) | `boundary=protected_area`, `leisure=nature_reserve` | Empfohlen | ja |

### D – Gewässer

| ID | Feature | OSM | Vorschlag | Schalter |
|---|---|---|---|---|
| D1 | Flüsse, Bäche, Gräben mit Namen | `waterway=*` | Kern | – |
| D2 | Seen, Teiche | `natural=water` | Kern | – |
| D3 | Quellen | `natural=spring` | Kern | – |
| D4 | Trinkwasser, Brunnen | `amenity=drinking_water|fountain` | Kern | ja |
| D5 | Wasserfälle, Wehre | `waterway=waterfall|weir` | Empfohlen | – |

### E – Siedlung und Bauwerke

| ID | Feature | OSM | Vorschlag | Schalter |
|---|---|---|---|---|
| E1 | Gebäude (Einzelgebäude sichtbar) | `building=*` | Kern | – |
| E2 | Siedlungs-, Gewerbe-, Industrieflächen | `landuse=residential|commercial|industrial` | Kern | – |
| E3 | Ortsnamen (Stadt bis Weiler/Einzelhof) | `place=*` | Kern | – |
| E4 | Flur- und Gewannnamen | `place=locality` | Empfohlen | – |
| E5 | Kirchen, Kapellen, Wegkreuze | `amenity=place_of_worship`, `historic=wayside_cross|wayside_shrine` | Empfohlen | – |
| E6 | Burgen, Ruinen, Denkmäler | `historic=castle|ruins|memorial` | Empfohlen | ja |
| E7 | Türme, Masten, Windräder (Orientierung) | `man_made=tower|mast`, `power=generator` | Empfohlen | – |
| E8 | Hochspannungsleitungen | `power=line` | gestrichen (2026-11-13) | – |
| E9 | Friedhöfe, Sportplätze, Parks | `landuse=cemetery`, `leisure=pitch|park` | Optional | – |
| E10 | Gemeinde-/Kreisgrenzen | `boundary=administrative` | Optional | ja |

### F – Wander-Infrastruktur (Piktogramme)

| ID | Feature | OSM | Vorschlag | Schalter |
|---|---|---|---|---|
| F1 | Schutzhütten, Unterstände | `amenity=shelter`, `tourism=wilderness_hut` | Kern | ja |
| F2 | Bewirtschaftete Hütten, Gasthäuser, Cafés | `tourism=alpine_hut`, `amenity=restaurant|cafe|biergarten` | Kern | ja |
| F3 | Aussichtspunkte, Aussichtstürme | `tourism=viewpoint`, `tower:type=observation` | Kern | ja |
| F4 | Wanderparkplätze | `amenity=parking` | Kern | ja |
| F5 | Rastplätze, Grillstellen, Bänke | `tourism=picnic_site`, `amenity=bbq|bench` | Empfohlen (Bänke optional) | ja |
| F6 | Infotafeln, Karten | `information=board|map` | Optional | ja |
| F7 | Campingplätze, Jugendherbergen, Hotels | `tourism=camp_site|hostel|hotel` | Empfohlen | ja |
| F8 | Toiletten | `amenity=toilets` | Empfohlen | ja |
| F9 | Touristeninformation, Museen, Sehenswürdigkeiten | `tourism=information|museum|attraction` | Optional | ja |
| F10 | Schwimmbäder, Badestellen | `leisure=swimming_pool|bathing_place` | Optional | ja |
| F11 | Hochsitze | `amenity=hunting_stand` | Optional | ja |

### G – Kartenrahmen und Zusätze

| ID | Feature | Vorschlag |
|---|---|---|
| G1 | Maßstabsleiste, Maßstabszahl, Nordpfeil, Quellenangabe, Blattnummer | Kern |
| G2 | 10-cm-Kontrollstrecke | Empfohlen |
| G3 | UTM-Gitter 1 km mit Koordinaten am Rand | Optional (ca. 0,5 Tage) |
| G4 | Übersichtsblatt mit Blattschnitt als erste PDF-Seite | Optional |
| G5 | Zeichenerklärung als eigene PDF-Seite | Optional |
| G6 | GPX-Track mit Start/Ziel und Kilometermarken | Track: festgelegt; Kilometermarken: Optional |

## 9. Zurückgestellt

- Alle „Optional“-Features aus Abschnitt 8.
- Routenlegende am Blattrand (B5), eventuell später.
- Ausweitung auf Deutschland oder Europa.
