// Background and landcover fills (tile layer `landcover`). Pure tints, no patterns: they print
// reliably and keep the way network on top readable.
import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { kindIn, matchAttr } from "./expr";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { lineWidth } from "./units";

/** Outline widths in paper mm (also the legend swatches). */
export const FOREST_EDGE_MM = 0.12;
export const QUARRY_EDGE_MM = 0.15;

const SETTLEMENT = ["residential", "commercial", "industrial"];

/** Wetland tint by raw `wetland` subtype: open wet grassland greener, wooded mires bluer. */
const wetlandColor = matchAttr(
  "wetland",
  [
    [["marsh", "reedbed", "wet_meadow", "saltmarsh"], COLORS.wetlandOpen],
    [["bog", "swamp", "fen", "string_bog", "palsa_bog"], COLORS.wetlandWooded],
  ],
  COLORS.wetland,
);

const fillColor = matchAttr(
  "kind",
  [
    ["forest", COLORS.forest],
    ["meadow", COLORS.meadow],
    ["farmland", COLORS.farmland],
    ["orchard", COLORS.orchard],
    ["vineyard", COLORS.vineyard],
    ["heath", COLORS.heath],
    ["scrub", COLORS.scrub],
    ["wetland", wetlandColor],
    ["bare_rock", COLORS.bareRock],
    ["scree", COLORS.scree],
    ["quarry", COLORS.quarry],
    ["residential", COLORS.residential],
    ["commercial", COLORS.commercial],
    ["industrial", COLORS.industrial],
  ],
  "rgba(0, 0, 0, 0)",
);

/**
 * Draw order inside the layer: settlement areas first, then open land, then forest, then small
 * natural areas that are often mapped inside forest or meadow (wetland, scrub, rock).
 */
const fillOrder = matchAttr(
  "kind",
  [
    [SETTLEMENT, 0],
    [["farmland", "meadow", "orchard", "vineyard", "heath"], 1],
    ["forest", 2],
    [["scrub", "wetland"], 3],
    [["bare_rock", "scree", "quarry"], 4],
  ],
  1,
);

export function backgroundLayers(): LayerSpecification[] {
  return [
    { id: "base-background", type: "background", paint: { "background-color": COLORS.paper } },
  ];
}

export function landcoverLayers(): LayerSpecification[] {
  return [
    {
      id: "landcover-fill",
      type: "fill",
      source: OSM_SOURCE,
      "source-layer": "landcover",
      layout: { "fill-sort-key": fillOrder },
      paint: {
        "fill-color": fillColor,
        // No antialiasing: avoids hairline seams between adjacent polygons; edges are crisp
        // enough at print pixel ratios.
        "fill-antialias": false,
      },
    },
    {
      id: "landcover-forest-edge",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "landcover",
      filter: kindIn("forest"),
      minzoom: 11,
      paint: { "line-color": COLORS.forestEdge, "line-width": lineWidth(FOREST_EDGE_MM, 0.5, 1.3) },
    },
    {
      id: "landcover-quarry-edge",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "landcover",
      filter: kindIn("quarry"),
      minzoom: 12,
      paint: { "line-color": COLORS.quarryLine, "line-width": lineWidth(QUARRY_EDGE_MM, 0.5, 1.3) },
    },
  ];
}
