// Hiking routes (tile layer `routes`, B1). A dark-red band drawn UNDER the way signature (the
// transport group comes later), so path/track type stays readable on the band.
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import { waymarkImageExpression } from "../osmc";
import { PLACEMENT_KEY } from "../placement/layers";
import { all, any, attrIn } from "./expr";
import { COLORS } from "./palette";
import { iconSizeByScale, WAYMARK_MM } from "./sizes";
import { OSM_SOURCE } from "./sources";
import { lineWidth, mm, PRINT_MIN_ZOOM } from "./units";

/** Long-distance and regional networks are wider and stronger than local ones (or unknown). */
const major = attrIn("network", "iwn", "nwn", "rwn");
export const BAND_MAJOR_MM = 1.45;
const BAND_LOCAL_MM = 1.15;
/** Opacity of the major and the local route band. */
export const BAND_MAJOR_OPACITY = 0.72;
const BAND_LOCAL_OPACITY = 0.58;

// ---------------------------------------------------------------------------------------------
// Network switches (B3)

/** Switch group per network: "Wanderrouten" has four sub-switches without layers of their own. */
export const NETWORK_GROUPS = {
  iwn: "net-iwn",
  nwn: "net-nwn",
  rwn: "net-rwn",
  lwn: "net-lwn",
} as const;

/**
 * Filter that hides the networks switched off, or null when all four are on. The tile attribute
 * `network` is only the HIGHEST network of a segment (tiles/SCHEMA.md; missing if none of the four),
 * so this filters by the best network: a segment with a regional and a local route disappears with
 * "Regional" off and "Lokal" on, and a visible segment keeps the waymarks of all its routes.
 * "Lokal" also covers segments without `network`.
 */
export function routeNetworkFilter(
  visibility: Readonly<Record<string, boolean>> = {},
): ExpressionSpecification | null {
  const on = (net: keyof typeof NETWORK_GROUPS) => visibility[NETWORK_GROUPS[net]] ?? true;
  const high = (["iwn", "nwn", "rwn"] as const).filter(on);
  const hidden = (["iwn", "nwn", "rwn"] as const).filter((n) => !on(n));
  if (on("lwn")) {
    return hidden.length === 0 ? null : ["!", attrIn("network", ...hidden)];
  }
  return high.length === 0 ? ["literal", false] : attrIn("network", ...high);
}

/** Filter of routes-band: only the network switches. */
function bandFilter(visibility?: Readonly<Record<string, boolean>>): FilterSpecification | null {
  return routeNetworkFilter(visibility) as FilterSpecification | null;
}

/** Filter of waymarks-line: a sign to show, and the network switches. */
function waymarkFilter(visibility?: Readonly<Record<string, boolean>>): FilterSpecification {
  const net = routeNetworkFilter(visibility);
  return (net ? all(hasWaymark, net) : hasWaymark) as FilterSpecification;
}

/**
 * Applies the network switches to a live map (the filters are also built into the style, so the
 * export map agrees). Waymarks are placed by MapLibre ("obstacle"), the print placement reads
 * their placed boxes, so setFilter reaches it (the caller re-syncs the placement).
 */
export function setRouteNetworks(
  map: MapLibreMap,
  visibility: Readonly<Record<string, boolean>>,
): void {
  if (map.getLayer("routes-band")) map.setFilter("routes-band", bandFilter(visibility));
  if (map.getLayer("waymarks-line")) map.setFilter("waymarks-line", waymarkFilter(visibility));
}

export function routeLayers(visibility?: Readonly<Record<string, boolean>>): LayerSpecification[] {
  const filter = bandFilter(visibility);
  return [
    {
      id: "routes-band",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "routes",
      minzoom: 11,
      ...(filter ? { filter } : {}),
      layout: {
        "line-join": "round",
        "line-cap": "round",
        // Major routes on top where bands overlap.
        "line-sort-key": ["case", major, 1, 0],
      },
      paint: {
        "line-color": COLORS.route,
        "line-width": lineWidth(["case", major, BAND_MAJOR_MM, BAND_LOCAL_MM], 0.5, 1.4),
        "line-opacity": ["case", major, BAND_MAJOR_OPACITY, BAND_LOCAL_OPACITY],
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
 * out, see waymarkLayers), labels placed later keep this distance. Proportional to the sign
 * height (2.5 mm at 4.8 mm), see style/sizes.ts.
 */
export const WAYMARK_PADDING_MM = Math.round(((2.5 * WAYMARK_MM) / 4.8) * 10) / 10;
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
 * Size: WAYMARK_MM, at SMALL_SCALE_FACTOR below z12.4 (about 1:50 000), the same rule as for
 * pictograms and bus stops (style/sizes.ts); every route keeps its sign (no thinning by network).
 *
 * Role "obstacle": the print placement reads the placed waymark boxes from MapLibre after its
 * placement and moves pictograms off them (placement/rendered.ts).
 */
export function waymarkLayers(
  visibility?: Readonly<Record<string, boolean>>,
): LayerSpecification[] {
  return [
    {
      id: "waymarks-line",
      type: "symbol",
      metadata: { [PLACEMENT_KEY]: "obstacle" },
      source: OSM_SOURCE,
      "source-layer": "routes",
      minzoom: WAYMARK_MIN_ZOOM,
      filter: waymarkFilter(visibility),
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": mm(WAYMARK_SPACING_MM),
        "icon-image": waymarkImageExpression(),
        "icon-size": iconSizeByScale,
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
