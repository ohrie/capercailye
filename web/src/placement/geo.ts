// Web-Mercator <-> paper millimetres at a fixed map zoom (512 px tiles, 1 CSS px = 1/96 inch).
// Positions are global (not relative to a map centre), so the main map and the export map
// compute identical coordinates for the same feature at the same zoom.
import { MM_PER_PX } from "../style/units";

const TILE = 512;

/** Global paper position (mm) of a lng/lat at `zoom`. */
export function lngLatToMm(lng: number, lat: number, zoom: number): [number, number] {
  const world = TILE * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * world;
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
  return [x * MM_PER_PX, y * MM_PER_PX];
}

export function mmToLngLat(x: number, y: number, zoom: number): [number, number] {
  const world = TILE * 2 ** zoom;
  const px = x / MM_PER_PX / world;
  const py = y / MM_PER_PX / world;
  const lng = px * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * py))) * 180) / Math.PI;
  return [lng, lat];
}

/** Axis-aligned rectangle in global paper mm. */
export interface RectMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Rectangle of `widthMm` x `heightMm` centred on a lng/lat. */
export function rectAround(
  center: [number, number],
  zoom: number,
  widthMm: number,
  heightMm: number,
): RectMm {
  const [cx, cy] = lngLatToMm(center[0], center[1], zoom);
  return {
    minX: cx - widthMm / 2,
    minY: cy - heightMm / 2,
    maxX: cx + widthMm / 2,
    maxY: cy + heightMm / 2,
  };
}

export function inRect(r: RectMm, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

/** Tile coordinates of the waymark/POI tile reader: zoom 12, 4096 units per tile. */
export const TILE_ZOOM = 12;
export const TILE_EXTENT_UNITS = 4096;

/**
 * Paper position (mm at map zoom `zoom`) of a global tile coordinate: `gx = tx * extent + x` of a
 * tile of zoom `tileZoom` (Web-Mercator is linear in these units).
 */
export function tileUnitsToMm(
  gx: number,
  gy: number,
  zoom: number,
  tileZoom = TILE_ZOOM,
  extent = TILE_EXTENT_UNITS,
): [number, number] {
  const k = (TILE * 2 ** zoom * MM_PER_PX) / (extent * 2 ** tileZoom);
  return [gx * k, gy * k];
}

/** Inclusive range of tile indices (zoom `tileZoom`) covering a paper rectangle at `zoom`. */
export function tileRangeForRect(
  r: RectMm,
  zoom: number,
  tileZoom = TILE_ZOOM,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const n = 2 ** tileZoom;
  const world = TILE * 2 ** zoom * MM_PER_PX;
  const index = (v: number) => Math.min(n - 1, Math.max(0, Math.floor((v / world) * n)));
  return {
    minX: index(r.minX),
    minY: index(r.minY),
    maxX: index(r.maxX),
    maxY: index(r.maxY),
  };
}

/** Rectangle grown by `m` on every side. */
export function growRect(r: RectMm, m: number): RectMm {
  return { minX: r.minX - m, minY: r.minY - m, maxX: r.maxX + m, maxY: r.maxY + m };
}
