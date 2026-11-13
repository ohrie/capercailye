// POI pictogram layers (tile layer `poi`, tiles/SCHEMA.md). Layer ids must start with "poi-".
//
// Images are "poi:<name>" ids rasterised at runtime from SVG (src/icons). Two layers:
//   poi-main   boxed pictograms, churches and named guideposts, optional names; placed first.
//   poi-minor  small plain symbols without names (crosses, masts, unnamed guideposts …),
//              only at 1:25 000 (z >= 12.5); fills the gaps the main layer leaves.
// On screen MapLibre's collision decides: icons never overlap, names are optional
// (text-optional), and `symbol-sort-key` (PRIORITY below, named before unnamed) sets the order.
// In print view and in the PDF both layers are taken over by the print placement
// (metadata PLACEMENT_DISPLACE, src/placement): every icon is drawn, overlapping icons are
// displaced by priority (same sort key), and only names may drop out.
//
// Density rules (per A4 sheet at 1:25 000 in BW: parking 67, guideposts 50 …):
//   parking      only with hiking=yes, a name containing "Wanderparkplatz", or area_m2 >= 2500
//                (≈ 80–100 cars); never access=private/no/customers/permit/… (no name label).
//   guidepost    named: yellow flag + name, priority just below huts/views/castles.
//                unnamed: small flag in poi-minor, lowest priority (drops out first).
//   bus stops    no longer from OSM: GTFS stops (>= 4 departures per weekend day) come from their own
//                PMTiles file as group "busstops" (busstopLayers below); railway stations/halts stay here.
//   restaurant/cafe  icon + name, priority below huts, shelters, views and guideposts.
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { flagGeometry, POI_ICONS, type PoiKind } from "../icons/registry";
import { BUSSTOPS_SOURCE, OSM_SOURCE } from "./sources";
import { mm, pt } from "./units";

/** Layer metadata: icons of this layer are never dropped at print scale (src/placement). */
export const PLACEMENT_DISPLACE = { "capercailye:placement": "displace" } as const;

const FONT = ["Noto Sans Regular"];
const TEXT_COLOR = "#1a1a1a";
const HALO_COLOR = "rgba(255,255,255,0.9)";

/** Kinds whose name is printed. */
export const NAMED_KINDS: PoiKind[] = [
  "railway_station",
  "railway_halt",
  "viewtower",
  "alpine_hut",
  "wilderness_hut",
  "shelter",
  "castle",
  "castle_ruins",
  "ruins",
  "viewpoint",
  "cave_entrance",
  "waterfall",
  "spring",
  "camp_site",
  "hostel",
  "restaurant",
  "cafe",
  "guidepost",
];

/** Small plain symbols without names, drawn only at 1:25 000. */
export const MINOR_KINDS: PoiKind[] = [
  "wayside_cross",
  "wayside_shrine",
  "memorial",
  "fountain",
  "tower",
  "communication_tower",
  "mast",
  "wind_turbine",
  "rock",
  "stone",
  "sinkhole",
  "weir",
];

/** Placement priority (lower first). Kinds not listed use the tile `rank`. */
export const PRIORITY: Partial<Record<PoiKind, number>> = {
  railway_station: 10,
  viewtower: 10,
  alpine_hut: 10,
  castle: 10,
  castle_ruins: 10,
  viewpoint: 14,
  wilderness_hut: 15,
  shelter: 16,
  cave_entrance: 17,
  waterfall: 17,
  ruins: 18,
  railway_halt: 19,
  church: 20,
  chapel: 22,
  camp_site: 23,
  guidepost: 25,
  spring: 26,
  drinking_water: 27,
  parking: 28,
  monument: 30,
  restaurant: 32,
  cafe: 33,
  hostel: 34,
  picnic_site: 36,
  place_of_worship: 36,
  caravan_site: 40,
  hotel: 42,
  bbq: 44,
  toilets: 46,
  tower: 48,
  communication_tower: 49,
  wind_turbine: 49,
  wayside_cross: 50,
  wayside_shrine: 50,
  memorial: 52,
  fountain: 52,
  rock: 54,
  stone: 54,
  sinkhole: 54,
  weir: 55,
  mast: 58,
};

/**
 * Placement priority of GTFS bus stops: just below railway halts (19) and churches (20), above
 * chapels and guideposts. A stop with >= 4 weekend departures is worth a place on the sheet.
 */
export const BUSSTOP_PRIORITY = 21;

/** Access values that exclude a car park (the tiles already drop private/no). */
export const PARKING_EXCLUDED_ACCESS = [
  "private",
  "no",
  "customers",
  "permit",
  "residents",
  "delivery",
  "agricultural",
  "forestry",
  "destination",
];
export const PARKING_MIN_AREA_M2 = 2500;

const kind: ExpressionSpecification = ["get", "kind"];
const isKind = (...kinds: PoiKind[]): ExpressionSpecification => ["in", kind, ["literal", kinds]];

const parkingShown: ExpressionSpecification = [
  "all",
  ["!", ["in", ["coalesce", ["get", "access"], ""], ["literal", PARKING_EXCLUDED_ACCESS]]],
  [
    "any",
    ["has", "hiking"],
    [">=", ["coalesce", ["get", "area_m2"], 0], PARKING_MIN_AREA_M2],
    ["in", "wanderparkplatz", ["downcase", ["coalesce", ["get", "name"], ""]]],
  ],
];

const priority = [
  "match",
  kind,
  ...Object.entries(PRIORITY).flat(),
  ["coalesce", ["get", "rank"], 50],
] as unknown as ExpressionSpecification;
const sortKey: ExpressionSpecification = ["+", priority, ["case", ["has", "name"], 0, 0.5]];
/** Unnamed guideposts are the first thing to give way. */
const UNNAMED_GUIDEPOST_PRIORITY = 60;

/** Bus stops appear from z11.5, i.e. at every print scale from 1:50 000 (z11.95) to 1:10 000. */
const BUSSTOP_MINZOOM = 11.5;

/** Icons are drawn exactly at the print zoom (1:25 000 ≈ z12.95, 1:50 000 ≈ z11.95). */
const iconSize: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 11, 0.75, 12.5, 1];

const iconImage = (name: ExpressionSpecification | string): ExpressionSpecification => [
  "concat",
  "poi:",
  name,
];

const NAME_SIZE = pt(6.5);
const FLAG_NAME_SIZE = pt(6);

// Text offsets in em around a centred box (half box ≈ 1.7 mm, gap ≈ 0.4 mm): right, left,
// below, above, then the four corners. Every position keeps the text clear of the icon's own
// image box, because in print mode names are a separate layer that collides with the icons.
const BOX_OFFSET = 0.95;
const DIAG_X = 0.8;
const DIAG_Y = 0.75;
const BOX_ANCHORS = [
  "left",
  [BOX_OFFSET, 0],
  "right",
  [-BOX_OFFSET, 0],
  "top",
  [0, BOX_OFFSET * 0.85],
  "bottom",
  [0, -BOX_OFFSET * 0.85],
  "top-left",
  [DIAG_X, DIAG_Y],
  "bottom-left",
  [DIAG_X, -DIAG_Y],
  "top-right",
  [-DIAG_X, DIAG_Y],
  "bottom-right",
  [-DIAG_X, -DIAG_Y],
];

// Guidepost flag: icon anchored bottom-left so the pole foot sits on the point; the name goes
// to the right of the pennant (or to the left of the pole), vertically centred on the pennant.
const flag = flagGeometry("guidepost");
const flagSmall = flagGeometry("guidepost_small");
const flagY = flag.pennantMidYPx / FLAG_NAME_SIZE;
/** Right edge of the flag image (incl. halo margin) relative to the pole foot, in px. */
const flagImageRightPx = mm(POI_ICONS.guidepost!.sizeMm) + flag.iconOffset[0];
const FLAG_ANCHORS = [
  "left",
  [
    Math.max(flag.pennantRightPx / FLAG_NAME_SIZE + 0.25, flagImageRightPx / FLAG_NAME_SIZE + 0.1),
    flagY,
  ],
  "right",
  [-0.35, flagY],
];

function poiLayer(id: string, filter: FilterSpecification, minzoom: number) {
  return {
    id,
    type: "symbol" as const,
    source: OSM_SOURCE,
    "source-layer": "poi",
    filter,
    minzoom,
    metadata: PLACEMENT_DISPLACE,
  };
}

export function poiLayers(): LayerSpecification[] {
  const isGuidepost: ExpressionSpecification = ["==", kind, "guidepost"];
  const main: LayerSpecification = {
    ...poiLayer(
      "poi-main",
      [
        "all",
        ["!", isKind(...MINOR_KINDS)],
        ["any", ["!=", kind, "parking"], parkingShown],
        ["any", ["!", isGuidepost], ["has", "name"]],
      ],
      11,
    ),
    layout: {
      "symbol-sort-key": sortKey,
      "symbol-z-order": "auto",
      "icon-image": iconImage(kind),
      "icon-size": iconSize,
      "icon-anchor": ["case", isGuidepost, "bottom-left", "center"],
      "icon-offset": ["case", isGuidepost, ["literal", flag.iconOffset], ["literal", [0, 0]]],
      "icon-padding": 1,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "text-field": ["case", ["all", isKind(...NAMED_KINDS), ["has", "name"]], ["get", "name"], ""],
      "text-font": FONT,
      "text-size": ["case", isGuidepost, FLAG_NAME_SIZE, NAME_SIZE],
      "text-max-width": 9,
      "text-line-height": 1.1,
      "text-variable-anchor-offset": [
        "case",
        isGuidepost,
        ["literal", FLAG_ANCHORS],
        ["literal", BOX_ANCHORS],
      ] as ExpressionSpecification,
      "text-justify": "auto",
      "text-padding": 1,
      "text-optional": true,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": TEXT_COLOR,
      "text-halo-color": HALO_COLOR,
      "text-halo-width": 1.1,
    },
  };

  const minor: LayerSpecification = {
    ...poiLayer(
      "poi-minor",
      ["any", isKind(...MINOR_KINDS), ["all", isGuidepost, ["!", ["has", "name"]]]],
      12.5,
    ),
    layout: {
      "symbol-sort-key": ["case", isGuidepost, UNNAMED_GUIDEPOST_PRIORITY, sortKey],
      "icon-image": ["case", isGuidepost, "poi:guidepost_small", iconImage(kind)],
      "icon-size": iconSize,
      "icon-anchor": ["case", isGuidepost, "bottom-left", "center"],
      "icon-offset": ["case", isGuidepost, ["literal", flagSmall.iconOffset], ["literal", [0, 0]]],
      "icon-padding": 0.5,
      "icon-allow-overlap": false,
    },
  };

  // Array order = draw order; MapLibre places the topmost layer first, so main wins collisions.
  return [minor, main];
}

/**
 * GTFS bus stops (group "busstops", own source `busstops`, tile layer `bus_stop`: `name`, `sat`,
 * `sun`, `min`; every stop in the file is shown). The layer takes part in the print placement
 * like the pictograms: the symbol never drops out. Stop names are not shown (user decision).
 */
export function busstopLayers(): LayerSpecification[] {
  return [
    {
      id: "busstops-main",
      type: "symbol",
      source: BUSSTOPS_SOURCE,
      "source-layer": "bus_stop",
      minzoom: BUSSTOP_MINZOOM,
      metadata: PLACEMENT_DISPLACE,
      layout: {
        "symbol-sort-key": BUSSTOP_PRIORITY,
        "icon-image": "poi:busstop",
        "icon-size": iconSize,
        "icon-padding": 0.5,
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
      },
    },
  ];
}
