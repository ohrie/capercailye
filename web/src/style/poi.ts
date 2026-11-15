// POI pictogram layers (tile layer `poi`, tiles/SCHEMA.md). Layer ids must start with "poi-".
//
// Images are "poi:<name>" ids rasterised at runtime from SVG (src/icons). Two layers for the
// kinds without a switch of their own (group "poi", sidebar "More symbols"):
//   poi-main   boxed pictograms and churches, optional names; placed first.
//   poi-minor  small plain symbols without names (crosses, masts …),
//              only at 1:25 000 (z >= 12.5); fills the gaps the main layer leaves.
// Every other kind belongs to one POI_CATEGORIES entry (M6): its own group with its own layers
// `<id>-main` (and `<id>-minor` for small kinds), switched by visibility like `viewpoints`. The
// placement (placement/collect.ts) reads the filter of the original spec, so a runtime setFilter
// would not reach it; separate layers do.
// On screen MapLibre's collision decides: icons never overlap, names are optional
// (text-optional), and `symbol-sort-key` (PRIORITY, derived from style/hierarchy.ts, named before
// unnamed) sets the order.
// In print view and in the PDF both layers are taken over by the print placement
// (metadata PLACEMENT_DISPLACE, src/placement): every icon is drawn, overlapping icons are
// displaced by priority (same sort key), and only names may drop out.
//
// Density rules (per A4 sheet at 1:25 000 in BW: parking 67, guideposts 50 …):
//   merging      parking, guideposts, wayside shrines, stones, rocks, masts, toilets and fountains
//                closer than 75 m are merged into one point at tile build time (`count`); picnic
//                site, barbecue and shelter within 75 m become one rest-area symbol (`bbq=true`).
//                `count` and `bbq` are not drawn (yet).
//   parking      only with hiking=yes, a name containing "Wanderparkplatz", or area_m2 >= 2500
//                (≈ 80–100 cars); never access=private/no/customers/permit/… (no name label).
//   guidepost    named: yellow flag, in guideposts-main; the name only with the "Guidepost names"
//                switch. Unnamed: small flag in guideposts-minor, lowest priority (drops out first).
//   viewpoint    only named ones are in the tiles; own layer `viewpoints-main` (group "viewpoints",
//                on by default); view towers stay in poi-main.
//   bus stops    not from OSM: GTFS stops (>= 4 departures per weekend day) come from their own
//                PMTiles file as group "busstops" (busstopLayers below); railway stations/halts stay here.
//   restaurant/cafe  icon + name. In towns and cities (`urban=true`) the print placement thins them
//                to one per 8 mm of paper, the one with the higher `weight` stays
//                (placement/thin.ts); elsewhere none is dropped.
// Every priority comes from style/hierarchy.ts (the importance hierarchy), every size from
// style/sizes.ts.
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import { m } from "../paraglide/messages.js";
import { flagGeometry, POI_ICONS, type PoiKind } from "../icons/registry";
import { nameCloneId } from "../placement/layers";
import {
  BUSSTOP_PRIORITY,
  FALLBACK_PRIORITY,
  KIND_RANKS,
  UNNAMED_GUIDEPOST_PRIORITY,
} from "./hierarchy";
import { iconSizeByScale } from "./sizes";
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

/** Placement priority (lower first) per kind: the rank in style/hierarchy.ts. */
export const PRIORITY: Readonly<Record<PoiKind, number>> = KIND_RANKS;

export { BUSSTOP_PRIORITY, UNNAMED_GUIDEPOST_PRIORITY };

export interface PoiCategory {
  /** Group id; the layers are `<id>-main` and (small kinds only) `<id>-minor`. */
  id: string;
  /** Label for the sidebar (a getter, in the active language). */
  readonly label: string;
  kinds: PoiKind[];
  /** One or two kinds (subset of `kinds`) shown next to the sidebar switch as its legend. */
  legend: PoiKind[];
  defaultVisible: boolean;
}

/**
 * Pictogram kinds with their own sidebar switch (SPEC.md 4.2).
 * Group ids must not be a prefix of another group's layer ids (style.test.ts), hence `drinking`.
 */
export const POI_CATEGORIES: readonly PoiCategory[] = [
  {
    id: "shelters",
    get label() {
      return m.layer_shelters();
    },
    kinds: ["shelter", "wilderness_hut"],
    legend: ["shelter", "wilderness_hut"],
    defaultVisible: true,
  },
  {
    id: "food",
    get label() {
      return m.layer_food();
    },
    kinds: ["alpine_hut", "restaurant", "cafe"],
    legend: ["restaurant", "alpine_hut"],
    defaultVisible: true,
  },
  {
    id: "parking",
    get label() {
      return m.layer_parking();
    },
    kinds: ["parking"],
    legend: ["parking"],
    defaultVisible: true,
  },
  {
    id: "picnic",
    get label() {
      return m.layer_picnic();
    },
    kinds: ["picnic_site", "bbq"],
    legend: ["picnic_site", "bbq"],
    defaultVisible: true,
  },
  {
    id: "lodging",
    get label() {
      return m.layer_lodging();
    },
    kinds: ["camp_site", "caravan_site", "hostel", "hotel"],
    legend: ["hotel", "camp_site"],
    defaultVisible: true,
  },
  {
    id: "toilets",
    get label() {
      return m.layer_toilets();
    },
    kinds: ["toilets"],
    legend: ["toilets"],
    defaultVisible: true,
  },
  {
    id: "drinking",
    get label() {
      return m.layer_drinking();
    },
    kinds: ["drinking_water", "fountain"],
    legend: ["drinking_water", "fountain"],
    defaultVisible: true,
  },
  {
    id: "heritage",
    get label() {
      return m.layer_heritage();
    },
    kinds: ["castle", "castle_ruins", "ruins", "monument", "memorial"],
    legend: ["castle", "ruins"],
    defaultVisible: true,
  },
  {
    id: "guideposts",
    get label() {
      return m.layer_guideposts();
    },
    kinds: ["guidepost"],
    legend: ["guidepost"],
    defaultVisible: true,
  },
];

/** Kinds of the categories (they leave poi-main / poi-minor). */
const CATEGORY_KINDS: PoiKind[] = POI_CATEGORIES.flatMap((c) => c.kinds);

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
  ["coalesce", ["get", "rank"], FALLBACK_PRIORITY],
] as unknown as ExpressionSpecification;
const sortKey: ExpressionSpecification = ["+", priority, ["case", ["has", "name"], 0, 0.5]];
/** Bus stops appear from z11.5, i.e. at every print scale from 1:50 000 (z11.95) to 1:10 000. */
const BUSSTOP_MINZOOM = 11.5;

/** Icon size by print scale: one rule for pictograms, bus stops and waymarks (style/sizes.ts). */
const iconSize = iconSizeByScale;

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

const isGuidepost: ExpressionSpecification = ["==", kind, "guidepost"];

/** Id of the layer whose text carries the guidepost names (see setGuidepostNames). */
export const GUIDEPOST_NAME_LAYER = "guideposts-main";

/**
 * `text-field` of the main layers: the name of every named kind; guideposts only with
 * `guidepostNames` (sidebar switch "Guidepost names", off by default: the flags stay).
 */
export function poiNameField(guidepostNames: boolean): ExpressionSpecification {
  const kinds = guidepostNames ? NAMED_KINDS : NAMED_KINDS.filter((k) => k !== "guidepost");
  return ["case", ["all", isKind(...kinds), ["has", "name"]], ["get", "name"], ""];
}

/**
 * Switches the guidepost names on a live map: the original layer and, in print view, its name
 * clone (placement/layers.ts) get the other `text-field`. Icons and their placement are untouched.
 */
export function setGuidepostNames(map: MapLibreMap, on: boolean): void {
  for (const id of [GUIDEPOST_NAME_LAYER, nameCloneId(GUIDEPOST_NAME_LAYER)]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "text-field", poiNameField(on));
  }
}

export interface PoiLayerOptions {
  /** Print the names of guideposts (default false). */
  guidepostNames?: boolean;
}

/** A boxed-pictogram layer with optional names (poi-main, viewpoints-main). */
function mainLayer(
  id: string,
  filter: FilterSpecification,
  guidepostNames: boolean,
): LayerSpecification {
  return {
    ...poiLayer(id, filter, 11),
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
      "text-field": poiNameField(guidepostNames),
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
  } as LayerSpecification;
}

/** A small-symbol layer (no boxes, no names), only at 1:25 000. */
function minorLayer(id: string, filter: FilterSpecification): LayerSpecification {
  return {
    ...poiLayer(id, filter, 12.5),
    layout: {
      "symbol-sort-key": ["case", isGuidepost, UNNAMED_GUIDEPOST_PRIORITY, sortKey],
      "icon-image": ["case", isGuidepost, "poi:guidepost_small", iconImage(kind)],
      "icon-size": iconSize,
      "icon-anchor": ["case", isGuidepost, "bottom-left", "center"],
      "icon-offset": ["case", isGuidepost, ["literal", flagSmall.iconOffset], ["literal", [0, 0]]],
      "icon-padding": 0.5,
      "icon-allow-overlap": false,
    },
  } as LayerSpecification;
}

/** Kinds of the minor layer without a category: the small plain symbols. */
const MINOR_REST: PoiKind[] = MINOR_KINDS.filter((k) => !CATEGORY_KINDS.includes(k));

/** The kinds without a switch of their own: group "poi" ("More symbols"). */
export function poiLayers(): LayerSpecification[] {
  const main = mainLayer(
    "poi-main",
    // Viewpoints and the category kinds have their own layers and switches; unknown kinds stay here.
    ["all", ["!", isKind(...MINOR_KINDS, ...CATEGORY_KINDS)], ["!=", kind, "viewpoint"]],
    false,
  );
  const minor = minorLayer("poi-minor", isKind(...MINOR_REST));
  // Array order = draw order; MapLibre places the topmost layer first, so main wins collisions.
  return [minor, main];
}

/**
 * Layers of one category (own group): `<id>-main` with the kinds that are not small, optionally
 * `<id>-minor` with the small ones (MINOR_KINDS, and the unnamed guideposts).
 */
export function poiCategoryLayers(
  cat: PoiCategory,
  opts: PoiLayerOptions = {},
): LayerSpecification[] {
  const mainKinds = cat.kinds.filter((k) => !MINOR_KINDS.includes(k));
  const minorKinds = cat.kinds.filter((k) => MINOR_KINDS.includes(k));
  const guideposts = cat.kinds.includes("guidepost");
  const conditions: ExpressionSpecification[] = [isKind(...mainKinds)];
  // Car parks only when they serve hikers; guideposts only when named (the rest are small flags).
  if (cat.kinds.includes("parking"))
    conditions.push(["any", ["!=", kind, "parking"], parkingShown]);
  if (guideposts) conditions.push(["any", ["!", isGuidepost], ["has", "name"]]);
  const layers: LayerSpecification[] = [];
  const minorParts: ExpressionSpecification[] = [];
  if (minorKinds.length > 0) minorParts.push(isKind(...minorKinds));
  if (guideposts) minorParts.push(["all", isGuidepost, ["!", ["has", "name"]]]);
  if (minorParts.length > 0) {
    layers.push(minorLayer(`${cat.id}-minor`, ["any", ...minorParts]));
  }
  if (mainKinds.length > 0) {
    layers.push(
      mainLayer(`${cat.id}-main`, ["all", ...conditions], guideposts && !!opts.guidepostNames),
    );
  }
  return layers;
}

/**
 * Named viewpoints (tourism=viewpoint): own layer in group "viewpoints", on by default. Same look
 * and placement role as poi-main; while the group is off, the print placement reserves no room.
 */
export function viewpointLayers(): LayerSpecification[] {
  // Only named viewpoints are in the tiles; the name test is defensive for old tiles.
  return [mainLayer("viewpoints-main", ["all", ["==", kind, "viewpoint"], ["has", "name"]], false)];
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
