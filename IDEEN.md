# capercailye – Ideen für später

Sammlung von Ideen, die nicht zum aktuellen Umfang gehören (siehe [SPEC.md](SPEC.md)). Nichts davon ist eingeplant.

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
- Kein Zeichen entfällt durch Kollision (siehe SPEC.md 4.4).

Voraussetzungen: Die Tiles müssten die Routen pro Abschnitt einzeln mit Relation-ID liefern (heute nur die deduplizierte, gekappte Liste), und die Platzierung liefe wie bei den Piktogrammen in der App statt über MapLibres `symbol-placement: line`.

## Nur Aussichtspunkte mit Namen

Derzeit werden Aussichtspunkte standardmäßig ausgeschaltet. Zukünftig soll es standardmäßig angeschaltet sein, aber es sollen nur solche Orte mit Namen sichtbar auf der Karte sein.

## Gastronomie in Städten ausdünnen

Im Gelände und in den Bergen muss jedes Restaurant, jede Hütte und jedes Café auf der Karte stehen. In Städten und anderen dichten Bereichen ist das nicht wichtig, dort ist jedes einzelne Symbol eher Ballast. Heute führt eine Kollision nie zum Ausblenden eines Piktogramms (SPEC.md 4.4), in der Innenstadt werden die Symbole deshalb weit verdrängt und die Karte wird unruhig.

Gesucht ist eine gute Lösung, vermutlich mit einigem Aufwand. Denkbare Ansätze:

- Dichte messen, z. B. Anzahl Gastronomie-Punkte je Fläche auf dem Papier oder Lage innerhalb von Siedlungsflächen (`landuse=residential|commercial`, `place=town|city`), und nur dort ausdünnen.
- In dichten Bereichen ein Sammelsymbol oder nur die wichtigsten Betriebe zeigen, im Außenbereich weiter alle.
- Die Regel „Symbole entfallen nie“ ausdrücklich auf den Außenbereich beschränken und die Ausnahme in SPEC.md 4.4 festhalten.

## Legende

Die Karte soll eine Legende bekommen, die beim Lesen des Ausdrucks hilft:

- **Übergeordnete Routen** auf dem Blatt auflisten, jeweils mit Wegzeichen und Namen (Fernwanderwege, regionale Hauptwege; lokale Rundwege eher nicht). Das greift die zurückgestellte Routenlegende B5 (SPEC.md 4.10) wieder auf.
- **Piktogramme erklären**, möglichst nur die, die auf dem Blatt vorkommen.
- **Flächen und Signaturen erklären**, also Landnutzung (Wald, Wiese, Obstwiese, Weinberg, Fels usw.) und die Weg-Signaturen.

Zu klären: Legende im Blattrand, als eigene PDF-Seite (G5) oder in der App neben der Karte, und wie viel Platz sie auf A4 einnehmen darf.

## Namen von Restaurants, Bäckereien und Cafés überdenken

Wann die Namen von Restaurants, Bäckereien und Cafés erscheinen, sollte neu entschieden werden. Zu klären: im Außenbereich immer, in Orten gar nicht oder nur bei Platz, und ob Bäckereien und Cafés anders behandelt werden als Restaurants und Hütten.
