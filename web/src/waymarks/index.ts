// Waymark signs along the routes (PLAN.md 3 / 4a): computation and map controller.
//
// The app places the signs itself instead of MapLibre's line placement:
//   tiles.ts   z12 `routes` (and `poi`) tiles straight from the PMTiles file
//   signs.ts   one sign per distinct sign of a piece's routes (routes with equal signs are one)
//   graph.ts   pieces -> edges between real forks (three or more branches with signs)
//   plan.ts    positions along the edges (free stretch, away from forks, mandatory signs per edge,
//              repeats over forks), no overlap
// The result is a GeoJSON point source (`waymark-signs`, one image per point, drawn by the layer
// `waymarks-signs` with allow-overlap, since overlap-freedom is already computed) and the boxes of
// the signs, which the print placement takes as obstacles: signs are set BEFORE the pictograms,
// the pictograms move off them.
//
// In print view and for the export the plan is computed ONCE for the whole sheet layout (region
// of all sheets plus bleed, at the layout zoom); the preview and every export page use that one
// result, so the overlaps of neighbouring sheets are identical. The same pass thins the urban
// restaurants/cafés, toilets and hotels greedily over the layout (`urban`, placement/thin.ts), also
// while "Wanderrouten" is off (then there are no signs). Outside the print view
// the same computation runs for the current viewport at the current zoom (paper mm = screen mm).
import type { FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Obstacle } from "../placement/displace";
import { inRect, lngLatToMm, mmToLngLat, type RectMm, tileUnitsToMm } from "../placement/geo";
import type { UrbanKeep } from "../placement/collect";
import { greedyThin } from "../placement/thin";
import { WAYMARK_MIN_ZOOM } from "../style/routes";
import { WAYMARK_SOURCE } from "../style/sources";
import { buildEdges, type Piece } from "./graph";
import { type PlanEdge, type PlanStats, planWithStats } from "./plan";
import { type RouteInfo, routesOn } from "./routes";
import { type SignSpec, signsForRoutes, signSizeFactor } from "./signs";
import { loadRegionData, urbanItems, type RegionData, WAYMARK_MARGIN_MM } from "./tiles";

export { WAYMARK_MIN_ZOOM };

export interface WaymarkRequest {
  pmtilesUrl: string;
  /** Region in global paper mm at `zoom`: only signs touching it are returned. */
  region: RectMm;
  zoom: number;
  visibility: Readonly<Record<string, boolean>>;
}

export interface WaymarkResult {
  /** One point per sign, property `img` = image id. */
  data: FeatureCollection<Point>;
  /** Boxes of the signs (global paper mm): obstacles for the pictograms. */
  boxes: Obstacle[];
  /** Identity of the inputs (URL, region, zoom, "Wanderrouten" switch, network switches). */
  key: string;
  /** Urban restaurants/cafés, toilets and hotels that stay, for the region plus margin; absent without data. */
  urban?: UrbanKeep;
  /** Number of signs placed / dropped for lack of room (statistics). */
  placed: number;
  dropped: number;
}

const EMPTY: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

function emptyResult(key: string): WaymarkResult {
  return { data: EMPTY, boxes: [], key, placed: 0, dropped: 0 };
}

function intersects(a: RectMm, b: RectMm): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** The plan (and its statistics) for loaded data: signs of the whole loaded area. */
export function waymarkPlan(data: RegionData, zoom: number): PlanStats {
  const factor = signSizeFactor(zoom);
  const toMm = (gx: number, gy: number) => tileUnitsToMm(gx, gy, zoom);
  // Relation ids -> sign keys, so that routes with the same sign are one for the graph. Pieces
  // without a visible sign do not count as a branch.
  const cache = new Map<string, SignSpec[]>();
  const specs = new Map<string, SignSpec>();
  const pieces: Piece[] = [];
  for (const p of data.pieces) {
    const cacheKey = p.routes.join("|");
    let signs = cache.get(cacheKey);
    if (!signs) {
      const infos = p.routes.map((id) => data.routes.get(id)).filter((r): r is RouteInfo => !!r);
      signs = signsForRoutes(infos, factor);
      cache.set(cacheKey, signs);
      // One spec per key: the most important network, then the smaller image id.
      for (const s of signs) {
        const old = specs.get(s.key);
        if (!old || s.rank < old.rank || (s.rank === old.rank && s.imageId < old.imageId)) {
          specs.set(s.key, s);
        }
      }
    }
    if (signs.length > 0) pieces.push({ coords: p.coords, keys: signs.map((s) => s.key) });
  }
  const plan: PlanEdge[] = buildEdges(pieces).map((e) => ({
    id: e.id,
    coords: e.coords.map(([x, y]) => toMm(x, y)),
    parts: e.parts.map((p) => ({ end: p.end, signs: p.keys.map((k) => specs.get(k)!) })),
    ring: e.ring,
    start: e.start,
    end: e.end,
  }));
  return planWithStats(plan);
}

/**
 * The computation on loaded data (pure). `placed` is the number of signs of the whole loaded area
 * (not only of the region), `dropped` the signs that found no free spot.
 */
export function waymarksFromData(
  data: RegionData,
  region: RectMm,
  zoom: number,
): Pick<WaymarkResult, "data" | "boxes" | "placed" | "dropped"> & { urban: UrbanKeep } {
  const toMm = (gx: number, gy: number) => tileUnitsToMm(gx, gy, zoom);
  const stats = waymarkPlan(data, zoom);
  const placed = stats.signs;
  const features: FeatureCollection<Point>["features"] = [];
  const boxes: Obstacle[] = [];
  for (const p of placed) {
    if (!intersects(p.box, region)) continue;
    boxes.push(p.box);
    features.push({
      type: "Feature",
      properties: { img: p.imageId },
      geometry: { type: "Point", coordinates: mmToLngLat(p.x, p.y, zoom) },
    });
  }
  const items = urbanItems(data.urban, toMm);
  const keepRegion = {
    minX: region.minX - WAYMARK_MARGIN_MM,
    minY: region.minY - WAYMARK_MARGIN_MM,
    maxX: region.maxX + WAYMARK_MARGIN_MM,
    maxY: region.maxY + WAYMARK_MARGIN_MM,
  };
  const inside = items.filter((i) => inRect(keepRegion, i.x, i.y));
  return {
    data: { type: "FeatureCollection", features },
    boxes,
    placed: placed.length,
    dropped: stats.mandatory.wanted + stats.repeats.wanted - placed.length,
    urban: { ids: greedyThin(inside), region: keepRegion },
  };
}

const NET_SWITCHES = ["net-iwn", "net-nwn", "net-rwn", "net-lwn"] as const;

/** Cache key: everything the result depends on (region to 0.01 mm). */
export function waymarkKey(req: WaymarkRequest): string {
  const r = req.region;
  const nets = [
    routesOn(req.visibility) ? 1 : 0,
    ...NET_SWITCHES.map((n) => (req.visibility[n] === false ? 0 : 1)),
  ].join("");
  return [
    req.pmtilesUrl,
    [r.minX, r.minY, r.maxX, r.maxY].map((v) => v.toFixed(2)).join(","),
    req.zoom.toFixed(6),
    nets,
  ].join("|");
}

const results = new Map<string, Promise<WaymarkResult>>();
const KEEP_RESULTS = 4;

/**
 * Signs (and the greedy urban decision) for a region. Zoom below WAYMARK_MIN_ZOOM: empty result
 * without `urban`; "Wanderrouten" off: no signs, the urban decision is still computed. The last few results are cached by key, so the export gets the
 * very result the preview used.
 */
export function computeWaymarks(req: WaymarkRequest): Promise<WaymarkResult> {
  const key = waymarkKey(req);
  const hit = results.get(key);
  if (hit) {
    results.delete(key);
    results.set(key, hit);
    return hit;
  }
  const promise = (async (): Promise<WaymarkResult> => {
    if (req.zoom < WAYMARK_MIN_ZOOM) return emptyResult(key);
    const data = await loadRegionData(req.pmtilesUrl, req.region, req.zoom, req.visibility);
    if (!data) return emptyResult(key);
    return { ...waymarksFromData(data, req.region, req.zoom), key };
  })();
  promise.catch(() => results.delete(key));
  results.set(key, promise);
  while (results.size > KEEP_RESULTS) results.delete(results.keys().next().value!);
  return promise;
}

export interface WaymarkHooks {
  /** Print view: region and zoom of the sheet layout; null outside the print view (viewport). */
  printRegion(): { region: RectMm; zoom: number } | null;
  visibility(): Readonly<Record<string, boolean>>;
  onResult(result: WaymarkResult): void;
}

const MOVE_DEBOUNCE_MS = 200;

/** Keeps the `waymark-signs` source of the live map up to date. */
export class WaymarkController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private run = 0;
  private appliedKey = "";

  constructor(
    private readonly map: MapLibreMap,
    private readonly pmtilesUrl: string,
    private readonly hooks: WaymarkHooks,
  ) {
    map.on("moveend", () => this.update());
  }

  /** Recomputes (debounced) for the print layout or the viewport; stale runs are discarded. */
  update(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.compute(), MOVE_DEBOUNCE_MS);
  }

  private request(): WaymarkRequest {
    const print = this.hooks.printRegion();
    if (print) {
      return {
        pmtilesUrl: this.pmtilesUrl,
        region: print.region,
        zoom: print.zoom,
        visibility: this.hooks.visibility(),
      };
    }
    const zoom = this.map.getZoom();
    const b = this.map.getBounds();
    const [minX, minY] = lngLatToMm(b.getWest(), b.getNorth(), zoom);
    const [maxX, maxY] = lngLatToMm(b.getEast(), b.getSouth(), zoom);
    return {
      pmtilesUrl: this.pmtilesUrl,
      region: { minX, minY, maxX, maxY },
      zoom,
      visibility: this.hooks.visibility(),
    };
  }

  private async compute(): Promise<void> {
    const run = ++this.run;
    let result: WaymarkResult;
    try {
      result = await computeWaymarks(this.request());
    } catch (err) {
      console.warn("Wegzeichen:", err);
      return;
    }
    if (run !== this.run) return;
    if (result.key !== this.appliedKey) {
      // The source may not exist yet while the style loads: try again with the next update.
      const source = this.map.getSource<GeoJSONSource>(WAYMARK_SOURCE);
      if (source) {
        source.setData(result.data);
        this.appliedKey = result.key;
      }
    }
    this.hooks.onResult(result);
  }
}
