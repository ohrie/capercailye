# Piktogramme (src/icons)

Laufzeit-Icons für MapLibre: jedes Bild `"<präfix>:<name>"` wird aus SVG erzeugt, mit 4-facher
Überabtastung gerastert und mit `pixelRatio: 4` per `map.addImage` eingetragen. Kein Sprite, weil
der Export mit `pixelRatio` bis 3,125 rendert (SPEC.md 2, 4.3).

- `registry.ts` – Definitionen je POI-Art (`kind` aus `tiles/SCHEMA.md`), reine Funktion
  `iconSvg(def)` → `{ svg, width, height }` (Größen in Papier-mm, `style/units.ts`).
- `runtime.ts` – `registerImageProvider(präfix, name → SVG)`, `installIcons(map)` (setzt
  `map.setMissingStyleImageResolver`; MapLibre wartet im Worker auf das Promise, deshalb hat die
  Exportkarte nach `idle` alle Icons), `preloadImages(ids)`.
- `index.ts` – registriert das Präfix `poi`. Für M3: `registerImageProvider("osmc", …)`.
- `glyphs-cc0.ts` – Pfaddaten aus CC0-Icon-Sets (siehe unten), unverändert übernommen.

## Herkunft der Glyphen

| Quelle                                                                         | Lizenz  | verwendet für                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Maki](https://github.com/mapbox/maki) 8.2.0 (`@mapbox/maki`)                  | CC0-1.0 | observation-tower, home, shelter, viewpoint, castle, waterfall, campsite, lodging, restaurant, cafe, drinking-water, parking, monument, picnic-site, toilet, place-of-worship, rail |
| [Temaki](https://github.com/rapideditor/temaki) 5.13.0 (`@rapideditor/temaki`) | CC0-1.0 | sleep_shelter, ruins, bunk_beds, campfire, camper_trailer, fountain, milestone, tower_communication, tower, boulder1, boulder2, mast, wind_turbine                                  |
| eigene Zeichnung (dieses Projekt, MIT)                                         | MIT     | Höhle, Kirche, Kapelle, Wegkreuz, Bildstock, Quelle, Doline, Wehr, Bushaltestelle („H“), Wegweiser-Fähnchen, Riss der Burgruine                                                     |

Nur die `d`-Pfaddaten sind kopiert (keine Paketabhängigkeit). Neue CC0-Glyphen: Pfad aus der SVG
in `glyphs-cc0.ts` ergänzen und hier eintragen. Keine GPL- oder CC-BY-SA-Quellen.

## Dichte-Regeln (style/poi.ts)

Größen: `style/sizes.ts`, Rangfolge: `style/hierarchy.ts`.

- Parkplätze nur mit `hiking`, Name mit „Wanderparkplatz“ oder `area_m2` ≥ 2500; nie mit
  `access` = private/no/customers/permit/residents/delivery/agricultural/forestry/destination.
- Benannte Wegweiser: gelbes Fähnchen (Rang 51, Wanderinfrastruktur); der Name nur mit dem
  Schalter „Wegweisernamen“ (Standard aus). Unbenannte: kleines Fähnchen ohne Namen in `guideposts-minor`, weicht als Erstes.
  Benannte und unbenannte Wegweiser gehören zur Kategorie „Wegweiser“ (eigener Schalter, M6).
- Bushaltestellen kommen nicht mehr aus OSM, sondern aus GTFS (eigene Quelle, Gruppe `busstops`,
  Layer `busstops-main`): grüne Scheibe mit gelbem Rand und weißem „H“ (allgemeines
  Haltestellenzeichen), 3,0 mm, Rang 12 (`BUSSTOP_PRIORITY`, `style/hierarchy.ts`), Name optional.
- Aussichtspunkte (`viewpoint`) in eigener Ebene `viewpoints-main`, nur benannte, Standard an (Schalter
  „Aussichtspunkte“); Aussichtstürme bleiben immer sichtbar.
- Die kleinen Symbole (`poi-minor` und die `<kategorie>-minor`-Ebenen: Wegkreuze, Bildstöcke,
  Gedenksteine, Brunnen, Türme, Masten, Windräder, Felsen, Dolinen, Wehre, unbenannte Wegweiser)
  erst ab z12,5, also nur bei 1:25 000. Die Kategorien mit eigenem Schalter stehen in
  `POI_CATEGORIES` (`style/poi.ts`).
