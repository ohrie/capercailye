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

**Grundlage:** Zerlegung und Formen sind portiert aus der Perl-Bibliothek [mueschel/OsmcToSVG](https://github.com/mueschel/OsmcToSVG) (Lizenz CC0-1.0). Im Paket und in der README darauf verweisen.
