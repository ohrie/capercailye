# transit/ – Bushaltestellen aus GTFS

Erzeugt aus dem gesamtdeutschen GTFS-Fahrplan eine kleine PMTiles-Datei mit allen Bushaltestellen, die an
einem Samstag **und** an einem Sonntag mindestens 4 Abfahrten haben (SPEC.md, Abschnitt 5).

## Aufruf

```sh
transit/build.sh                                  # nutzt den zuletzt geladenen Feed (lädt beim ersten Mal)
transit/build.sh --refresh                        # aktuellen Feed neu laden
transit/build.sh -- --min 6                       # Schwelle ändern (Standard 4)
transit/build.sh -- --bbox 7.5,47.5,10.5,49.8     # nur ein Ausschnitt (minLon,minLat,maxLon,maxLat)
transit/build.sh -- --saturday 2026-11-28         # andere Woche erzwingen
```

Benötigt `bun`, `curl`, `unzip`, `tippecanoe`. Laufzeit rund 45 s (Zählen ca. 30 s, tippecanoe ca. 15 s), Speicher
einige hundert MB (stop_times.txt mit 2,1 GB wird gestreamt). Plattenplatz für den Feed: Zip 263 MiB + entpackt 2,1 GB.

Ausgabe:

- `$CAPERCAILYE_DATA/capercailye-busstops.pmtiles` (rund 24 MB für ganz Deutschland, 124 265 Haltestellen)
- `$CAPERCAILYE_DATA/capercailye-busstops.geojsonl` (Zwischendatei, GeoJSON Lines)
- `$CAPERCAILYE_DATA/tmp/busstops-stats.json` (Zahlen des Laufs)

Zusätzliche Optionen von `transit/busstops.ts` (nach `--`): `--cluster-m 150`, `--merge-m 75` (Regel 9, `0` schaltet das
Zusammenfassen ab), `--include-on-demand`,
`--include-rail-replacement`, `--all <datei.geojsonl>` (alle Haltestellen mit Abfahrten, auch unter der Schwelle, zur Diagnose).

## Schema der Tiles (fest)

Ein Layer `bus_stop`, Punkte, Zoom 10–14, keine Ausdünnung (`-r1`, `--no-feature-limit`, `--no-tile-size-limit`).
Attribute: `name` (string), `sat` (int, Abfahrten Samstag), `sun` (int, Abfahrten Sonntag), `min` (int, `min(sat, sun)`).

## Quelle, Lizenz, Quellenangabe

- Quelle: <https://gtfs.de/de/feeds/de_full/> – Feed „de_full“ (Deutschland gesamt, alle Verkehrsmittel inkl. Bus),
  kostenlose Basisversion `https://download.gtfs.de/germany/free/latest.zip`, ohne Registrierung. Datenbasis ist der
  NeTEx-Datensatz von DELFI e.V., den gtfs.de täglich nach GTFS konvertiert.
- Gültigkeit der kostenlosen Version: nur die nächsten 30 Tage (Stand 2026-11-07: 7.11.–7.12.2026). Die Haltestellenkarte
  gibt also einen Schnappschuss wieder und sollte mit `--refresh` aufgefrischt werden. Die erweiterten (kostenpflichtigen)
  Feeds mit voller Fahrplanperiode werden nicht verwendet.
- Lizenz: Creative Commons Namensnennung 4.0 (CC BY 4.0), <https://creativecommons.org/licenses/by/4.0/>. gtfs.de nennt
  keinen verbindlichen Wortlaut; `attributions.txt` im Feed nennt DELFI e.V. und GTFS.de als Hersteller.
- Vorschlag für den Blattrand: **Bushaltestellen: Fahrplandaten DELFI e.V., aufbereitet von gtfs.de (CC BY 4.0), von capercailye
  ausgewertet**. Kurzform: `Fahrplandaten: DELFI e.V. / gtfs.de, CC BY 4.0`. (Die Auswahl ist eine Bearbeitung, das
  ist bei CC BY zu kennzeichnen; der Zusatz „ausgewertet“ erfüllt das.)

## Stand des Feeds in den Tiles

`build.sh` leitet das Datum des Feeds aus dem Verzeichnisnamen `de_full-YYYYMMDD` ab (das Datum kommt
aus `Last-Modified` des Downloads) und schreibt es als `feed_date=YYYY-MM-DD` in die
PMTiles-Beschreibung (`tippecanoe -N "capercailye bus stops; feed_date=…"`, Feld `description`). Die
Web-App zeigt daraus „Stand TT.MM.JJJJ“ in Seitenleiste und Karten-Attribution (nicht im PDF). Passt der
Verzeichnisname nicht zum Muster, entfällt `-N` und damit der Stand. Prüfen: in der App
`__capercailye.credits.busstops`.

## Regeln

1. **Nur Bus:** `route_type` 3 sowie 700–799. Im Feed kommt nur Typ 3 vor (23 124 Linien); 7xx gibt es nicht
   (Typ 715 wäre als Bedarfsverkehr ausgeschlossen).
2. **Bedarfsverkehr ausgeschlossen** (352 Linien): Der Feed führt Rufbusse, Anruf-Sammeltaxis usw. als Typ 3 und
   kennzeichnet sie nur im Linien­namen. Erkannt werden Namen mit Rufbus, AST, ALT, ALF, ALFA, ALiTa, Anruf…, …taxi…, Bedarf…,
   On-Demand, Flex… (Muster `ON_DEMAND` in `busstops.ts`). Begründung: Sie fahren nur nach Anmeldung und sind keine
   Abfahrten, auf die man sich am Mast verlassen kann. Bürgerbusse mit festem Fahrplan bleiben drin.
3. **Schienenersatzverkehr ausgeschlossen** (554 Linien): Ersatzbusse stehen unter Typ 3 mit Bahn-Liniennamen
   (RB…, RE…, SEV…, …EV, S/U-Linien, deren Name im Feed auch als Bahnlinie vorkommt). Sie sind vorübergehend und würden
   Bahnhöfe zu Bushaltestellen machen.
4. **Normale Woche:** Standard ist der Samstag nächst der Mitte des Gültigkeitszeitraums, dessen Woche (Mo–So) komplett
   im Zeitraum liegt und keinen bundesweiten Feiertag enthält (Neujahr, Karfreitag, Ostern, 1. Mai, Himmelfahrt,
   Pfingsten, 3. Oktober, 25./26. Dezember). Für den Feed vom 2026-11-07 ist das **Samstag 21.11.2026 und Sonntag 22.11.2026**.
   Landesfeiertage und Schulferien werden nicht berücksichtigt.
5. **Betriebstage:** `calendar.txt` (Wochentag, Zeitraum) plus `calendar_dates.txt` (Typ 1 = hinzu, Typ 2 = entfällt);
   Dienste, die nur in `calendar_dates` stehen, werden ebenfalls erfasst. Fahrten mit Zeiten ≥ 24:00 zählen zum Betriebstag.
6. **Abfahrt** = ein `stop_time` mit `pickup_type != 1`, der nicht der letzte Halt (höchste `stop_sequence`) der Fahrt ist.
   Samstag und Sonntag werden getrennt gezählt. (`pickup_type` 2 = „nach Anruf“ zählt wie verlangt mit; im Feed 277 251 solcher
   Halte, 2 % aller gezählten Zeilen.)
7. **Eine Haltestelle je Ort:** Masten (`location_type` 0) werden zuerst über `parent_station` zusammengefasst, danach
   Einheiten mit gleichem `stop_name` (ohne Beachtung von Groß-/Kleinschreibung) und höchstens 150 m Abstand
   (Einfachverknüpfung). Der zweite Schritt fängt gegenüberliegende Masten ab, die an verschiedenen Elternstationen hängen oder
   keine haben; 150 m deckt Kreuzungen ab, und gleichnamige Haltestellen verschiedener Orte werden nicht vermischt, weil die Namen
   meist den Ort enthalten. Abfahrten der Masten werden addiert, die Position ist der Mittelpunkt der Masten mit Abfahrten.
   Größte beobachtete Ausdehnung einer zusammengefassten Haltestelle: 226 m.
8. **Auswahl:** `min(sat, sun) >= Schwelle` (Standard 4), je Haltestelle (nach Regel 7).
9. **Benachbarte Haltestellen zusammenfassen** (`--merge-m 75`, seit 2026-11-14): ausgewählte Haltestellen, die höchstens
   75 m auseinanderliegen, werden zu **einem** Symbol (Leader-Verfahren wie bei den Picknickplätzen im Tile-Profil,
   deterministisch). Sortierung: `min` absteigend, dann `sat + sun` absteigend, dann Name (Code-Einheiten-Vergleich),
   dann Länge und Breite. Die beste noch freie Haltestelle wird Repräsentant und nimmt alle freien innerhalb 75 m
   **von sich selbst** (keine Ketten). Position, Name und Abfahrten (`sat`, `sun`, `min`) sind die des Repräsentanten,
   es wird nichts addiert. Begründung: (a) benachbarte, verschieden benannte Haltestellen werden oft von denselben
   Fahrten nacheinander bedient, Addieren würde Fahrten doppelt zählen und schwache Haltestellen (2 + 2) über die
   Schwelle heben, deshalb wird erst ausgewählt und dann zusammengefasst; (b) es ist eine reine Darstellungsmaßnahme auf
   bereits gefilterten Kandidaten und ändert nicht, welche Orte eine brauchbare Verbindung haben. Gerechnet wird über
   alle ausgewählten Haltestellen, `--bbox` filtert erst danach (Ausschnitt-Läufe liefern dieselben Punkte wie der
   Gesamtlauf). `--all` bleibt unzusammengefasst. Feed 2026-11-07: 125 665 ausgewählt → 124 265 Symbole (1 400
   Zusammenfassungen), größte Gruppe 5 Haltestellen („BNA, Bahnhof 05“); `busstops-stats.json` enthält `mergeM`,
   `selectedBeforeMerge`, `selectedAfterMerge` und `largestMergedGroup`.

## Bekannte Eigenheiten der Daten

- Haltestellennamen stammen unbereinigt aus dem Feed; je nach Verbund mit oder ohne Komma nach dem Ort
  („Aachen, Marienhospital“ gegenüber „Veringenstadt Bahnhof“), gelegentlich mit doppeltem Ort („Rottweil Rottweil Obere Bahnhofstraße“).
- Elternstationen von Bahnhöfen enthalten oft auch Bahnsteige; gezählt werden nur Bus-Fahrten, die Position ist die der Busmasten.
- Ob Linien am Wochenende „wirklich“ fahren, hängt an der Qualität der Daten der Verkehrsunternehmen.
