# Landingpage, Logo und App-Feinschliff – Umsetzungsplan

Stand: 2026-11-14. Geschrieben als Auftrag für ein oder zwei Sonnet-Subagenten. **Noch nicht
umsetzen**: Gerade arbeitet ein anderer Agent in `web/` (siehe `git status`, viele offene Änderungen
in `web/src/`). Phase 1 berührt `web/` nicht und kann jederzeit starten. Phase 2 und 3 erst, wenn der
andere Agent fertig ist und seine Änderungen committet sind.

## 0. Ziel

1. Eine kurze, englische Info-Seite (SEO + Erklärung für Nutzer) mit Calls-to-Action zum Tool.
2. Ein Logo: stilisiertes Auerhuhn (Auerhahn) im 8-Bit-Pixelstil als SVG.
3. Bilder aus der eigenen Karte, nur: Dahner Felsenland, Calmont, Schwarzwald als Ganzes,
   Feldberg, Druckansicht, GPX-Track und OG-Image (Liste in 4.2).
4. Eine feste Farbpalette, die Karte, App und Landingpage gemeinsam nutzen.
5. App: Button „Gebiet zur Kartenmitte“ entfernen; Modus-Schalter Erkunden/Zeichnen/Seiten mit
   Schrittnummern 1, 2, 3 in Kreisen.

## 1. Festgelegte Entscheidungen (nicht neu verhandeln)

### 1.1 Farbpalette

Abgeleitet aus `web/src/style/palette.ts`. Die Kartenfarben bleiben unverändert; App und
Landingpage übernehmen sie. Nur helles Farbschema (Papier-Look wie die gedruckte Karte), kein
Dark Mode.

| Token | Wert | Herkunft in `palette.ts` | Verwendung |
|---|---|---|---|
| `--paper` | `#fcfbf6` | `paper` | Seitenhintergrund |
| `--surface` | `#ffffff` | – | Karten/Kacheln, Header |
| `--ink` | `#1f1f1f` | `text` | Text, **alle Konturlinien** |
| `--ink-muted` | `#5c5c5c` | `pathFaint` | Nebentext |
| `--line-soft` | `#e4e1dc` | `bareRock` | feine Trennlinien |
| `--trail` | `#be2230` | `route` | **einzige Akzentfarbe**: CTAs, Links, Schrittkreise aktiv |
| `--trail-dark` | `#9b1b27` | – | Hover der CTAs |
| `--forest` | `#3c7d3f` | `protectedText` | sekundär: Tags, Häkchen |
| `--forest-light` | `#c3dda2` | `forest` | Flächen (Feature-Hintergrund, Hero-Band) |
| `--meadow` | `#edf4da` | `meadow` | abgesetzte Sektionen |
| `--water` | `#3a8bcc` | `waterway` | sparsam, Illustration |
| `--contour` | `#9c6b45` | `contourIndex` | Höhenlinien-Ornament |
| `--gpx` | `#d4007f` | `gpx` | nur beim GPX-Feature |

Gestaltung: flach, keine Schatten, keine Verläufe. Klare sichtbare Linien: Bilder, Karten und
Buttons haben `1.5px solid var(--ink)`, Radius `4px` (wie `--radius` der App). Schrift: System-
Schriftstapel der App (`--font` in `web/src/app.css`), keine Webfonts. Überschriften 700, Text 400.

### 1.2 Struktur und Ablage

- Landingpage als **eigenes statisches Verzeichnis `site/`** im Repo-Root (reines HTML + CSS, kein
  JS nötig, kein Build). So kollidiert nichts mit `web/`.
- Alle CTAs zeigen auf `/app/` (Annahme fürs Deployment: Landingpage unter `/`, gebaute App unter
  `/app/`). Das Umstellen von `vite.config.ts` auf `base: "/app/"` und das Hosting der PMTiles
  gehören **nicht** zu diesem Auftrag.
- Logo liegt einmal in `site/logo.svg` und wird für die App nach `web/public/logo.svg` kopiert
  (Phase 2).

```
site/
├── index.html          Landingpage (lang="en")
├── styles.css          Tokens (1.1) + Layout
├── logo.svg            8-Bit-Auerhuhn
├── favicon.svg         = logo.svg (ggf. ohne Rand-Pixel)
├── robots.txt, sitemap.xml
├── img/                Bilder aus Phase 3 (.jpg, je @1x und @2x) + og-image.jpg
├── README.md           Kurz: was liegt hier, wie Bilder neu erzeugen, Deploy-Annahme /app/
└── scripts/
    ├── logo.ts         erzeugt logo.svg aus einer Pixel-Matrix
    └── snapshots.ts    erzeugt die Bilder aus der laufenden App (Phase 3)
```

`site/package.json` nur für `playwright-core` (devDependency) und die Skripte
`"logo": "bun scripts/logo.ts"`, `"snapshots": "bun scripts/snapshots.ts"`.

## 2. Phase 1 – Logo und Landingpage (Agent A, darf vor dem anderen Agenten fertig werden)

### 2.1 Logo: 8-Bit-Auerhahn

- Motiv: balzender Auerhahn im Profil, Fächerschwanz aufgestellt, Hals gestreckt, Bart. Muss bei
  32 px (Favicon) noch als Vogel erkennbar sein.
- Raster 24 × 24, `viewBox="0 0 24 24"`, `shape-rendering="crispEdges"`, keine Anti-Aliasing-Kanten.
  Je Farbe **ein** `<path>` aus Rechtecken (`M x y h w v 1 h -w z`), nicht hunderte `<rect>`.
- Farben nur aus der Palette: Körper `--ink` `#1f1f1f`, Schwanzfedern/Zeichnung `#3a3a3a`, Flügel
  braun `#6e5a46` (`textLocality`), Brustschimmer `--forest` `#3c7d3f`, Rosen (rote Haut über dem
  Auge) `--trail` `#be2230`, Schnabel und weiße Flecken (Schulter, Unterschwanz) `#eeebc6`. Max.
  6 Farben. Der rote Augenfleck greift die Routenfarbe auf – das ist der Markenanker.
- `scripts/logo.ts` enthält die Pixel-Matrix als String-Array (ein Zeichen je Pixel, `.` = leer,
  z. B. `K` ink, `T` dunkelgrau, `B` braun, `G` grün, `R` rot, `W` hell) und schreibt
  `logo.svg` und `favicon.svg`. So lässt sich das Bild durch Editieren der Matrix verbessern.
- Startskizze (Blick nach links, frei verbessern, nur Orientierung):

```
..............T.T.T.T...
.............TKTKTKTKT..
...KK.......TKTKTKTKTKT.
..KRKK......KTKTKTKTKTK.
.WKKKK.....TKTKTKTKTKTKT
WWKKKK.....KTKTKTKTKTKTK
.KKKKK......KKKKKKKKKKK.
..KKGG......KKKKKKKKKK..
..KGGGK...KKKKKKKKKK....
...GGGKKKKKBBBBBKKK.....
...KGGGKKKBBBBBWBKK.....
....KGGKKKKBBBBBBKK.....
.....KKKKKKKKBBBKKK.....
......KKKKKKKKKKKK......
.......KKKKKKKKKW.......
.........KK..KK.........
.........B...B..........
........BB..BB..........
```

- **Sichtprüfung Pflicht**: Logo mit Chrome als PNG rendern (256 px und 32 px, siehe 4.1 für den
  Browserpfad) und mit dem Read-Tool ansehen. Iterieren, bis es klar ein Auerhahn ist. Beide PNGs
  im Scratchpad ablegen, nicht im Repo.
- Wortmarke daneben: `capercailye` in `--ink`, 700, leicht gesperrt (`letter-spacing: 0.02em`).

### 2.2 Inhalt der Landingpage (Englisch)

Ton: knapp, freundlich, konkret. Keine Superlative, keine erfundenen Zahlen. Nur Funktionen nennen,
die es gibt (Quelle: `web/README.md`, `web/src/style/index.ts`, `web/src/style/poi.ts`).

1. **Header** (sticky, `--surface`, untere Linie 1.5px `--ink`): Logo 32 px + Wortmarke links;
   rechts Anker „Features“, „How it works“, und Button „Open the map“ (CTA, `--trail`).
2. **Hero**: H1 „Print your own hiking map.“ Unterzeile: „Pick an area, check the pages, export an
   A4 PDF. Made from OpenStreetMap with a map style built for hikers.“ Primär-CTA „Make a map“ →
   `/app/`, Sekundär-Link „See what's on the map“ → `#style`. Daneben/darunter das Hero-Bild
   (Dahner Felsenland) mit 1.5px-Rahmen. Hintergrund dezentes Höhenlinien-Ornament als Inline-SVG
   (ein paar geschwungene Linien, `--contour`, Opazität ≈ 0.25).
3. **„Less screen, more trail.“** (Sektion `--meadow`): Kernbotschaft – wer beim Wandern nicht
   ständig aufs Handy schauen will, nimmt die Karte auf Papier mit: kein Akku, kein Empfang nötig,
   der ganze Tag auf einen Blick, mehr Zeit für die Natur. 2–3 kurze Sätze.
4. **Features** (`id="features"`, drei Kacheln, je Bild + H3 + 2–3 Sätze + Stichpunkte):
   - **Print it** – A4 hoch oder quer; Maßstab 1:15 000 / 1:25 000 / 1:50 000 *oder* feste
     Seitenzahl; mehrseitiges PDF mit 300 dpi, Maßstabsleiste und Quellenangabe am Rand. Bild:
     Druckansicht.
   - **Bring your GPX** – eigenen Track hochladen oder auf die Karte ziehen, er erscheint in
     Magenta (`--gpx`, Druckfarbe der Orientierungslaufkarten) über der Karte; Gebiet mit einem Klick
     auf den Track setzen. Bild: GPX-Aufnahme.
   - **A style made for hiking** (`id="style"`) – zeigt, was beim Wandern hilft, statt alles:
     Wege nach Schwierigkeit, markierte Wanderrouten mit ihren echten Wegzeichen entlang der Wege,
     Höhenlinien und Schummerung, und die wichtigen POIs: Schutzhütten, Einkehr,
     Wanderparkplätze, Rast- und Grillplätze, Unterkünfte, Toiletten, Trinkwasser und Quellen,
     Burgen und Ruinen, Aussichtspunkte, Wegweiser, Bushaltestellen. Bild: `calmont`.
5. **„Paper is harder than screens.“** (kurz, 3 Sätze): Eine Webkarte kann Details bis zum
   Hineinzoomen verstecken, Papier nicht. Auf festem Maßstab muss alles gleichzeitig lesbar sein,
   deshalb wählt der Stil aus, was zählt, und stellt Symbole frei, statt sie übereinander zu legen.
6. **How it works** (`id="how"`): drei Schritte mit **denselben nummerierten Kreisen wie in der
   App** (1, 2, 3; Kreis 28 px, 1.5px `--ink`-Rand, Ziffer 700): 1 Explore – Ort suchen, Karte
   ansehen; 2 Draw – Gebiet aufziehen; 3 Pages – Seiten prüfen, PDF exportieren, drucken. Hinweis
   in einem Satz: „The app's interface is in German for now.“
7. **Galerie**: vier Bilder (`dahn`, `calmont`, `schwarzwald`, `feldberg`, siehe 4.2) als Raster
   2 × 2, je Bild mit Bildunterschrift (Ort,
   Region). Bis Phase 3 fertig ist: Platzhalter-Kästen (`--forest-light`, gleiches Seitenverhältnis
   3:2) mit den finalen Dateinamen im `src`, damit nur noch Dateien fehlen.
8. **Coverage** (ein Satz): Kartendaten derzeit für Rheinland-Pfalz und Baden-Württemberg.
9. **Abschluss-CTA-Band** (`--forest-light`, Linien oben/unten): „Ready for the trail?“ + Button
   „Make a map“.
10. **Footer**: „Map data © OpenStreetMap contributors (ODbL) · Relief: Mapterhorn · Search: Photon
    · Code: MIT“; Logo klein.

### 2.3 SEO und Technik

- `<html lang="en">`, `<title>capercailye – print your own hiking map from OpenStreetMap</title>`,
  `meta description` (≤ 155 Zeichen), `link rel="canonical"` und `og:url` mit der
  festen Domain.
- Open Graph + Twitter Card (`og:image` = `img/og-image.jpg`, 1200 × 630).
- JSON-LD `WebApplication` (`name`, `description`, `applicationCategory: "TravelApplication"`,
  `operatingSystem: "Any (web browser)"`, `offers.price: 0`).
- Genau eine H1, sinnvolle H2/H3, beschreibende `alt`-Texte, `width`/`height` an allen `<img>`,
  `loading="lazy"` außer Hero, `srcset` mit @1x/@2x.
- `robots.txt` (alles erlaubt, Sitemap-Verweis), `sitemap.xml` (nur `/`).
- Responsiv: ab 360 px ohne horizontales Scrollen, Seitenränder 16 px mobil; max. Inhaltsbreite
  1120 px. Kontrast WCAG AA (Weiß auf `--trail` erfüllt das).
- Prüfen: Seite in Chrome headless bei 1280 und 390 px Breite als Screenshot rendern und ansehen.

**Ergebnis Phase 1**: `site/` vollständig mit Platzhalterbildern, Logo geprüft.

## 3. Phase 2 – App-Änderungen in `web/` (Agent B, erst nach dem anderen Agenten)

Vorher: `git status` prüfen; wenn in `web/` noch fremde, nicht committete Änderungen liegen, **stoppen
und melden**.

### 3.1 „Gebiet zur Kartenmitte“ entfernen

- `web/index.html`: `<button … id="area-recenter">` löschen.
- `web/src/sidebar.ts`: Hook `onRecenter` aus dem Interface (Zeile ≈ 34) und den Listener (≈ 98)
  entfernen.
- `web/src/main.ts`: `onRecenter`-Handler in `initSidebar({...})` entfernen. `recenterArea` **bleibt**
  (wird in `selectMode` beim Wechsel Erkunden → Seiten genutzt, plus Test in `layout.test.ts`).
- `web/README.md`: Erwähnungen in Zeile ≈ 107 und ≈ 307 anpassen.

### 3.2 Schrittnummern im Modus-Schalter

- `web/index.html`, die drei `<span>` im `.panel--mode .segmented`:
  `<span><b class="step" aria-hidden="true">1</b>Erkunden</span>`, analog 2 Zeichnen, 3 Seiten.
  Den `aria-label` der Radiogroup auf „Modus, Schritte 1 bis 3“ o. ä. setzen.
- `web/src/app.css`: `.step` als Kreis: `display:inline-grid; place-items:center; width:18px;
  height:18px; border-radius:50%; border:1.5px solid currentColor; font-size:11px;
  font-weight:700; margin-right:6px; line-height:1`. Der `<span>` des Segments wird
  `display:flex; align-items:center; justify-content:center`. Im gewählten Zustand
  (`input:checked + span`) invertiert der Kreis mit (folgt `currentColor`).
- Muss in die 300 px breite Sidebar passen, ohne Umbruch. Falls zu eng: Padding der Segmente auf
  `6px 4px` reduzieren; Schrift nicht verkleinern.
- Gleiche Kreis-Optik wie auf der Landingpage (2.2 Punkt 6), nur kleiner.

### 3.3 Palette und Logo in der App

- `web/src/app.css` `:root`: `--accent: #be2230` (statt `#c8102e`), `--fg: #1f1f1f`,
  `--line: #e4e1dc`. Sonst nichts an Layout/Abständen ändern.
- `site/logo.svg` nach `web/public/logo.svg` kopieren; Favicon in `web/index.html` auf
  `/logo.svg` umstellen (das Daten-URI-Quadrat ersetzen).
- `.brand::before` (rotes Quadrat) ersetzen durch das Logo (`background: url(/logo.svg)`,
  20 × 20 px, `image-rendering: pixelated`).
- Kartenfarben in `palette.ts` **nicht** ändern.

### 3.4 Prüfen

In `web/`: `bun test`, `bun run build`, `bun run fmt:check` – alles grün. Dev-Server auf
**eigenem Port** starten (`bunx vite --port 5180`), Sidebar per Chrome-Screenshot ansehen
(Schalter mit 1/2/3, kein Recenter-Button, Logo im Kopf).

## 4. Phase 3 – Bilder aus der Karte (Agent B, nach Phase 2)

### 4.1 Werkzeug

`site/scripts/snapshots.ts` mit `playwright-core`, Browser:
`chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--enable-unsafe-swiftshader",
"--use-angle=swiftshader"] })` (WebGL headless). Kein Browser-Download nötig. Basis-URL als
Argument, Standard `http://localhost:5180` (Dev-Server aus 3.4, liefert `/data/` mit den PMTiles).

Ablauf je Aufnahme:
1. `page.goto(base)`, warten bis `window.__capercailye` existiert.
2. Sidebar einklappen (`#sidebar-collapse` klicken), per `addStyleTag` ausblenden:
   `.maplibregl-ctrl-container, #sidebar-expand { display:none !important }`. Die
   OSM-Quellenangabe kommt stattdessen in die Bildunterschrift/Footer der Landingpage.
3. `__capercailye.map.jumpTo({ center, zoom })`, dann auf `idle` warten
   (`new Promise(r => map.once("idle", r))`), danach 1,5 s warten und noch einmal auf `idle` (die
   Symbolplatzierung läuft nachgelagert). Timeout 60 s, dann Fehler.
4. Screenshot nur von `#map`, `type: "jpeg", quality: 82`. Viewport 1200 × 800 CSS-px, je einmal mit
   `deviceScaleFactor` 1 (`name.jpg`) und 2 (`name@2x.jpg`).

Die App lädt fest `data/capercailye-rp.pmtiles` (`config.ts`, **nicht ändern**). Für die Orte in
Baden-Württemberg (Schwarzwald, Feldberg) läuft ein **zweiter Dev-Server** auf Port 5181 mit einem
eigenen Datenverzeichnis im Scratchpad, in dem `capercailye-rp.pmtiles` ein Symlink auf
`$CAPERCAILYE_DATA/capercailye-bw.pmtiles` ist (plus Symlink für
`capercailye-busstops.pmtiles`):
`CAPERCAILYE_DATA=<scratch>/bw-data bunx vite --port 5181` in `web/`. Die Quellenangabe der App
stimmt dann nicht (zeigt RP-Relief), ist auf den Aufnahmen aber ohnehin ausgeblendet.
`snapshots.ts` nimmt je Aufnahme die passende Basis-URL (RP 5180, BW 5181).

### 4.2 Aufnahmen

Koordinaten sind Näherungen: **mit Photon prüfen** (`https://photon.komoot.io/api/?q=<Ort>&limit=1`)
und den Ausschnitt so verschieben/zoomen, dass Wege, Wegzeichen, POIs und Höhenlinien gut zu sehen
sind (keine leeren Felder, nicht nur Siedlung).

| Datei | Ort | Center ≈ | Zoom | Extra |
|---|---|---|---|---|
**Nur diese Aufnahmen** werden erstellt und auf der Seite genutzt (keine weiteren Orte):

| Datei | Ort | Daten/Port | Center ≈ | Zoom | Verwendung |
|---|---|---|---|---|---|
| `dahn` | Dahner Felsenland, Pfälzerwald | RP / 5180 | 7.7765, 49.1505 | 14 | Hero, Galerie |
| `calmont` | Calmont bei Bremm, Mosel | RP / 5180 | 7.115, 50.103 | 14 | Stil-Feature, Galerie |
| `schwarzwald` | Schwarzwald als Ganzes | BW / 5181 | 8.15, 48.3 | ≈ 8.5 | Galerie |
| `feldberg` | Feldberg, Südschwarzwald | BW / 5181 | 8.004, 47.874 | 14 | Galerie |
| `gpx` | bei Dahn | RP / 5180 | wie dahn | 13.5 | GPX-Feature |
| `print` | Feldberg | BW / 5181 | – | – | Druck-Feature (Druckansicht) |
| `og-image` | wie `dahn` | RP / 5180 | | 14 | Viewport 1200 × 630, nur @1x |

- **Schwarzwald als Ganzes**: Übersichtsbild, das ganze Mittelgebirge soll im Bild sein (etwa
  Pforzheim bis Waldshut; im Querformat 1200 × 800 passt das nicht ganz, also den Zoom so wählen,
  dass der Großteil sichtbar ist). Vorher prüfen, was die Karte auf niedrigem Zoom zeigt
  (Wald, Schummerung, Orte); wenn sie dort leer oder unruhig ist, den kleinsten Zoom suchen, der
  gut aussieht, und das in der Bildunterschrift nicht überhöhen.

- **GPX**: Im Browser eine Wanderroute aus der Karte holen
  (`map.querySourceFeatures(<Vektorquelle>, { sourceLayer: "routes" })`, Quell-Id aus
  `web/src/style/sources.ts`), die längste zusammenhängende Linie nahe Dahn nehmen, als minimales
  GPX (`<gpx><trk><trkseg><trkpt lat lon/>…`) an `__capercailye.loadGpx(text)` geben. Die GPX-Datei
  auch unter `site/scripts/sample-dahn.gpx` speichern, damit die Aufnahme reproduzierbar ist.
- **Druckansicht**: `__capercailye.setState({ mode: "sheets", printView: true, print: { …aktuell,
  area: <ca. 4 km × 5 km um den Feldberg> } })`, Zustand vorher über die vorhandene API ermitteln
  (`web/src/state.ts`, Feldnamen dort nachsehen); 1:25 000, Hochformat, 2 Seiten sollen sichtbar
  sein.
- **Sichtprüfung Pflicht**: Jede @1x-Aufnahme mit dem Read-Tool ansehen. Fehlende Kacheln, graue
  Flächen, fehlendes Relief (Mapterhorn ist online) oder leere Ausschnitte → neu aufnehmen.
- Danach in `site/index.html` die Platzhalter durch die Bilder ersetzen, `alt`-Texte konkret
  formulieren (z. B. „Hiking map of the Dahner Felsenland with marked trails, waymarks and huts“).
- Gesamtgröße `site/img/` unter ~6 MB halten; sonst Qualität auf 75 senken.

## 5. Aufteilung auf Subagenten

| Agent | Phasen | Dateien | Start |
|---|---|---|---|
| **A** (Sonnet) | 1 | nur `site/` | sofort möglich, wenn der Nutzer startet |
| **B** (Sonnet) | 2, dann 3 | `web/index.html`, `web/src/app.css`, `web/src/sidebar.ts`, `web/src/main.ts`, `web/README.md`, `web/public/logo.svg`, `site/scripts/snapshots.ts`, `site/img/`, Bild-Einbindung in `site/index.html` | nach Agent A **und** nach dem anderen `web/`-Agenten |

Mit nur einem Agenten: Phasen 1 → 2 → 3 der Reihe nach. Kein Agent committet; der Nutzer
entscheidet über Commits. Abschluss: Opus prüft Logo, Screenshots der Landingpage (Desktop/Mobil)
und Sidebar gegen diesen Plan.

## 6. Offene Punkte (nicht Teil dieses Auftrags)

- Deployment: `base: "/app/"` in Vite, Hosting der PMTiles (Range-Requests), ggf. CDN.
- App-Oberfläche ist deutsch, die Landingpage englisch; spätere Übersetzung der App.
