// Text labels, split into two groups around the POI pictograms so that MapLibre's placement
// priority (layers higher in the style are placed first) gives:
//   settlements > peaks > [poi group: guidepost names, pictograms] > water names > Flurnamen
//   > road refs > road names.
// `labelLayers` (group "labels") sits above the POI group, `nameLayers` (group "names") below it.
// Both follow the "Labels" toggle (index.ts).
import type { ExpressionSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { all, kindIn, matchAttr } from "./expr";
import { FONT_ITALIC, FONT_MEDIUM, FONT_REGULAR, halo } from "./fonts";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { NAMED_ROAD_KINDS, NAMED_STREET_KINDS } from "./transport";
import { mm, pt } from "./units";

export { FONT_ITALIC, FONT_MEDIUM, FONT_REGULAR } from "./fonts";

/** Larger population first within a layer. */
const byPopulation: ExpressionSpecification = ["-", 0, ["coalesce", ["get", "population"], 0]];

function symbol(
  group: "labels" | "names",
  name: string,
  sourceLayer: string,
  filter: ExpressionSpecification,
  layout: Record<string, unknown>,
  paint: Record<string, unknown>,
  minzoom?: number,
): LayerSpecification {
  return {
    id: `${group}-${name}`,
    type: "symbol",
    source: OSM_SOURCE,
    "source-layer": sourceLayer,
    filter,
    ...(minzoom !== undefined ? { minzoom } : {}),
    layout,
    paint,
  } as LayerSpecification;
}

// ---------------------------------------------------------------------------------------------
// Group "labels": settlements and peaks (highest priority, top of the style)

/**
 * Layer metadata for the print placement (src/placement): drawn as is and never displaced;
 * pictograms are placed after these and move off them. Peak dots and settlement names.
 */
const PLACEMENT_FIXED = { "capercailye:placement": "fixed" } as const;

const fixed = (layer: LayerSpecification): LayerSpecification => ({
  ...layer,
  metadata: PLACEMENT_FIXED,
});

export function labelLayers(): LayerSpecification[] {
  return [
    {
      id: "labels-peak-dot",
      type: "circle",
      source: OSM_SOURCE,
      "source-layer": "peak",
      filter: kindIn("peak"),
      minzoom: 11,
      // Never moves; the print placement keeps pictograms off the dot (src/placement).
      metadata: PLACEMENT_FIXED,
      paint: {
        "circle-color": COLORS.peak,
        "circle-radius": mm(0.45),
        "circle-stroke-color": COLORS.paper,
        "circle-stroke-width": mm(0.1),
      },
    },
    symbol(
      "labels",
      "peak",
      "peak",
      ["any", ["has", "name"], ["has", "ele"]],
      {
        "text-field": [
          "format",
          ["coalesce", ["get", "name"], ""],
          {},
          ["case", ["all", ["has", "name"], ["has", "ele"]], "\n", ""],
          {},
          ["case", ["has", "ele"], ["to-string", ["round", ["get", "ele"]]], ""],
          { "text-font": ["literal", FONT_REGULAR], "font-scale": 6.5 / 7 },
        ],
        "text-font": FONT_MEDIUM,
        "text-size": pt(7),
        // Below the dot first; above, right or left when that spot is taken (SPEC.md 4.4).
        "text-variable-anchor-offset": [
          "top",
          [0, 0.35],
          "bottom",
          [0, -0.35],
          "left",
          [0.55, 0],
          "right",
          [-0.55, 0],
        ],
        "text-line-height": 1.1,
        "text-max-width": 8,
        // Higher summits win.
        "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]],
      },
      { "text-color": COLORS.peak, ...halo(0.3) },
      11,
    ),
    fixed(
      symbol(
        "labels",
        "place-hamlet",
        "place",
        kindIn("hamlet", "isolated_dwelling", "farm"),
        {
          "text-field": ["get", "name"],
          "text-font": FONT_REGULAR,
          "text-size": matchAttr("kind", [["hamlet", pt(7.5)]], pt(6.5)),
          "text-max-width": 7,
          "symbol-sort-key": matchAttr("kind", [["hamlet", 0]], 1),
        },
        { "text-color": COLORS.textPlace, ...halo(0.3) },
      ),
    ),
    fixed(
      symbol(
        "labels",
        "place-village",
        "place",
        kindIn("village"),
        {
          "text-field": ["get", "name"],
          "text-font": FONT_MEDIUM,
          "text-size": pt(8.5),
          "text-max-width": 8,
          "symbol-sort-key": byPopulation,
        },
        { "text-color": COLORS.textPlace, ...halo(0.35) },
      ),
    ),
    fixed(
      symbol(
        "labels",
        "place-town",
        "place",
        kindIn("city", "town"),
        {
          "text-field": ["get", "name"],
          "text-font": FONT_MEDIUM,
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            matchAttr("kind", [["city", pt(10)]], pt(8.5)),
            11.5,
            matchAttr("kind", [["city", pt(13)]], pt(11)),
          ],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-max-width": 10,
          "symbol-sort-key": byPopulation,
        },
        { "text-color": COLORS.textPlace, ...halo(0.4) },
      ),
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Group "names": roads, Flurnamen, water (below the POI group)

const waterwayNamed = all(["has", "name"], kindIn("river", "canal", "stream", "ditch", "drain"));
const refRoads = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified"];
const refInitial: ExpressionSpecification = ["slice", ["get", "ref"], 0, 1];

export function nameLayers(): LayerSpecification[] {
  return [
    // Street names: larger roads at print zooms, minor streets only when zoomed in on screen.
    symbol(
      "names",
      "road",
      "transport",
      all(
        ["has", "name"],
        ["!", ["==", ["get", "rail"], true]],
        [
          "any",
          kindIn(...NAMED_ROAD_KINDS),
          ["all", kindIn(...NAMED_STREET_KINDS), [">=", ["zoom"], 14.5]],
        ],
      ),
      {
        "symbol-placement": "line",
        "symbol-spacing": mm(120),
        "text-field": ["get", "name"],
        "text-font": FONT_REGULAR,
        "text-size": pt(6.5),
        "text-max-angle": 30,
      },
      { "text-color": COLORS.textRoad, ...halo(0.3) },
      12.5,
    ),
    // Road numbers (L415, K8206, B32, A81) as horizontal mini shields: the halo is the plate.
    // A = blue plate / white text, B = yellow plate, others white plate.
    symbol(
      "names",
      "road-ref",
      "transport",
      all(["has", "ref"], ["!", ["==", ["get", "rail"], true]], kindIn(...refRoads)),
      {
        "symbol-placement": "line",
        "symbol-spacing": mm(90),
        "text-field": ["get", "ref"],
        "text-font": FONT_MEDIUM,
        "text-size": pt(6.5),
        "text-rotation-alignment": "viewport",
        "text-padding": mm(1),
        "symbol-sort-key": matchAttr(
          "kind",
          [
            ["motorway", 0],
            ["trunk", 1],
            ["primary", 2],
            ["secondary", 3],
            ["tertiary", 4],
          ],
          5,
        ),
      },
      {
        "text-color": ["match", refInitial, "A", "#ffffff", COLORS.text],
        "text-halo-color": [
          "match",
          refInitial,
          "A",
          COLORS.refMotorway,
          "B",
          COLORS.refFederal,
          "#ffffff",
        ],
        "text-halo-width": mm(0.45),
        "text-halo-blur": 0,
      },
      10,
    ),
    // Flurnamen / Gewannnamen: italic grey-brown, spaced.
    symbol(
      "names",
      "locality",
      "place",
      all(kindIn("locality"), ["has", "name"]),
      {
        "text-field": ["get", "name"],
        "text-font": FONT_ITALIC,
        "text-size": pt(6.5),
        "text-letter-spacing": 0.1,
        "text-max-width": 6,
      },
      { "text-color": COLORS.textLocality, ...halo(0.25) },
      12,
    ),
    symbol(
      "names",
      "water-area",
      "water",
      ["has", "name"],
      {
        "text-field": ["get", "name"],
        "text-font": FONT_ITALIC,
        "text-size": pt(7),
        "text-letter-spacing": 0.05,
        "text-max-width": 6,
      },
      { "text-color": COLORS.waterText, ...halo(0.25) },
      12,
    ),
    symbol(
      "names",
      "waterway",
      "waterway",
      waterwayNamed,
      {
        "symbol-placement": "line",
        "symbol-spacing": mm(80),
        "text-field": ["get", "name"],
        "text-font": FONT_ITALIC,
        "text-size": matchAttr(
          "kind",
          [
            ["river", pt(8)],
            ["canal", pt(7)],
          ],
          pt(6.5),
        ),
        "text-letter-spacing": 0.12,
        "text-max-angle": 30,
        "symbol-sort-key": matchAttr(
          "kind",
          [
            ["river", 0],
            ["canal", 1],
          ],
          2,
        ),
      },
      { "text-color": COLORS.waterText, ...halo(0.25) },
      11,
    ),
  ];
}
