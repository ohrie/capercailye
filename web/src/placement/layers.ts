// Style side of the print placement (SPEC.md 4.4). Pure: works on style specs, no DOM.
//
// Style layers opt in through metadata (see PLACEMENT_KEY):
//   "displace"  symbol layer whose icons must never be dropped. In print mode the layer is
//               hidden and replaced by clones on the GeoJSON source PLACEMENT_SOURCE, which
//               collect.ts fills with displaced points (+ leader lines):
//                 placement-icons        ONE layer for the icons of all displaced layers (below):
//                                        allow-overlap; at the top of the style, so they are
//                                        placed before every label and block them.
//                 placement-<id>-name    the layer's text only, normal collision, at the
//                                        original layer's position (same label priority as
//                                        before); a name that does not fit drops out.
//                 placement-<id>-leader  / -anchor: fine line and dot to the true location.
//                 placement-<id>-source  invisible circle layer on the original's source layer: a
//                                        vector source whose layers are all hidden loads no tiles
//                                        (MapLibre), and collect.ts reads the features from the
//                                        loaded tiles. Matters for sources that only feed displaced
//                                        layers (the GTFS `busstops` source).
//               The merged icon layer sorts by the layers' `symbol-sort-key` (the rank of
//               style/hierarchy.ts), so the draw order follows the importance hierarchy across
//               layers and sources: a railway station lies over a bus stop (other source), a bus
//               stop over a restaurant.
//   "fixed"     symbol or circle layer that is drawn as it is (never moves) and only reserves
//               its space, e.g. peak dots.
// Outside print mode the original layers are shown with MapLibre's normal collision.
//
// "fixed" text-only symbol layers (settlement names) are placed before the icons, so they are never
// pushed out by pictograms; their estimated box is an obstacle the icons move away from.
//
// M3 waymarks (style/routes.ts) have no role: the app places them itself (waymarks/index.ts) and
// hands their boxes to the displacement as obstacles (PlaceOptions.obstacles, placement/index.ts).
// Their layer sits in the "waymarks" group above everything, so MapLibre places it before the
// pictogram clones as well (icon-allow-overlap: true, nothing removes a sign), as long as the clones
// are inserted below it: they go below the first "fixed" symbol layer, which precedes the waymarks.
import type { FeatureCollection, Geometry } from "geojson";
import {
  latest,
  type CircleLayerSpecification,
  type LayerSpecification,
  type LineLayerSpecification,
  type StyleSpecification,
  type SymbolLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { mm } from "../style/units";

export const PLACEMENT_KEY = "capercailye:placement";
export const PLACEMENT_SOURCE = "placement";
export const PLACEMENT_PREFIX = "placement-";

export type PlacementRole = "displace" | "fixed";

/** Feature property names on the placement source. */
export const P_ROLE = "_role";
export const P_LAYER = "_layer";

export type FeatureRole = "symbol" | "leader" | "anchor";

const LEADER_COLOR = "#2b2b2b";
const LEADER_WIDTH_MM = 0.15;
const ANCHOR_RADIUS_MM = 0.3;

export interface ManagedLayer {
  id: string;
  role: PlacementRole;
  /** Original spec (with the visibility the style was built with). */
  spec: LayerSpecification;
  /** Clone layer ids (empty for "fixed"); the merged icon layer ICON_CLONE_ID is not among them. */
  clones: string[];
}

export function placementRole(layer: LayerSpecification): PlacementRole | undefined {
  const meta = (layer as { metadata?: Record<string, unknown> }).metadata;
  const role = meta?.[PLACEMENT_KEY];
  return role === "displace" || role === "fixed" ? role : undefined;
}

export function managedLayers(layers: readonly LayerSpecification[]): ManagedLayer[] {
  const out: ManagedLayer[] = [];
  for (const spec of layers) {
    const role = placementRole(spec);
    if (!role) continue;
    if (role === "displace" && spec.type !== "symbol") {
      throw new Error(`${spec.id}: "displace" gilt nur für Symbol-Layer`);
    }
    if (role === "fixed" && spec.type !== "symbol" && spec.type !== "circle") {
      throw new Error(`${spec.id}: "fixed" gilt nur für Symbol- und Kreis-Layer`);
    }
    out.push({ id: spec.id, role, spec, clones: role === "displace" ? cloneIds(spec) : [] });
  }
  return out;
}

/** The merged icon layer of all displaced layers. */
export const ICON_CLONE_ID = `${PLACEMENT_PREFIX}icons`;
/** Id of the name clone of a displaced layer. */
export const nameCloneId = (id: string) => `${PLACEMENT_PREFIX}${id}-name`;
const leaderId = (id: string) => `${PLACEMENT_PREFIX}${id}-leader`;
const anchorId = (id: string) => `${PLACEMENT_PREFIX}${id}-anchor`;
const sourceId = (id: string) => `${PLACEMENT_PREFIX}${id}-source`;

function hasText(spec: LayerSpecification): boolean {
  return spec.type === "symbol" && spec.layout?.["text-field"] !== undefined;
}

function cloneIds(spec: LayerSpecification): string[] {
  const ids = [leaderId(spec.id), anchorId(spec.id), sourceId(spec.id)];
  if (hasText(spec)) ids.push(nameCloneId(spec.id));
  return ids;
}

function pick(obj: Record<string, unknown> | undefined, keep: (k: string) => boolean) {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => keep(k)));
}

const roleFilter = (layerId: string, role: FeatureRole) =>
  ["all", ["==", ["get", P_ROLE], role], ["==", ["get", P_LAYER], layerId]] as const;

type Visibility = "visible" | "none";

function visibilityOf(spec: LayerSpecification): Visibility {
  return (spec.layout as { visibility?: Visibility } | undefined)?.visibility ?? "visible";
}

type Layout = Record<string, unknown>;
const layerIs = (id: string) => ["==", ["get", P_LAYER], id] as const;

/** A literal array (e.g. an offset) must be wrapped to be usable inside "case". */
const asExpression = (v: unknown): unknown =>
  Array.isArray(v) && typeof v[0] !== "string" ? ["literal", v] : v;

type Spec = { default?: unknown };
const LAYOUT_SYMBOL = (latest as unknown as { layout_symbol: Record<string, Spec> }).layout_symbol;

/**
 * One property of the merged icon layer: the common value if all layers agree, otherwise a
 * "case" on the feature's source layer (`_layer`). A layer without the property gets the spec
 * default. Zoom expressions cannot sit inside "case": properties with a zoom curve (icon-size)
 * must be equal in all layers (style/sizes.ts does that).
 */
function merged(
  key: string,
  specs: readonly { id: string; values: Layout }[],
  fallback: unknown,
): unknown {
  const values = specs.map((s) => asExpression(s.values[key] ?? fallback));
  if (values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]))) return values[0];
  const branches = specs.slice(0, -1).flatMap((s, i) => [layerIs(s.id), values[i]]);
  return ["case", ...branches, values[values.length - 1]];
}

/**
 * Icons of all displaced layers in ONE symbol layer. Icons are always overlap-allowed, so the
 * sort key only sets the draw order (ascending = later on top); negated, the most important
 * symbols (lowest rank) lie on top where the displacement had to give up. In one layer this holds
 * across all source layers, which separate clone layers could not do.
 */
function mergedIconClone(
  specs: readonly SymbolLayerSpecification[],
  vis: Visibility,
): SymbolLayerSpecification {
  const own = specs.map((spec) => ({
    id: spec.id,
    values: pick(
      spec.layout as Layout,
      (k) => k.startsWith("icon-") || k.startsWith("symbol-"),
    ) as Layout,
    paint: pick(spec.paint as Layout, (k) => k.startsWith("icon-")),
  }));
  const keys = new Set(own.flatMap((o) => Object.keys(o.values)));
  const layout: Layout = {};
  for (const key of keys) {
    layout[key] = merged(key, own, LAYOUT_SYMBOL[key]?.default);
  }
  if (layout["symbol-sort-key"] !== undefined) {
    layout["symbol-sort-key"] = ["*", -1, merged("symbol-sort-key", own, 0)];
  }
  const paintKeys = new Set(own.flatMap((o) => Object.keys(o.paint)));
  const paint: Layout = {};
  for (const key of paintKeys)
    paint[key] = merged(
      key,
      own.map((o) => ({ id: o.id, values: o.paint })),
      undefined,
    );
  return {
    id: ICON_CLONE_ID,
    type: "symbol",
    source: PLACEMENT_SOURCE,
    filter: ["==", ["get", P_ROLE], "symbol"] as never,
    layout: {
      ...layout,
      "symbol-z-order": "auto",
      "symbol-placement": "point",
      "icon-allow-overlap": true,
      // Icons stay in the collision index: every label placed later avoids them.
      "icon-ignore-placement": false,
      "icon-padding": 0,
      visibility: vis,
    } as SymbolLayerSpecification["layout"],
    paint: paint as SymbolLayerSpecification["paint"],
  };
}

function nameClone(spec: SymbolLayerSpecification, vis: Visibility): SymbolLayerSpecification {
  const layout = pick(
    spec.layout as Record<string, unknown>,
    (k) => (k.startsWith("text-") && k !== "text-optional") || k.startsWith("symbol-"),
  );
  return {
    id: nameCloneId(spec.id),
    type: "symbol",
    source: PLACEMENT_SOURCE,
    filter: roleFilter(spec.id, "symbol") as never,
    layout: {
      ...layout,
      "symbol-placement": "point",
      "text-allow-overlap": false,
      visibility: vis,
    } as SymbolLayerSpecification["layout"],
    paint: pick(spec.paint as Record<string, unknown>, (k) => k.startsWith("text-")),
  };
}

function leaderLayers(spec: LayerSpecification, vis: Visibility): LayerSpecification[] {
  const leader: LineLayerSpecification = {
    id: leaderId(spec.id),
    type: "line",
    source: PLACEMENT_SOURCE,
    filter: roleFilter(spec.id, "leader") as never,
    layout: { "line-cap": "round", visibility: vis },
    paint: { "line-color": LEADER_COLOR, "line-width": mm(LEADER_WIDTH_MM) },
  };
  const anchor: CircleLayerSpecification = {
    id: anchorId(spec.id),
    type: "circle",
    source: PLACEMENT_SOURCE,
    filter: roleFilter(spec.id, "anchor") as never,
    layout: { visibility: vis },
    paint: { "circle-color": LEADER_COLOR, "circle-radius": mm(ANCHOR_RADIUS_MM) },
  };
  return [leader, anchor];
}

/** Draws nothing, but keeps the original layer's source and source layer loading in print mode. */
function keepAliveLayer(spec: SymbolLayerSpecification, vis: Visibility): CircleLayerSpecification {
  return {
    id: sourceId(spec.id),
    type: "circle",
    source: spec.source,
    ...(spec["source-layer"] !== undefined ? { "source-layer": spec["source-layer"] } : {}),
    ...(spec.minzoom !== undefined ? { minzoom: spec.minzoom } : {}),
    ...(spec.maxzoom !== undefined ? { maxzoom: spec.maxzoom } : {}),
    filter: ["literal", false] as never,
    layout: { visibility: vis },
    paint: { "circle-radius": 0, "circle-opacity": 0 },
  };
}

export const EMPTY_COLLECTION: FeatureCollection<Geometry> = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Adds the placement source and clone layers to a built style.
 * `active`: print mode (originals hidden, clones visible) or screen mode (the reverse).
 */
export function withPlacementLayers(
  style: StyleSpecification,
  active: boolean,
): { style: StyleSpecification; managed: ManagedLayer[] } {
  const managed = managedLayers(style.layers);
  const displaced = managed.filter((m) => m.role === "displace");
  if (displaced.length === 0) return { style, managed };

  const layers: LayerSpecification[] = [];
  const top: LayerSpecification[] = [];
  const iconSpecs: SymbolLayerSpecification[] = [];
  let iconsVisible = false;
  for (const spec of style.layers) {
    const m = displaced.find((d) => d.id === spec.id);
    if (!m) {
      layers.push(spec);
      continue;
    }
    const symbol = spec as SymbolLayerSpecification;
    const vis = visibilityOf(spec);
    const off: Visibility = "none";
    layers.push({ ...symbol, layout: { ...symbol.layout, visibility: active ? off : vis } });
    if (hasText(spec)) layers.push(nameClone(symbol, active ? vis : off));
    top.push(...leaderLayers(spec, active ? vis : off), keepAliveLayer(symbol, active ? vis : off));
    iconSpecs.push(symbol);
    if (vis === "visible") iconsVisible = true;
  }
  const icons = [mergedIconClone(iconSpecs, active && iconsVisible ? "visible" : "none")];
  // Leaders, anchors and icons go below the first "fixed" symbol layer (settlement names), or to
  // the very top: those are placed before the icons and keep their spot; every other label is
  // placed after the icons and avoids them.
  const at = layers.findIndex((l) => l.type === "symbol" && placementRole(l) === "fixed");
  const insertAt = at < 0 ? layers.length : at;
  layers.splice(insertAt, 0, ...top, ...icons);

  return {
    style: {
      ...style,
      sources: {
        ...style.sources,
        [PLACEMENT_SOURCE]: { type: "geojson", data: EMPTY_COLLECTION, tolerance: 0 },
      },
      layers,
    },
    managed,
  };
}
