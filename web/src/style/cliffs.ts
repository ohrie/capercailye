// Cliffs (tile layer `cliff`, C5). OSM draws cliffs with the lower side on the right of the way
// direction, so the teeth are a dashed line offset to the right (positive line-offset): every
// dash is a short tick perpendicular to the cliff edge.
import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { lineWidth } from "./units";

const EDGE_MM = 0.3;
const TICK_LENGTH_MM = 0.55; // perpendicular extent = line width of the tick layer
const TICK_THICK_MM = 0.14; // along the edge = dash length
const TICK_PITCH_MM = 0.55;

export function cliffLayers(): LayerSpecification[] {
  return [
    {
      id: "cliffs-teeth",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "cliff",
      minzoom: 12,
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": COLORS.cliff,
        "line-width": lineWidth(TICK_LENGTH_MM),
        "line-offset": lineWidth((EDGE_MM + TICK_LENGTH_MM) / 2),
        "line-dasharray": [
          TICK_THICK_MM / TICK_LENGTH_MM,
          (TICK_PITCH_MM - TICK_THICK_MM) / TICK_LENGTH_MM,
        ],
      },
    },
    {
      id: "cliffs-edge",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "cliff",
      minzoom: 11,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": COLORS.cliff, "line-width": lineWidth(EDGE_MM) },
    },
  ];
}
