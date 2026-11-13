// Hiking routes (tile layer `routes`, B1). A dark-red band drawn UNDER the way signature (the
// transport group comes later), so path/track type stays readable on the band.
import type { ExpressionSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { waymarkImageExpression } from "../osmc";
import { PLACEMENT_KEY } from "../placement/layers";
import { any, attrIn } from "./expr";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { lineWidth, mm, PRINT_MIN_ZOOM } from "./units";

/** Long-distance and regional networks are wider and stronger than local ones (or unknown). */
const major = attrIn("network", "iwn", "nwn", "rwn");
const BAND_MAJOR_MM = 1.45;
const BAND_LOCAL_MM = 1.15;

export function routeLayers(): LayerSpecification[] {
  return [
    {
      id: "routes-band",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "routes",
      minzoom: 11,
      layout: {
        "line-join": "round",
        "line-cap": "round",
        // Major routes on top where bands overlap.
        "line-sort-key": ["case", major, 1, 0],
      },
      paint: {
        "line-color": COLORS.route,
        "line-width": lineWidth(["case", major, BAND_MAJOR_MM, BAND_LOCAL_MM], 0.5, 1.4),
        "line-opacity": ["case", major, 0.72, 0.58],
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Waymarks (M3, PLAN.md 3 and 4a)

/** Distance between two waymarks of the same line on paper in mm ("about every 6 cm"). */
export const WAYMARK_SPACING_MM = 60;
/**
 * Clearance around a waymark (mm): two waymarks keep twice this distance (they thin each other
 * out, see waymarkLayers), labels placed later keep this distance.
 */
export const WAYMARK_PADDING_MM = 2.5;
/**
 * Below this zoom (scales smaller than about 1:35 000, i.e. 1:50 000) waymarks are drawn at
 * WAYMARK_SMALL_SIZE of their size (4.8 mm -> 3.8 mm plate): the sheet holds four times the area,
 * but every route keeps its sign (no thinning by network).
 */
export const WAYMARK_SMALL_ZOOM = 12.4;
export const WAYMARK_SMALL_SIZE = 0.8;
/** Waymarks only from the print band on (1:50 000 is about z11.9); the overview has none. */
export const WAYMARK_MIN_ZOOM = PRINT_MIN_ZOOM;

/** Tile route lists with only empty slots ("", "|", "||", "|||": at most 4 routes per segment). */
const EMPTY_LISTS = ["", "|", "||", "|||"];
const listFilled = (name: string): ExpressionSpecification => [
  "!",
  ["in", ["coalesce", ["get", name], ""], ["literal", EMPTY_LISTS]],
];

/**
 * True for segments where at least one route has something to show (osmc:symbol, ref or name;
 * `colour` alone is no sign). Segments without any are not requested at all, so the image
 * provider is never asked for an id it cannot draw (MapLibre would warn about a missing image).
 */
export const hasWaymark: ExpressionSpecification = any(
  listFilled("symbols"),
  listFilled("refs"),
  listFilled("names"),
);

/**
 * Waymark signs along the `routes` lines: one combined image per segment (all routes side by
 * side, src/osmc), upright, every WAYMARK_SPACING_MM on paper.
 *
 * Collision (PLAN.md 4a): group "waymarks" is the top of the style (index.ts) and the print
 * placement inserts its pictogram clones below it (placement/layers.ts), so MapLibre places the
 * waymarks before every other symbol. When a waymark is placed, the collision index therefore
 * holds nothing but other waymarks: `icon-allow-overlap: false` cannot let any label or
 * pictogram remove a waymark, it only thins out waymarks that would touch each other. That is
 * wanted: a segment longer than its image gets an anchor near its start (MapLibre line placement),
 * so the many short segments at junctions would otherwise pile signs up within millimetres; with
 * WAYMARK_PADDING_MM two waymarks keep at least 5 mm apart, and the sort key lets the image with
 * more routes (and the major network) win, which shows the dropped neighbour's signs anyway.
 * `icon-ignore-placement: false`: every label placed later avoids them.
 *
 * Role "obstacle": the print placement reads the placed waymark boxes from MapLibre after its
 * placement and moves pictograms off them (placement/rendered.ts).
 */
export function waymarkLayers(): LayerSpecification[] {
  return [
    {
      id: "waymarks-line",
      type: "symbol",
      metadata: { [PLACEMENT_KEY]: "obstacle" },
      source: OSM_SOURCE,
      "source-layer": "routes",
      minzoom: WAYMARK_MIN_ZOOM,
      filter: hasWaymark,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": mm(WAYMARK_SPACING_MM),
        "icon-image": waymarkImageExpression(),
        "icon-size": ["step", ["zoom"], WAYMARK_SMALL_SIZE, WAYMARK_SMALL_ZOOM, 1],
        // Upright and unrotated, whatever the direction of the way.
        "icon-rotation-alignment": "viewport",
        "icon-pitch-alignment": "viewport",
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "icon-padding": mm(WAYMARK_PADDING_MM),
        // Lower = placed first: major networks, then more routes.
        "symbol-sort-key": [
          "-",
          0,
          ["+", ["coalesce", ["get", "count"], 0], ["case", major, 10, 0]],
        ],
      },
    } as LayerSpecification,
  ];
}
