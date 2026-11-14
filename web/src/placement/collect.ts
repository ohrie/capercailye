// Feeds the displacement with the features the managed layers would draw, and turns the result
// into GeoJSON for the placement source.
//
// Features come from the vector source (querySourceFeatures: every loaded tile, independent of
// the viewport and of layer visibility), deduplicated across tile buffers by feature id
// (features without id: by coordinate and name). Layers may come from different sources
// (`osm`, `busstops`); features are collected per source and source layer.
// Filters, minzoom and the icon layout (image, size, anchor, offset, sort key) are evaluated
// from the layer spec itself with the style-spec expression engine, so the selection per scale
// (minzoom, filters) and the icon boxes match exactly what MapLibre would draw.
// Before placing, urban restaurants/cafés, toilets and hotels (`urban=true`) are thinned by paper
// distance (thinUrban, thin.ts, PLAN.md 4a): greedy by rank per group (gastro, toilets, hotel), a
// place stays if no kept one of its group lies within 8 mm; dropped ones appear nowhere (neither
// symbol nor name), all other kinds are never thinned. The decision comes from the sheet layout's
// kept set (`PlacementRequest.urban`, computed once per layout in waymarks/index.ts) so preview and
// every export page agree; without it the greedy rule runs over the candidates themselves.
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  featureFilter,
  type LayerSpecification,
  latest,
  normalizePropertyExpression,
} from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import { svgForImageId } from "../icons/runtime";
import { MM_PER_PX } from "../style/units";
import {
  type Box,
  type PlaceItem,
  type PlaceOptions,
  type Placement,
  placedBoxes,
  placeSymbols,
} from "./displace";
import { inRect, lngLatToMm, mmToLngLat, type RectMm } from "./geo";
import { type FeatureRole, type ManagedLayer, P_LAYER, P_ROLE } from "./layers";
import { greedyThin, thinGroup, type ThinItem } from "./thin";

export interface SourceFeature {
  id?: string | number;
  properties: Record<string, unknown>;
  lngLat: [number, number];
}

export interface Candidate {
  item: PlaceItem;
  layer: ManagedLayer;
  feature: SourceFeature;
}

type Spec = { default?: unknown };
const LAYOUT_SYMBOL = (latest as unknown as { layout_symbol: Record<string, Spec> }).layout_symbol;
const PAINT_CIRCLE = (latest as unknown as { paint_circle: Record<string, Spec> }).paint_circle;

function evaluator(value: unknown, key: string, spec: Spec) {
  if (value === undefined) return () => spec.default;
  const expr = normalizePropertyExpression(value as never, key, spec as never);
  return (zoom: number, f: EvalFeature) => expr.evaluate({ zoom } as never, f as never);
}

interface EvalFeature {
  type: 1;
  id?: string | number;
  properties: Record<string, unknown>;
}

function anchorBox(anchor: string, w: number, h: number): Box {
  const minX = anchor.includes("left") ? 0 : anchor.includes("right") ? -w : -w / 2;
  const minY = anchor.includes("top") ? 0 : anchor.includes("bottom") ? -h : -h / 2;
  return { minX, minY, maxX: minX + w, maxY: minY + h };
}

function scaleBox(b: Box, f: number): Box {
  return { minX: b.minX * f, minY: b.minY * f, maxX: b.maxX * f, maxY: b.maxY * f };
}

/** Placement candidates of one managed layer at `zoom` (pure; uses the icon registry for sizes). */
export function evaluateLayer(
  layer: ManagedLayer,
  features: readonly SourceFeature[],
  zoom: number,
): Candidate[] {
  const spec = layer.spec as LayerSpecification & {
    minzoom?: number;
    maxzoom?: number;
    filter?: unknown;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
  };
  if (spec.minzoom !== undefined && zoom < spec.minzoom) return [];
  if (spec.maxzoom !== undefined && zoom >= spec.maxzoom) return [];
  const filter = featureFilter(spec.filter as never, `${spec.id}.filter`);
  const layout = spec.layout ?? {};
  const paint = spec.paint ?? {};
  const out: Candidate[] = [];

  if (spec.type === "circle") {
    const radius = evaluator(
      paint["circle-radius"],
      "circle-radius",
      PAINT_CIRCLE["circle-radius"]!,
    );
    const stroke = evaluator(
      paint["circle-stroke-width"],
      "circle-stroke-width",
      PAINT_CIRCLE["circle-stroke-width"]!,
    );
    for (const f of features) {
      const ef: EvalFeature = { type: 1, id: f.id, properties: f.properties };
      if (!filter.filter({ zoom } as never, ef as never)) continue;
      const r = (Number(radius(zoom, ef)) + Number(stroke(zoom, ef))) * MM_PER_PX;
      out.push(candidate(layer, f, zoom, { minX: -r, minY: -r, maxX: r, maxY: r }, 0));
    }
    return out;
  }

  const ev = (key: string) => evaluator(layout[key], key, LAYOUT_SYMBOL[key]!);
  const image = ev("icon-image");
  const size = ev("icon-size");
  const anchor = ev("icon-anchor");
  const offset = ev("icon-offset");
  const sortKey = ev("symbol-sort-key");
  const text = ev("text-field");
  const textSize = ev("text-size");
  const letterSpacing = ev("text-letter-spacing");
  const maxWidth = ev("text-max-width");
  const lineHeight = ev("text-line-height");
  const transform = ev("text-transform");
  for (const f of features) {
    const ef: EvalFeature = { type: 1, id: f.id, properties: f.properties };
    if (!filter.filter({ zoom } as never, ef as never)) continue;
    const img = image(zoom, ef) as { name?: string } | string | undefined;
    const name = typeof img === "string" ? img : img?.name;
    const svg = name ? svgForImageId(name) : undefined;
    let box: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    if (!svg && layer.role === "fixed" && layout["text-field"] !== undefined) {
      box = estimateTextBox(text(zoom, ef), {
        sizePx: Number(textSize(zoom, ef)),
        letterSpacingEm: Number(letterSpacing(zoom, ef)),
        maxWidthEm: Number(maxWidth(zoom, ef)),
        lineHeightEm: Number(lineHeight(zoom, ef)),
        uppercase: transform(zoom, ef) === "uppercase",
      });
    } else if (svg) {
      const s = Number(size(zoom, ef) ?? 1);
      const [ox, oy] = (offset(zoom, ef) as [number, number] | undefined) ?? [0, 0];
      const b = anchorBox(String(anchor(zoom, ef) ?? "center"), svg.width, svg.height);
      box = scaleBox(
        { minX: b.minX + ox, minY: b.minY + oy, maxX: b.maxX + ox, maxY: b.maxY + oy },
        s * MM_PER_PX,
      );
    }
    const key = sortKey(zoom, ef);
    out.push(candidate(layer, f, zoom, box, typeof key === "number" ? key : 0));
  }
  return out;
}

export interface TextMetrics {
  sizePx: number;
  letterSpacingEm: number;
  maxWidthEm: number;
  lineHeightEm: number;
  uppercase: boolean;
}

/** Mean advance of Noto Sans in em (lower case / capitals); an estimate is enough here. */
const ADVANCE_EM = 0.56;
const ADVANCE_UPPER_EM = 0.68;

/**
 * Approximate box (mm) of a centred point label. Used for "fixed" text layers (settlement
 * names), which are placed before the pictograms: icons then move off the name if they can.
 */
export function estimateTextBox(value: unknown, m: TextMetrics): Box {
  const str = String(
    (value as { sections?: { text: string }[] } | undefined)?.sections
      ?.map((s) => s.text)
      .join("") ??
      value ??
      "",
  ).trim();
  if (!str) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const advance = (m.uppercase ? ADVANCE_UPPER_EM : ADVANCE_EM) + m.letterSpacingEm;
  const lineEm = str.length * advance;
  const lines = Math.max(1, Math.ceil(lineEm / Math.max(m.maxWidthEm, 1)));
  const wEm = lines > 1 ? Math.min(lineEm / lines + 1, m.maxWidthEm) : lineEm;
  const hEm = lines * m.lineHeightEm;
  const w = wEm * m.sizePx * MM_PER_PX;
  const h = hEm * m.sizePx * MM_PER_PX;
  return { minX: -w / 2, minY: -h / 2, maxX: w / 2, maxY: h / 2 };
}

/**
 * Identity of a feature across tile buffers: its id (OSM tiles); features without id (the GTFS
 * bus stops) are told apart by coordinate (6 decimals, about 0.1 m) and name.
 */
export function featureKey(f: SourceFeature): string {
  if (f.id !== undefined && f.id !== null) return String(f.id);
  const name = f.properties.name ?? "";
  return `${f.lngLat[0].toFixed(6)},${f.lngLat[1].toFixed(6)},${String(name)}`;
}

function candidate(
  layer: ManagedLayer,
  f: SourceFeature,
  zoom: number,
  box: Box,
  priority: number,
): Candidate {
  const [x, y] = lngLatToMm(f.lngLat[0], f.lngLat[1], zoom);
  return {
    item: {
      id: `${layer.id}/${featureKey(f)}`,
      x,
      y,
      box,
      priority,
      fixed: layer.role === "fixed",
    },
    layer,
    feature: f,
  };
}

/** Loaded point features of a layer's source layer, deduplicated across tiles. */
export function sourceFeatures(map: MapLibreMap, spec: LayerSpecification): SourceFeature[] {
  const s = spec as { source?: string; "source-layer"?: string };
  if (!s.source || !map.getSource(s.source)) return [];
  const raw = map.querySourceFeatures(s.source, { sourceLayer: s["source-layer"] });
  const seen = new Map<string, SourceFeature>();
  for (const f of raw) {
    const g = f.geometry;
    const coords =
      g.type === "Point" ? g.coordinates : g.type === "MultiPoint" ? g.coordinates[0] : undefined;
    if (!coords) continue;
    const sf: SourceFeature = {
      id: f.id,
      properties: { ...f.properties },
      lngLat: [coords[0]!, coords[1]!],
    };
    const key = featureKey(sf);
    if (!seen.has(key)) seen.set(key, sf);
  }
  // Stable input order (querySourceFeatures follows tile order).
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, f]) => f);
}

export interface PlacementRequest {
  zoom: number;
  /** Sheet incl. bleed: placed first and alone, so preview and export agree exactly. */
  region: RectMm;
  /** Also place loaded features outside the region (preview), around the region result. */
  outside?: boolean;
  /** Whether a managed layer is switched on. */
  wanted: (layer: ManagedLayer) => boolean;
  options?: Partial<PlaceOptions>;
  /** Urban restaurants/cafés, toilets and hotels that stay (see UrbanKeep); without it greedy over the candidates. */
  urban?: UrbanKeep;
}

/**
 * Decision of the sheet layout on urban restaurants/cafés, toilets and hotels: feature ids
 * (`featureKey`) that stay, valid for everything inside `region`. Candidates outside it (preview,
 * beyond the sheet margin) are thinned greedily among themselves.
 */
export interface UrbanKeep {
  ids: ReadonlySet<string>;
  region: RectMm;
}

export interface PlacementResult {
  data: FeatureCollection<Geometry>;
  candidates: Candidate[];
  placements: Placement[];
}

/** Places all candidates: region first, then (optionally) the rest around it. */
export function placeCandidates(
  candidates: readonly Candidate[],
  req: Omit<PlacementRequest, "wanted">,
): Placement[] {
  const inside = candidates.filter((c) => inRect(req.region, c.item.x, c.item.y));
  const first = placeSymbols(
    inside.map((c) => c.item),
    req.options,
  );
  if (!req.outside) return first;
  const rest = candidates.filter((c) => !inRect(req.region, c.item.x, c.item.y));
  if (rest.length === 0) return first;
  const obstacles = placedBoxes(
    inside.map((c) => c.item),
    first,
  );
  const second = placeSymbols(
    rest.map((c) => c.item),
    { ...req.options, obstacles: [...(req.options?.obstacles ?? []), ...obstacles] },
  );
  return [...first, ...second];
}

/**
 * Drops urban restaurants/cafés, toilets and hotels that the greedy thinning does not keep (per
 * group, see `thinGroup`; higher rank first: `weight`, then `tags`, then id; missing values count
 * as 0). Inside `keep.region` the layout's kept set decides, elsewhere (and without `keep`) the
 * rule runs over the candidates. Others pass untouched, order kept.
 */
export function thinUrban(candidates: readonly Candidate[], keep?: UrbanKeep): Candidate[] {
  const items: ThinItem[] = [];
  const dropped = new Set<string>();
  for (const c of candidates) {
    const p = c.feature.properties;
    const group = p.urban === true ? thinGroup(p.kind) : undefined;
    if (group === undefined) continue;
    if (keep && inRect(keep.region, c.item.x, c.item.y)) {
      if (!keep.ids.has(featureKey(c.feature))) dropped.add(c.item.id);
      continue;
    }
    items.push({
      id: c.item.id,
      group,
      x: c.item.x,
      y: c.item.y,
      weight: Number(p.weight ?? 0),
      tags: Number(p.tags ?? 0),
    });
  }
  if (items.length >= 2) {
    const kept = greedyThin(items);
    for (const it of items) if (!kept.has(it.id)) dropped.add(it.id);
  }
  return dropped.size === 0 ? [...candidates] : candidates.filter((c) => !dropped.has(c.item.id));
}

function feature(
  role: FeatureRole,
  layerId: string,
  geometry: Geometry,
  props: Record<string, unknown> = {},
): Feature<Geometry> {
  return {
    type: "Feature",
    geometry,
    properties: { ...props, [P_ROLE]: role, [P_LAYER]: layerId },
  };
}

/** GeoJSON for the placement source: displaced symbols, leaders and anchor dots. */
export function placementData(
  candidates: readonly Candidate[],
  placements: readonly Placement[],
  zoom: number,
): FeatureCollection<Geometry> {
  const byId = new Map(candidates.map((c) => [c.item.id, c]));
  const features: Feature<Geometry>[] = [];
  for (const p of placements) {
    const c = byId.get(p.id);
    if (!c || c.layer.role !== "displace") continue;
    const { x, y } = c.item;
    const lid = c.layer.id;
    features.push(
      feature(
        "symbol",
        lid,
        { type: "Point", coordinates: mmToLngLat(x + p.dx, y + p.dy, zoom) },
        c.feature.properties,
      ),
    );
    if (p.leader) {
      features.push(
        feature("leader", lid, {
          type: "LineString",
          coordinates: [c.feature.lngLat, mmToLngLat(p.leader.x, p.leader.y, zoom)],
        }),
        feature("anchor", lid, { type: "Point", coordinates: c.feature.lngLat }),
      );
    }
  }
  return { type: "FeatureCollection", features };
}

/** Collects, places and converts in one go (browser). */
export function computePlacement(
  map: MapLibreMap,
  managed: readonly ManagedLayer[],
  req: PlacementRequest,
): PlacementResult {
  const candidates: Candidate[] = [];
  const cache = new Map<string, SourceFeature[]>();
  for (const layer of managed) {
    if (!req.wanted(layer)) continue;
    const s = layer.spec as { source?: string; "source-layer"?: string };
    const key = `${s.source}/${s["source-layer"] ?? ""}`;
    let feats = cache.get(key);
    if (!feats) cache.set(key, (feats = sourceFeatures(map, layer.spec)));
    candidates.push(...evaluateLayer(layer, feats, req.zoom));
  }
  const kept = thinUrban(candidates, req.urban);
  const placements = placeCandidates(kept, req);
  return { data: placementData(kept, placements, req.zoom), candidates: kept, placements };
}
