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
