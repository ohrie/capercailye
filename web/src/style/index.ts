// Composes the map style from feature groups. Each group owns a set of layers
// (ids prefixed with the group id); sidebar toggles switch whole groups.
import type { LayerSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { BUSSTOPS_CREDIT, OSM_CREDIT, RELIEF_CREDIT } from "../config";
import { creditText } from "../credits";
import { buildingLayers } from "./buildings";
import { cliffLayers } from "./cliffs";
import { contourLayers, hillshadeLayers } from "./hillshade";
import { labelLayers, nameLayers } from "./labels";
import { backgroundLayers, landcoverLayers } from "./landcover";
import { gpxLayers } from "./gpx";
import {
  busstopLayers,
  POI_CATEGORIES,
  poiCategoryLayers,
  poiLayers,
  setGuidepostNames,
  viewpointLayers,
} from "./poi";
import { protectedLayers } from "./protected";
import { NETWORK_GROUPS, routeLayers, setRouteNetworks, waymarkLayers } from "./routes";
import { shieldLayers, withoutShieldRefs } from "./shields";
import {
  BUSSTOPS_SOURCE,
  CONTOUR_SOURCE,
  DEM_SOURCE,
  GPX_SOURCE,
  OSM_SOURCE,
  type ReliefUrls,
  WAYMARK_SOURCE,
  busstopsSource,
  contourSource,
  demSource,
  gpxSource,
  osmSource,
  waymarkSource,
} from "./sources";
import { transportLayers } from "./transport";
import { waterLayers } from "./water";

/** Sections of the sidebar panel "Ebenen". */
export type LayerSection = "routes" | "terrain" | "symbols";

export const SECTIONS: readonly { id: LayerSection; label: string }[] = [
  { id: "routes", label: "Routen" },
  { id: "terrain", label: "Gelände und Karte" },
  { id: "symbols", label: "Symbole" },
];

export interface LayerGroup {
  id: string;
  /** German label for the sidebar; groups without label are not toggleable on their own. */
  label?: string;
  /** Sidebar section of a labelled group. */
  section?: LayerSection;
  /** Labelled group this switch is a sub-switch of (indented; disabled, value kept, while it is off). */
  parent?: string;
  /** Id of the labelled group whose sidebar toggle also switches this group. */
  toggledBy?: string;
  defaultVisible: boolean;
  /** Optional data source of the group (id in `sources`); without it the group is left out. */
  source?: string;
  /** Layers of the group; may depend on switches (e.g. the guidepost names inside poi-main). */
  layers: (visibility?: GroupVisibility) => LayerSpecification[];
  /**
   * Switches without layers of their own (the layers read them while the style is built) update
   * a live map here when toggled.
   */
  onToggle?: (map: MapLibreMap, visible: boolean, visibility: GroupVisibility) => void;
}

/**
 * Draw order = array order; for symbols, later groups also win label collisions.
 * Layer ids must start with `${group.id}-`, and no group id may be a prefix of another
 * group's layer ids (checked in style.test.ts).
 */
export const GROUPS: LayerGroup[] = [
  { id: "base", defaultVisible: true, layers: backgroundLayers },
  { id: "landcover", defaultVisible: true, layers: landcoverLayers },
  {
    id: "hillshade",
    label: "Schummerung",
    section: "terrain",
    defaultVisible: true,
    layers: hillshadeLayers,
  },
  // M4: contour lines and elevation numbers (maplibre-contour). Above the hillshade, below all
  // other lines and symbols: the numbers are placed last and yield to waymarks, names and icons.
  {
    id: "contours",
    label: "Höhenlinien",
    section: "terrain",
    defaultVisible: true,
    source: CONTOUR_SOURCE,
    layers: contourLayers,
  },
  {
    id: "protected",
    label: "Schutzgebiete",
    section: "terrain",
    defaultVisible: true,
    layers: protectedLayers,
  },
  { id: "water", defaultVisible: true, layers: waterLayers },
  { id: "cliffs", defaultVisible: true, layers: cliffLayers },
  {
    id: "buildings",
    label: "Gebäude",
    section: "terrain",
    defaultVisible: true,
    layers: buildingLayers,
  },
  {
    id: "routes",
    label: "Wanderrouten",
    section: "routes",
    defaultVisible: true,
    layers: routeLayers,
  },
  // Network sub-switches of "Wanderrouten" (B3): no layers of their own. They control band AND
  // waymark signs: they set filter, width and opacity of routes-band (also built into the style from
  // the visibility, for the export) and, per route, decide which routes get signs (waymarks/routes.ts;
  // main.ts recomputes the signs).
  ...(
    [
      ["iwn", "International"],
      ["nwn", "National"],
      ["rwn", "Regional"],
      ["lwn", "Lokal"],
    ] as const
  ).map(([net, label]): LayerGroup => ({
    id: NETWORK_GROUPS[net],
    label,
    section: "routes",
    parent: "routes",
    defaultVisible: true,
    layers: () => [],
    onToggle: (map, _visible, visibility) => setRouteNetworks(map, visibility),
  })),
  { id: "transport", defaultVisible: true, layers: transportLayers },
  // M6: the GPX track above the roads, below the names. The source always exists (empty without a
  // track), so the print placement knows the fixed start/end markers from the beginning.
  { id: "gpx", defaultVisible: true, layers: gpxLayers },
  {
    id: "names",
    toggledBy: "labels",
    defaultVisible: true,
    layers: () => withoutShieldRefs(nameLayers()),
  },
  // Road number shields (Autobahn / Bundesstrasse); follow the "Beschriftung" toggle.
  { id: "shields", toggledBy: "labels", defaultVisible: true, layers: shieldLayers },
  // The pictogram kinds without a switch of their own (churches, stations, caves, springs, towers,
  // crosses …); the others are the categories below.
  {
    id: "poi",
    label: "Weitere Symbole",
    section: "symbols",
    defaultVisible: true,
    layers: poiLayers,
  },
  // One group per pictogram category (M6): own layers, switched by visibility.
  ...POI_CATEGORIES.map((cat): LayerGroup => ({
    id: cat.id,
    label: cat.label,
    section: "symbols",
    defaultVisible: cat.defaultVisible,
    layers: (v = {}) => poiCategoryLayers(cat, { guidepostNames: isOn("guidepostnames", v) }),
  })),
  // Viewpoints: only named ones are in the tiles; on by default. View towers stay in "poi".
  {
    id: "viewpoints",
    label: "Aussichtspunkte",
    section: "symbols",
    defaultVisible: true,
    layers: viewpointLayers,
  },
  // Names of the guideposts (the flags belong to the category "guideposts"). Not a layer group: the
  // switch only changes the text-field of guideposts-main.
  {
    id: "guidepostnames",
    label: "Wegweisernamen",
    section: "symbols",
    parent: "guideposts",
    defaultVisible: false,
    layers: () => [],
    onToggle: setGuidepostNames,
  },
  // GTFS bus stops (M2c): own source. Above the pictograms: where displaced icons still overlap, the
  // stop (priority 21) must not be covered by restaurants, parking etc. Its names are placed first.
  {
    id: "busstops",
    label: "Bushaltestellen",
    section: "symbols",
    defaultVisible: true,
    source: BUSSTOPS_SOURCE,
    layers: busstopLayers,
  },
  {
    id: "labels",
    label: "Beschriftung",
    section: "terrain",
    defaultVisible: true,
    layers: labelLayers,
  },
  // M3: waymark signs on top, so they win collisions against all other labels. Part of the routes
  // (SPEC.md 4.4), no switch of their own: "Wanderrouten" and the network switches decide (the signs
  // are recomputed in waymarks/index.ts). The layer draws the points of the source `waymark-signs`
  // that waymarks/index.ts computes: one image per sign, placed along the routes by the app. Like
  // `shields` this is a sign group that follows its toggle (`toggledBy`).
  {
    id: "waymarks",
    toggledBy: "routes",
    defaultVisible: true,
    layers: waymarkLayers,
  },
];

/**
 * Order of the switches in the sidebar (draw order is GROUPS order). Sub-switches follow their
 * parent in the order of this list; a labelled group missing here is a bug (style.test.ts).
 */
export const UI_ORDER: readonly string[] = [
  "routes",
  ...Object.values(NETWORK_GROUPS),
  "hillshade",
  "contours",
  "protected",
  "buildings",
  "labels",
  ...POI_CATEGORIES.filter((c) => c.id !== "guideposts").map((c) => c.id),
  "viewpoints",
  "guideposts",
  "guidepostnames",
  "busstops",
  "poi",
];

/** Labelled groups of a sidebar section in display order (sub-switches follow their parent). */
export function uiGroups(section: LayerSection): LayerGroup[] {
  return UI_ORDER.map((id) => GROUPS.find((g) => g.id === id)).filter(
    (g): g is LayerGroup => g !== undefined && g.section === section && g.label !== undefined,
  );
}

export type GroupVisibility = Record<string, boolean>;

/** State of a toggle (its default if the visibility map has no entry). */
function isOn(id: string, visibility: GroupVisibility): boolean {
  return visibility[id] ?? GROUPS.find((g) => g.id === id)?.defaultVisible ?? true;
}

export function defaultVisibility(): GroupVisibility {
  return Object.fromEntries(GROUPS.map((g) => [g.id, g.defaultVisible]));
}

/** Visibility of a group, following its controlling toggle if it has one. */
function groupVisible(group: LayerGroup, visibility: GroupVisibility): boolean {
  return isOn(group.toggledBy ?? group.id, visibility);
}

export interface StyleOptions {
  pmtilesUrl: string;
  /** GTFS bus stop PMTiles; without it the style has no bus stop source and no `busstops` layers. */
  busstopsUrl?: string;
  glyphsUrl: string;
  /** Tile URLs of hillshade and contour sources (from maplibre-contour's DemSource, see tiles.ts). */
  relief: ReliefUrls;
  visibility: GroupVisibility;
  /** The GPX track (lines and start/end points); empty source without it. */
  gpx?: FeatureCollection;
  /** Placed waymark signs (waymarks/index.ts, GeoJSON points); empty source without them. */
  waymarks?: FeatureCollection;
  /** Attribution text per source (map attribution); default: the sources without data dates. */
  credits?: SourceCredits;
}

/** Texts of the map attribution, one per source (the relief text serves DEM and contours). */
export interface SourceCredits {
  osm: string;
  relief: string;
  busstops: string;
}

const DEFAULT_CREDITS: SourceCredits = {
  osm: creditText(OSM_CREDIT),
  relief: creditText({ ...RELIEF_CREDIT, stand: undefined }),
  busstops: creditText(BUSSTOPS_CREDIT),
};

export function buildStyle(opts: StyleOptions): StyleSpecification {
  const credits = opts.credits ?? DEFAULT_CREDITS;
  const sources: StyleSpecification["sources"] = {
    [OSM_SOURCE]: osmSource(opts.pmtilesUrl, credits.osm),
    [DEM_SOURCE]: demSource(opts.relief.dem, credits.relief),
    [CONTOUR_SOURCE]: contourSource(opts.relief.contours, credits.relief),
    [GPX_SOURCE]: gpxSource(opts.gpx),
    [WAYMARK_SOURCE]: waymarkSource(opts.waymarks),
  };
  if (opts.busstopsUrl)
    sources[BUSSTOPS_SOURCE] = busstopsSource(opts.busstopsUrl, credits.busstops);
  const layers = GROUPS.flatMap((g) => {
    if (g.source && !sources[g.source]) return [];
    const visible = groupVisible(g, opts.visibility);
    return g.layers(opts.visibility).map((layer) => {
      if (!layer.id.startsWith(`${g.id}-`)) {
        throw new Error(`Layer ${layer.id} must be prefixed with ${g.id}-`);
      }
      return {
        ...layer,
        layout: { ...layer.layout, visibility: visible ? "visible" : "none" },
      } as LayerSpecification;
    });
  });
  return {
    version: 8,
    name: "capercailye Wanderkarte",
    glyphs: opts.glyphsUrl,
    sources,
    layers,
  };
}

/** Switches a toggle: the group itself and every group that follows it (`toggledBy`). */
export function setGroupVisible(
  map: MapLibreMap,
  groupId: string,
  visible: boolean,
  visibility: GroupVisibility = defaultVisibility(),
): void {
  GROUPS.find((g) => g.id === groupId)?.onToggle?.(map, visible, visibility);
  const prefixes = GROUPS.filter((g) => g.id === groupId || g.toggledBy === groupId).map(
    (g) => `${g.id}-`,
  );
  for (const layer of map.getStyle().layers) {
    if (prefixes.some((p) => layer.id.startsWith(p))) {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    }
  }
}
