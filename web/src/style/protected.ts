// Protected areas (tile layer `protected_area`, C11): no fill, only a semi-transparent green band
// on the inside of the boundary (positive line-offset insets polygon outlines), plus subtle names.
import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { all, kindIn, matchAttr } from "./expr";
import { FONT_ITALIC, halo } from "./fonts";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { lineWidth, mm, pt } from "./units";

/** Band width in paper mm by kind; national park strongest, other (LSG, Naturpark, …) faint. */
const BAND: [string, number, string][] = [
  ["national_park", 1.6, COLORS.protectedNational],
  ["nature_reserve", 1.1, COLORS.protectedReserve],
  ["protected_area", 0.7, COLORS.protectedOther],
];

const bandWidth = matchAttr(
  "kind",
  BAND.map(([k, w]) => [k, w]),
  0.7,
);

export function protectedLayers(): LayerSpecification[] {
  return [
    {
      id: "protected-band",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "protected_area",
      minzoom: 8,
      layout: { "line-join": "round" },
      paint: {
        "line-color": matchAttr(
          "kind",
          BAND.map(([k, , c]) => [k, c]),
          COLORS.protectedOther,
        ),
        "line-width": lineWidth(bandWidth, 0.5, 1.3),
        // Inset by half the width so the band lies entirely inside the area.
        "line-offset": lineWidth(["/", bandWidth, 2], 0.5, 1.3),
      },
    },
    {
      id: "protected-name",
      type: "symbol",
      source: OSM_SOURCE,
      "source-layer": "protected_area",
      filter: all(["has", "name"], kindIn("national_park", "nature_reserve")),
      minzoom: 12,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": mm(140),
        "text-field": ["get", "name"],
        "text-font": FONT_ITALIC,
        "text-size": pt(6.5),
        "text-letter-spacing": 0.06,
        "text-max-angle": 30,
        "symbol-sort-key": 50,
      },
      paint: { "text-color": COLORS.protectedText, ...halo(0.25) },
    },
  ];
}
