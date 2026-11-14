// Buildings (tile layer `building`, E1): salmon / red-brown fill with a thin darker outline.
// Buildings inside industrial/commercial areas (tile attribute `industrial=true`) are grey.
import type { ExpressionSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { flag } from "./expr";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { lineWidth } from "./units";

/** Outline width in paper mm (also the legend symbol). */
export const BUILDING_OUTLINE_MM = 0.08;

const industrial = flag("industrial");

function byIndustrial(normal: string, grey: string): ExpressionSpecification {
  return ["case", industrial, grey, normal];
}

export function buildingLayers(): LayerSpecification[] {
  return [
    {
      id: "buildings-fill",
      type: "fill",
      source: OSM_SOURCE,
      "source-layer": "building",
      minzoom: 12,
      paint: {
        "fill-color": byIndustrial(COLORS.building, COLORS.buildingIndustrial),
        "fill-antialias": true,
      },
    },
    {
      id: "buildings-outline",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "building",
      minzoom: 12,
      layout: { "line-join": "miter" },
      paint: {
        "line-color": byIndustrial(COLORS.buildingOutline, COLORS.buildingIndustrialOutline),
        "line-width": lineWidth(BUILDING_OUTLINE_MM, 0.5, 1.5),
      },
    },
  ];
}
