// Style side of the print placement (PLAN.md 4a). Pure: works on style specs, no DOM.
//
// Style layers opt in through metadata (see PLACEMENT_KEY):
//   "displace"  symbol layer whose icons must never be dropped. In print mode the layer is
//               hidden and replaced by clones on the GeoJSON source PLACEMENT_SOURCE, which
//               collect.ts fills with displaced points (+ leader lines):
//                 placement-<id>-icon    icons only, allow-overlap; at the top of the style, so
//                                        they are placed before every label and block them.
//                 placement-<id>-name    the layer's text only, normal collision, at the
//                                        original layer's position (same label priority as
//                                        before); a name that does not fit drops out.
//                 placement-<id>-leader  / -anchor: fine line and dot to the true location.
//                 placement-<id>-source  invisible circle layer on the original's source layer: a
//                                        vector source whose layers are all hidden loads no tiles
//                                        (MapLibre), and collect.ts reads the features from the
//                                        loaded tiles. Matters for sources that only feed displaced
//                                        layers (the GTFS `busstops` source).
//   "fixed"     symbol or circle layer that is drawn as it is (never moves) and only reserves
//               its space, e.g. peak dots.
//   "obstacle"  symbol layer that MapLibre places itself (line placement: the positions are only
//               known after MapLibre's placement), e.g. waymarks. It must sit above the icon clones
//               (it is placed before them). collect.ts reads its placed boxes from MapLibre's
//               collision index (rendered.ts) and the pictograms move off them like off "fixed".
// Outside print mode the original layers are shown with MapLibre's normal collision.
//
// "fixed" text-only symbol layers (settlement names) are placed before the icons, so they are never
// pushed out by pictograms; their estimated box is an obstacle the icons move away from.
//
// M3 waymarks ("obstacle", style/routes.ts): their layers sit in the "waymarks" group above
// everything; the icon clones are inserted below the first "obstacle" layer, so waymarks are placed
// even before the pictograms, are never removed by them, and the pictograms avoid them.
import type { FeatureCollection, Geometry } from "geojson";
import type {
  CircleLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { mm } from "../style/units";

export const PLACEMENT_KEY = "capercailye:placement";
export const PLACEMENT_SOURCE = "placement";
export const PLACEMENT_PREFIX = "placement-";

export type PlacementRole = "displace" | "fixed" | "obstacle";

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
  /** Clone layer ids (empty for "fixed"). */
  clones: string[];
}

export function placementRole(layer: LayerSpecification): PlacementRole | undefined {
  const meta = (layer as { metadata?: Record<string, unknown> }).metadata;
  const role = meta?.[PLACEMENT_KEY];
  return role === "displace" || role === "fixed" || role === "obstacle" ? role : undefined;
}

export function managedLayers(layers: readonly LayerSpecification[]): ManagedLayer[] {
  const out: ManagedLayer[] = [];
  for (const spec of layers) {
    const role = placementRole(spec);
    if (!role) continue;
    if (role === "displace" && spec.type !== "symbol") {
      throw new Error(`${spec.id}: "displace" gilt nur für Symbol-Layer`);
    }
    if (role === "obstacle" && spec.type !== "symbol") {
      throw new Error(`${spec.id}: "obstacle" gilt nur für Symbol-Layer`);
    }
    if (role === "fixed" && spec.type !== "symbol" && spec.type !== "circle") {
      throw new Error(`${spec.id}: "fixed" gilt nur für Symbol- und Kreis-Layer`);
    }
    out.push({ id: spec.id, role, spec, clones: role === "displace" ? cloneIds(spec) : [] });
  }
  return out;
}

const iconId = (id: string) => `${PLACEMENT_PREFIX}${id}-icon`;
const nameId = (id: string) => `${PLACEMENT_PREFIX}${id}-name`;
const leaderId = (id: string) => `${PLACEMENT_PREFIX}${id}-leader`;
const anchorId = (id: string) => `${PLACEMENT_PREFIX}${id}-anchor`;
const sourceId = (id: string) => `${PLACEMENT_PREFIX}${id}-source`;

function hasText(spec: LayerSpecification): boolean {
  return spec.type === "symbol" && spec.layout?.["text-field"] !== undefined;
}

function cloneIds(spec: LayerSpecification): string[] {
  const ids = [leaderId(spec.id), anchorId(spec.id), sourceId(spec.id), iconId(spec.id)];
  if (hasText(spec)) ids.push(nameId(spec.id));
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

function iconClone(spec: SymbolLayerSpecification, vis: Visibility): SymbolLayerSpecification {
  const layout = pick(
    spec.layout as Record<string, unknown>,
    (k) => k.startsWith("icon-") || k.startsWith("symbol-"),
  );
  // Icons always overlap-allowed, so the sort key only sets the draw order (ascending = later on
  // top). Negated, the important symbols lie on top where the displacement had to give up.
  const sortKey = layout["symbol-sort-key"];
  return {
    id: iconId(spec.id),
    type: "symbol",
    source: PLACEMENT_SOURCE,
    filter: roleFilter(spec.id, "symbol") as never,
    layout: {
      ...layout,
      ...(sortKey !== undefined ? { "symbol-sort-key": ["*", -1, sortKey] } : {}),
      "symbol-z-order": "auto",
      "symbol-placement": "point",
      "icon-allow-overlap": true,
      // Icons stay in the collision index: every label placed later avoids them.
      "icon-ignore-placement": false,
      "icon-padding": 0,
      visibility: vis,
    } as SymbolLayerSpecification["layout"],
    paint: pick(spec.paint as Record<string, unknown>, (k) => k.startsWith("icon-")),
  };
}

function nameClone(spec: SymbolLayerSpecification, vis: Visibility): SymbolLayerSpecification {
  const layout = pick(
    spec.layout as Record<string, unknown>,
    (k) => (k.startsWith("text-") && k !== "text-optional") || k.startsWith("symbol-"),
  );
  return {
    id: nameId(spec.id),
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
  const icons: LayerSpecification[] = [];
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
    icons.push(iconClone(symbol, active ? vis : off));
  }
  // Leaders, anchors and icons go below the first "obstacle" layer (waymarks) and below "fixed"
  // symbol layers (settlement names), or to the very top: those are placed before the icons and
  // keep their spot; every other label is placed after the icons and avoids them.
  const at = layers.findIndex((l) => {
    const role = placementRole(l);
    return role === "obstacle" || (l.type === "symbol" && role === "fixed");
  });
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
