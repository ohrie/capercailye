// Hiking routes (tile layer `routes`, B1). A dark-red band drawn UNDER the way signature (the
// transport group comes later), so path/track type stays readable on the band.
//
// Waymark signs belong to the routes (SPEC.md 4.4): they are not drawn from the tiles, waymarks/index.ts
// places them one by one along the routes and feeds the point source `waymark-signs`; the layer
// `waymarks-signs` below only draws those points. The network switches control band and signs alike.
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import { any } from "./expr";
import { COLORS } from "./palette";
import { iconSizeByScale } from "./sizes";
import { OSM_SOURCE, WAYMARK_SOURCE } from "./sources";
import { lineWidth, mm, PRINT_MIN_ZOOM } from "./units";

/** Long-distance and regional networks are wider and stronger than local ones (or unknown). */
export const BAND_MAJOR_MM = 1.45;
const BAND_LOCAL_MM = 1.15;
/** Opacity of the major and the local route band. */
export const BAND_MAJOR_OPACITY = 0.72;
const BAND_LOCAL_OPACITY = 0.58;

// ---------------------------------------------------------------------------------------------
// Network switches (B3)

/** Switch group per network: "Hiking routes" has four sub-switches without layers of their own. */
export const NETWORK_GROUPS = {
  iwn: "net-iwn",
  nwn: "net-nwn",
  rwn: "net-rwn",
  lwn: "net-lwn",
} as const;

type Visibility = Readonly<Record<string, boolean>>;
type Net = keyof typeof NETWORK_GROUPS;
const ALL_NETS: readonly Net[] = ["iwn", "nwn", "rwn", "lwn"];
const MAJOR_NETS: readonly Net[] = ["iwn", "nwn", "rwn"];

/** Whether the switch of a network is on (missing counts as on). */
const netOn = (visibility: Visibility, net: Net): boolean =>
  visibility[NETWORK_GROUPS[net]] !== false;

/**
 * The segment has a route of this switch class: string search in the tile attribute `nets`
 * (|-joined switch classes of the routes of the segment, e.g. `rwn|lwn`; the profile maps every
 * network other than iwn/nwn/rwn, also none, to `lwn`). The pipes around both sides make the search
 * exact. MapLibre expressions cannot split a string, hence a string search.
 */
function hasNet(net: Net): ExpressionSpecification {
  return ["in", `|${net}|`, ["concat", "|", ["coalesce", ["get", "nets"], ""], "|"]];
}

/**
 * Filter of the band for the network switches, or null when all four are on. A segment gets a band
 * exactly if at least one of its routes lies in a switched-on network (`nets`) - the same condition
 * under which at least one of its routes shows its waymark sign (waymarks/routes.ts, `routeVisible`),
 * so a sign never sits on a band that is not drawn. All four off: nothing.
 */
export function routeNetworkFilter(visibility: Visibility = {}): ExpressionSpecification | null {
  const on = ALL_NETS.filter((n) => netOn(visibility, n));
  if (on.length === ALL_NETS.length) return null;
  return on.length === 0 ? ["literal", false] : any(...on.map(hasNet));
}

/** Expressions of the band that depend on the network switches. */
export interface BandExpressions {
  /** Filter (null: no filtering). */
  filter: FilterSpecification | null;
  /** Layout `line-sort-key`: major routes on top where bands overlap. */
  sortKey: ExpressionSpecification | number;
  /** Paint `line-width` (paper mm scaled by zoom). */
  width: ExpressionSpecification;
  /** Paint `line-opacity`. */
  opacity: ExpressionSpecification | number;
}

/**
 * Filter, sort key, width and opacity of the band from the switches. Width, opacity and sorting
 * follow the HIGHEST VISIBLE network of a segment: "major" (wide, strong, on top) is a route in a
 * switched-on iwn/nwn/rwn network (`nets`). One function for the live map (`setRouteNetworks`) and
 * the style (`routeLayers`, hence the export).
 */
export function routeBandExpressions(visibility: Visibility = {}): BandExpressions {
  const majors = MAJOR_NETS.filter((n) => netOn(visibility, n));
  const filter = routeNetworkFilter(visibility) as FilterSpecification | null;
  if (majors.length === 0) {
    return {
      filter,
      sortKey: 0,
      width: lineWidth(BAND_LOCAL_MM, 0.5, 1.4),
      opacity: BAND_LOCAL_OPACITY,
    };
  }
  const major = any(...majors.map(hasNet));
  return {
    filter,
    sortKey: ["case", major, 1, 0],
    width: lineWidth(["case", major, BAND_MAJOR_MM, BAND_LOCAL_MM], 0.5, 1.4),
    opacity: ["case", major, BAND_MAJOR_OPACITY, BAND_LOCAL_OPACITY],
  };
}

/**
 * Applies the network switches to the band of a live map (the same expressions are also built into
 * the style). main.ts recomputes the waymark signs on the same switches.
 */
export function setRouteNetworks(map: MapLibreMap, visibility: Visibility): void {
  if (!map.getLayer("routes-band")) return;
  const band = routeBandExpressions(visibility);
  map.setFilter("routes-band", band.filter);
  map.setLayoutProperty("routes-band", "line-sort-key", band.sortKey);
  map.setPaintProperty("routes-band", "line-width", band.width);
  map.setPaintProperty("routes-band", "line-opacity", band.opacity);
}

export function routeLayers(visibility?: Visibility): LayerSpecification[] {
  const band = routeBandExpressions(visibility);
  return [
    {
      id: "routes-band",
      type: "line",
      source: OSM_SOURCE,
      "source-layer": "routes",
      minzoom: 11,
      ...(band.filter ? { filter: band.filter } : {}),
      layout: {
        "line-join": "round",
        "line-cap": "round",
        // Major routes on top where bands overlap.
        "line-sort-key": band.sortKey,
      },
      paint: {
        "line-color": COLORS.route,
        "line-width": band.width,
        "line-opacity": band.opacity,
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Waymarks (M3, SPEC.md 4.4, 4.5)

/**
 * Clearance around a sign (mm) that labels placed later keep (`icon-padding`). The signs never
 * overlap each other (waymarks/plan.ts guarantees that), so this is no spacing between signs.
 */
export const WAYMARK_PADDING_MM = 0.5;
/** Waymarks only from the print band on (1:50 000 is about z11.9); the overview has none. */
export const WAYMARK_MIN_ZOOM = PRINT_MIN_ZOOM;

/**
 * The placed waymark signs: one point per sign on the GeoJSON source `waymark-signs`
 * (waymarks/index.ts), one image per point (id in `img`, drawn by the "waymark" image provider,
 * src/osmc), upright, size by `iconSizeByScale` (WAYMARK_MM, smaller at 1:50 000, the same rule as
 * for pictograms and bus stops, style/sizes.ts).
 *
 * `icon-allow-overlap: true`: the signs do not overlap by construction, MapLibre must not thin
 * them. Collision (SPEC.md 4.4): the group "waymarks" is the top of the style, so MapLibre places
 * the signs before every label (`icon-ignore-placement: false`, labels avoid them and cannot
 * remove them), and in the print view the same boxes go into the pictogram placement as
 * obstacles (placement/index.ts): signs first, pictograms move off them. No placement role.
 */
export function waymarkLayers(): LayerSpecification[] {
  return [
    {
      id: "waymarks-signs",
      type: "symbol",
      source: WAYMARK_SOURCE,
      minzoom: WAYMARK_MIN_ZOOM,
      layout: {
        "symbol-placement": "point",
        "icon-image": ["get", "img"],
        "icon-size": iconSizeByScale,
        // Upright and unrotated, whatever the direction of the way.
        "icon-rotation-alignment": "viewport",
        "icon-pitch-alignment": "viewport",
        "icon-allow-overlap": true,
        "icon-ignore-placement": false,
        "icon-padding": mm(WAYMARK_PADDING_MM),
      },
    } as LayerSpecification,
  ];
}
