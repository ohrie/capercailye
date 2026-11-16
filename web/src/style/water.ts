// Water areas (`water`) and waterways (`waterway`): D1, D2, D5 (weir lines).
import type { ExpressionSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { all, flag, kindIn, matchAttr, not } from "./expr";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { dashes, lineWidth } from "./units";

/** Outline width of water areas in paper mm (also the legend swatch). */
export const WATER_OUTLINE_MM = 0.15;

/** Waterway widths in paper mm by importance. */
const WIDTH: [string, number][] = [
  ["river", 0.75],
  ["canal", 0.6],
  ["stream", 0.3],
  ["ditch", 0.2],
  ["drain", 0.2],
];
const LINE_KINDS = WIDTH.map(([k]) => k);
const waterwayWidth = matchAttr("kind", WIDTH, 0.2);

const intermittent = flag("intermittent");
const tunnel = flag("tunnel");

function waterwayLine(
  id: string,
  filter: ExpressionSpecification,
  dash?: number[],
  opacity = 1,
): LayerSpecification {
  return {
    id,
    type: "line",
    source: OSM_SOURCE,
    "source-layer": "waterway",
    filter,
    layout: { "line-cap": dash ? "butt" : "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.waterway,
      "line-width": lineWidth(waterwayWidth, 0.4, 1.8),
      "line-opacity": opacity,
      ...(dash ? { "line-dasharray": dash } : {}),
    },
  };
}

export function waterLayers(): LayerSpecification[] {
  return [
    {
      id: "water-area",
      type: "fill",
      source: OSM_SOURCE,
      "source-layer": "water",
      paint: {
        "fill-color": ["case", intermittent, COLORS.waterIntermittent, COLORS.water],
      },
    },
    {
      id: "water-area-outline",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "water",
      filter: not(intermittent),
      minzoom: 10,
      paint: {
        "line-color": COLORS.waterOutline,
        "line-width": lineWidth(WATER_OUTLINE_MM, 0.5, 1.3),
      },
    },
    {
      id: "water-area-outline-intermittent",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "water",
      filter: intermittent,
      minzoom: 12,
      paint: {
        "line-color": COLORS.waterOutline,
        "line-width": lineWidth(WATER_OUTLINE_MM, 0.5, 1.3),
        "line-dasharray": dashes(0.15, 1.0, 0.5),
      },
    },
    // Culverts and underground sections: faded, dashed.
    waterwayLine(
      "water-line-tunnel",
      all(kindIn(...LINE_KINDS), tunnel),
      dashes(0.3, 0.8, 0.6),
      0.45,
    ),
    waterwayLine("water-line", all(kindIn(...LINE_KINDS), not(tunnel), not(intermittent))),
    waterwayLine(
      "water-line-intermittent",
      all(kindIn(...LINE_KINDS), not(tunnel), intermittent),
      dashes(0.3, 1.5, 0.6),
    ),
    {
      id: "water-weir",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "waterway",
      filter: kindIn("weir"),
      minzoom: 12,
      layout: { "line-cap": "butt" },
      paint: { "line-color": COLORS.weir, "line-width": lineWidth(0.45) },
    },
  ];
}
