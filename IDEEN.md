# capercailye – Ideen für später

Sammlung von Ideen, die nicht zum aktuellen Umfang gehören (siehe [PLAN.md](PLAN.md)). Nichts davon ist eingeplant.

## npm-Paket für OSMC-Wegzeichen

Das Modul `web/src/osmc/` als eigenständiges npm-Paket veröffentlichen, damit andere Karten-Projekte Wegzeichen aus `osmc:symbol` ohne eigenen Renderer darstellen können.

**Inhalt des Pakets:**

- **Konvertierung:** Parser für `osmc:symbol` (`wegfarbe:hintergrund:vordergrund[:vordergrund2]:text:textfarbe`) mit toleranter Auswertung (Groß-/Kleinschreibung, Tippfehler wie `circlce`, fehlende Teile) und Rückfallkette `ref` + `colour` → `ref` → Namenskürzel.
- **SVG-Erzeugung:** reine Funktionen ohne Browser-Abhängigkeit, die aus einem Wert ein SVG liefern (`osmcToSvg`) und mehrere Zeichen nebeneinander zu einem Bild kombinieren (`waymarkSvg`). Größe wählbar, z. B. in Millimetern für den Druck oder in Pixeln für den Bildschirm.
- **Integration in MapLibre GL JS:** optionaler Teil, der die Zeichen über `styleimagemissing` bzw. `setMissingStyleImageResolver` zur Laufzeit erzeugt und in beliebiger Auflösung (`pixelRatio`) rastert, dazu ein fertiger Ausdruck für `icon-image`, der aus Feature-Attributen die Bild-ID baut.

**Zu klären:**

- Paketaufteilung: ein Kernpaket (Parser + SVG, auch in Node nutzbar) und ein dünnes MapLibre-Zusatzpaket, oder ein Paket mit getrenntem Einstiegspunkt.
- Schrift für Text im Zeichen: Systemschrift wie bisher, oder Text als Pfade einbetten, damit das Ergebnis überall gleich aussieht.
- Lizenz MIT wie capercailye; die Formen bleiben unabhängig von Waymarked Trails (GPL-3.0), das nur als Verhaltensreferenz dient.
- Tests und Musterseite (`sample-sheet.ts`) mitnehmen; die BW-Häufigkeitsliste als Testdaten, ggf. um weitere Regionen ergänzen.

**Grundlage (npm-Paket):** Zerlegung und Formen sind portiert aus der Perl-Bibliothek [mueschel/OsmcToSVG](https://github.com/mueschel/OsmcToSVG) (Lizenz CC0-1.0). Im Paket und in der README darauf verweisen.

## Route-Marker nicht darstellen

Route-Marker (die Wegzeichen-Schilder entlang der Wanderrouten) sollten nicht dargestellt werden. Die Routen blieben über die farbige Hinterlegung erkennbar. Zu klären: ganz entfernen oder als Schalter (Standard aus), und wie Routen ohne Zeichen dann zuzuordnen sind.

## Wegzeichen einzeln und abwechselnd statt in einer Reihe

Heute stehen die Zeichen mehrerer Routen auf einem gemeinsamen Wegabschnitt als horizontale Reihe in einem Bild (höchstens 4). Das ist auf dem Ausdruck unklar: Man sieht nicht, welche Route zu welchem Zeichen gehört, sobald sich die Routen trennen.

Besser: Zeichen einzeln setzen, dafür häufiger, und auf gemeinsamen Abschnitten die verschiedenen Zeichen abwechselnd entlang der Linie. Damit entfällt auch die Grenze von 4 Zeichen.

Dafür braucht es einen eigenen Platzierungs-Algorithmus, der für den festen Druckmaßstab sicherstellt, dass auf dem Blatt immer eindeutig ist, welche Route welches Zeichen hat. Mögliche Regeln:

- Jedes Zeichen erscheint auf jedem Abschnitt seiner Route in einem Höchstabstand (z. B. alle 6 cm Papier), auch dort, wo es sich die Linie mit anderen teilt.
- Wo sich Routen trennen oder zusammenlaufen, steht kurz nach der Gabelung auf jedem Ast das Zeichen der dort weiterlaufenden Route(n), damit die Zuordnung an jeder Verzweigung klar ist.
- Auf gemeinsamen Abschnitten werden die Zeichen reihum gesetzt; jedes erscheint mindestens einmal zwischen zwei Gabelungen.
- Kein Zeichen entfällt durch Kollision (siehe PLAN.md 4a).

Voraussetzungen: Die Tiles müssten die Routen pro Abschnitt einzeln mit Relation-ID liefern (heute nur die deduplizierte, gekappte Liste), und die Platzierung liefe wie bei den Piktogrammen in der App statt über MapLibres `symbol-placement: line`.
