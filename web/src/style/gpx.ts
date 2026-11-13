// GPX track (M6): magenta line (0.7 mm) with a start marker (white disc, magenta rim) and an end
// marker (the same with a magenta dot). Source `gpx` (GeoJSON, features carry `_kind`: "line",
// "start" or "end", see src/gpx.ts). The group sits above the roads and below the names.
//
// Placement (PLAN.md 4a): the line is no obstacle (lines never are). The markers are "fixed" circle
// layers: they never move, and pictograms give way to them (placement/layers.ts). The inner dot of
// the end marker lies inside the same box and needs no role.
import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { PLACEMENT_KEY } from "../placement/layers";
import { COLORS } from "./palette";
import { GPX_LINE_MM, GPX_MARKER_DOT_MM, GPX_MARKER_MM, GPX_MARKER_RIM_MM } from "./sizes";
import { GPX_SOURCE } from "./sources";
import { lineWidth, mm } from "./units";

const FIXED = { [PLACEMENT_KEY]: "fixed" } as const;
const isKind = (k: string) => ["==", ["get", "_kind"], k] as never;

/** Marker disc: strokes sit outside the radius, so radius + rim = half the outer diameter. */
function marker(id: string, k: "start" | "end"): LayerSpecification {
  return {
    id,
    type: "circle",
    source: GPX_SOURCE,
    metadata: FIXED,
    filter: isKind(k),
    paint: {
      "circle-radius": mm(GPX_MARKER_MM / 2 - GPX_MARKER_RIM_MM),
      "circle-color": "#ffffff",
      "circle-stroke-color": COLORS.gpx,
      "circle-stroke-width": mm(GPX_MARKER_RIM_MM),
    },
  } as LayerSpecification;
}

export function gpxLayers(): LayerSpecification[] {
  return [
    {
      id: "gpx-line",
      type: "line",
      source: GPX_SOURCE,
      filter: isKind("line"),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": COLORS.gpx,
        "line-width": lineWidth(GPX_LINE_MM, 0.6, 1.4),
        "line-opacity": 0.8,
      },
    },
    marker("gpx-start", "start"),
    marker("gpx-end", "end"),
    {
      id: "gpx-end-dot",
      type: "circle",
      source: GPX_SOURCE,
      filter: isKind("end"),
      paint: { "circle-radius": mm(GPX_MARKER_DOT_MM / 2), "circle-color": COLORS.gpx },
    },
  ];
}
