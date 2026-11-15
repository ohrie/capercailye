// Reads the `routes` and `poi` layers of the z12 tiles straight from the PMTiles file (browser and
// scripts), independent of what MapLibre has loaded: deterministic for a given region.
//
// Per tile the layers are decoded once and cached (LRU, independent of switches); the route filter
// is applied afterwards. Lines are clipped to the exact tile area [0, 4096]² (tile buffer gone) and
// converted to global z12 tile units (`gx = tx * 4096 + x`); pieces of neighbouring tiles then meet
// at the tile edge (waymarks/graph.ts joins them). Urban restaurants/cafés, toilets and hotels
// (`urban`, kinds of THIN_GROUPS) of the `poi` layer are read in the same pass for the greedy
// thinning (placement/thin.ts); they are delivered whether "Hiking routes" is on or not.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles } from "pmtiles";
import {
  growRect,
  TILE_EXTENT_UNITS,
  TILE_ZOOM,
  tileRangeForRect,
  type RectMm,
} from "../placement/geo";
import { thinGroup, type ThinItem } from "../placement/thin";
import { clipLineToTile } from "./clip";
import { routesFromProperties, routeVisible, routesOn, type RouteInfo } from "./routes";

export const WAYMARK_TILE_ZOOM = TILE_ZOOM;
/** Margin around the region that is read, so stretches are not cut inside the region (mm). */
export const WAYMARK_MARGIN_MM = 30;
export const MAX_WAYMARK_TILES = 400;
const CACHE_SIZE = 256;
const CONCURRENCY = 12;

/** Urban restaurant/café, toilet or hotel of the tiles, in global z12 tile units. */
export interface UrbanPoint {
  /** Feature id as string (same as `featureKey` in placement/collect.ts). */
  id: string;
  /** Thinning group (placement/thin.ts `thinGroup`). */
  group: string;
  gx: number;
  gy: number;
  weight: number;
  tags: number;
}

/** A line piece of the tiles with the ids of its visible routes (graph.ts joins them). */
export interface RoutePiece {
  coords: [number, number][];
  /** Relation ids of the visible routes in tile order. */
  routes: string[];
}

interface RawPiece {
  coords: [number, number][];
  routes: RouteInfo[];
}

interface DecodedTile {
  pieces: RawPiece[];
  urban: UrbanPoint[];
}

export interface RegionData {
  /** Pieces with the ids of their visible routes (tile order); empty while "Hiking routes" is off. */
  pieces: RoutePiece[];
  /** The visible routes by id. */
  routes: Map<string, RouteInfo>;
  /** Urban restaurants/cafés, toilets and hotels of all loaded tiles, deduplicated by id. */
  urban: UrbanPoint[];
}

const archives = new Map<string, PMTiles>();

/** One PMTiles instance per URL (header and directories are cached inside it). */
function archive(url: string): PMTiles {
  let a = archives.get(url);
  if (!a) archives.set(url, (a = new PMTiles(url)));
  return a;
}

/** Registers an archive under a URL (scripts that read a local file instead of fetching). */
export function registerArchive(url: string, pmtiles: PMTiles): void {
  archives.set(url, pmtiles);
}

const decoded = new Map<string, Promise<DecodedTile>>();

/** Decodes the layers of one z12 tile (global tile units); pure given the raw bytes. */
export function decodeTile(data: ArrayBuffer | Uint8Array, tx: number, ty: number): DecodedTile {
  const tile = new VectorTile(new PbfReader(data));
  const out: DecodedTile = { pieces: [], urban: [] };
  const ox = tx * TILE_EXTENT_UNITS;
  const oy = ty * TILE_EXTENT_UNITS;

  const routes = tile.layers["routes"];
  if (routes) {
    const scale = TILE_EXTENT_UNITS / routes.extent;
    for (let i = 0; i < routes.length; i++) {
      const f = routes.feature(i);
      if (f.type !== 2) continue;
      const infos = routesFromProperties(f.properties);
      if (infos.length === 0) continue;
      for (const part of f.loadGeometry()) {
        const line = part.map((p): [number, number] => [p.x, p.y]);
        for (const clipped of clipLineToTile(line, routes.extent)) {
          out.pieces.push({
            coords: clipped.map(([x, y]): [number, number] => [ox + x * scale, oy + y * scale]),
            routes: infos,
          });
        }
      }
    }
  }

  const poi = tile.layers["poi"];
  if (poi) {
    const scale = TILE_EXTENT_UNITS / poi.extent;
    for (let i = 0; i < poi.length; i++) {
      const f = poi.feature(i);
      const p = f.properties;
      if (f.type !== 1 || f.id === undefined || p["urban"] !== true) continue;
      const group = thinGroup(p["kind"]);
      if (group === undefined) continue;
      const pt = f.loadGeometry()[0]?.[0];
      if (!pt) continue;
      out.urban.push({
        id: String(f.id),
        group,
        gx: ox + pt.x * scale,
        gy: oy + pt.y * scale,
        weight: Number(p["weight"] ?? 0),
        tags: Number(p["tags"] ?? 0),
      });
    }
  }
  return out;
}

function loadTile(url: string, tx: number, ty: number): Promise<DecodedTile> {
  const key = `${url}/${WAYMARK_TILE_ZOOM}/${tx}/${ty}`;
  const hit = decoded.get(key);
  if (hit) {
    // Most recently used last.
    decoded.delete(key);
    decoded.set(key, hit);
    return hit;
  }
  const promise = (async () => {
    const res = await archive(url).getZxy(WAYMARK_TILE_ZOOM, tx, ty);
    return res ? decodeTile(res.data, tx, ty) : { pieces: [], urban: [] };
  })();
  promise.catch(() => decoded.delete(key));
  decoded.set(key, promise);
  while (decoded.size > CACHE_SIZE) decoded.delete(decoded.keys().next().value!);
  return promise;
}

/** Tiles (tx, ty) covering a region plus the margin. */
export function regionTiles(region: RectMm, zoom: number): [number, number][] {
  const r = tileRangeForRect(growRect(region, WAYMARK_MARGIN_MM), zoom, WAYMARK_TILE_ZOOM);
  const out: [number, number][] = [];
  for (let ty = r.minY; ty <= r.maxY; ty++)
    for (let tx = r.minX; tx <= r.maxX; tx++) out.push([tx, ty]);
  return out;
}

let warned = false;

/**
 * Pieces of the visible routes (and the urban restaurants/cafés, toilets and hotels, always) in the
 * z12 tiles of a region plus margin. `undefined` if the region needs more than MAX_WAYMARK_TILES tiles (warns once).
 */
export async function loadRegionData(
  pmtilesUrl: string,
  region: RectMm,
  zoom: number,
  visibility: Readonly<Record<string, boolean>>,
): Promise<RegionData | undefined> {
  const tiles = regionTiles(region, zoom);
  if (tiles.length > MAX_WAYMARK_TILES) {
    if (!warned) {
      warned = true;
      console.warn(`Waymarks: area needs ${tiles.length} tiles (limit ${MAX_WAYMARK_TILES}).`);
    }
    return undefined;
  }
  const loaded: DecodedTile[] = new Array(tiles.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < tiles.length; i = next++) {
      loaded[i] = await loadTile(pmtilesUrl, tiles[i]![0], tiles[i]![1]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, worker));

  const visible = new Map<string, boolean>();
  const routes = new Map<string, RouteInfo>();
  const pieces: RoutePiece[] = [];
  const urban = new Map<string, UrbanPoint>();
  const showRoutes = routesOn(visibility);
  for (const t of loaded) {
    for (const p of showRoutes ? t.pieces : []) {
      const ids: string[] = [];
      for (const r of p.routes) {
        let on = visible.get(r.id);
        if (on === undefined) {
          on = routeVisible(r, visibility);
          visible.set(r.id, on);
          if (on) routes.set(r.id, r);
        }
        if (on) ids.push(r.id);
      }
      if (ids.length > 0) pieces.push({ coords: p.coords, routes: ids });
    }
    for (const u of t.urban) if (!urban.has(u.id)) urban.set(u.id, u);
  }
  return { pieces, routes, urban: [...urban.values()] };
}

/** Urban points as thinning items in paper mm. */
export function urbanItems(
  points: readonly UrbanPoint[],
  toMm: (gx: number, gy: number) => [number, number],
): ThinItem[] {
  return points.map((g) => {
    const [x, y] = toMm(g.gx, g.gy);
    return { id: g.id, group: g.group, x, y, weight: g.weight, tags: g.tags };
  });
}

/** Clears the decoded-tile cache (tests, scripts). */
export function clearTileCache(): void {
  decoded.clear();
}
