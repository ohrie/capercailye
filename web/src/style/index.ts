// Composes the map style from feature groups. Each group owns a set of layers
// (ids prefixed with the group id); sidebar toggles switch whole groups.
import type { LayerSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import { buildingLayers } from "./buildings";
import { cliffLayers } from "./cliffs";
import { contourLayers, hillshadeLayers } from "./hillshade";
import { labelLayers, nameLayers } from "./labels";
import { backgroundLayers, landcoverLayers } from "./landcover";
import { busstopLayers, poiLayers } from "./poi";
import { protectedLayers } from "./protected";
import { routeLayers, waymarkLayers } from "./routes";
import { shieldLayers, withoutShieldRefs } from "./shields";
import {
  BUSSTOPS_SOURCE,
  CONTOUR_SOURCE,
  DEM_SOURCE,
  OSM_SOURCE,
  type ReliefUrls,
  busstopsSource,
  contourSource,
  demSource,
  osmSource,
} from "./sources";
import { transportLayers } from "./transport";
import { waterLayers } from "./water";

export interface LayerGroup {
  id: string;
  /** German label for the sidebar; groups without label are not toggleable on their own. */
  label?: string;
  /** Id of the labelled group whose sidebar toggle also switches this group. */
  toggledBy?: string;
  defaultVisible: boolean;
  /** Optional data source of the group (id in `sources`); without it the group is left out. */
  source?: string;
  layers: () => LayerSpecification[];
}

/**
 * Draw order = array order; for symbols, later groups also win label collisions.
 * Layer ids must start with `${group.id}-`, and no group id may be a prefix of another
 * group's layer ids (checked in style.test.ts).
 */
export const GROUPS: LayerGroup[] = [
  { id: "base", defaultVisible: true, layers: backgroundLayers },
  { id: "landcover", defaultVisible: true, layers: landcoverLayers },
  { id: "hillshade", label: "Schummerung", defaultVisible: true, layers: hillshadeLayers },
  // M4: contour lines and elevation numbers (maplibre-contour). Above the hillshade, below all
  // other lines and symbols: the numbers are placed last and yield to waymarks, names and icons.
  {
    id: "contours",
    label: "Höhenlinien",
    defaultVisible: true,
    source: CONTOUR_SOURCE,
    layers: contourLayers,
  },
  { id: "protected", label: "Schutzgebiete", defaultVisible: true, layers: protectedLayers },
  { id: "water", defaultVisible: true, layers: waterLayers },
  { id: "cliffs", defaultVisible: true, layers: cliffLayers },
  { id: "buildings", label: "Gebäude", defaultVisible: true, layers: buildingLayers },
  { id: "routes", label: "Wanderrouten", defaultVisible: true, layers: routeLayers },
  { id: "transport", defaultVisible: true, layers: transportLayers },
  {
    id: "names",
    toggledBy: "labels",
    defaultVisible: true,
    layers: () => withoutShieldRefs(nameLayers()),
  },
  // Road number shields (Autobahn / Bundesstrasse); follow the "Beschriftung" toggle.
  { id: "shields", toggledBy: "labels", defaultVisible: true, layers: shieldLayers },
  { id: "poi", label: "Piktogramme", defaultVisible: true, layers: poiLayers },
  // GTFS bus stops (M2c): own source. Above the pictograms: where displaced icons still overlap, the
  // stop (priority 21) must not be covered by restaurants, parking etc. Its names are placed first.
  {
    id: "busstops",
    label: "Bushaltestellen",
    defaultVisible: true,
    source: BUSSTOPS_SOURCE,
    layers: busstopLayers,
  },
  { id: "labels", label: "Beschriftung", defaultVisible: true, layers: labelLayers },
  // M3: waymark symbols on top, so they win collisions against all other labels.
  { id: "waymarks", toggledBy: "routes", defaultVisible: true, layers: waymarkLayers },
];

export type GroupVisibility = Record<string, boolean>;

export function defaultVisibility(): GroupVisibility {
  return Object.fromEntries(GROUPS.map((g) => [g.id, g.defaultVisible]));
}

/** Visibility of a group, following its controlling toggle if it has one. */
function groupVisible(group: LayerGroup, visibility: GroupVisibility): boolean {
  const key = group.toggledBy ?? group.id;
  const owner = GROUPS.find((g) => g.id === key) ?? group;
  return visibility[key] ?? owner.defaultVisible;
}

export interface StyleOptions {
  pmtilesUrl: string;
  /** GTFS bus stop PMTiles; without it the style has no bus stop source and no `busstops` layers. */
  busstopsUrl?: string;
  glyphsUrl: string;
  /** Tile URLs of hillshade and contour sources (from maplibre-contour's DemSource, see tiles.ts). */
  relief: ReliefUrls;
  visibility: GroupVisibility;
}

export function buildStyle(opts: StyleOptions): StyleSpecification {
  const sources: StyleSpecification["sources"] = {
    [OSM_SOURCE]: osmSource(opts.pmtilesUrl),
    [DEM_SOURCE]: demSource(opts.relief.dem),
    [CONTOUR_SOURCE]: contourSource(opts.relief.contours),
  };
  if (opts.busstopsUrl) sources[BUSSTOPS_SOURCE] = busstopsSource(opts.busstopsUrl);
  const layers = GROUPS.flatMap((g) => {
    if (g.source && !sources[g.source]) return [];
    const visible = groupVisible(g, opts.visibility);
    return g.layers().map((layer) => {
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
export function setGroupVisible(map: MapLibreMap, groupId: string, visible: boolean): void {
  const prefixes = GROUPS.filter((g) => g.id === groupId || g.toggledBy === groupId).map(
    (g) => `${g.id}-`,
  );
  for (const layer of map.getStyle().layers) {
    if (prefixes.some((p) => layer.id.startsWith(p))) {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    }
  }
}
