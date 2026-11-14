// The distinct signs of a route list with their size on paper. Pure (no DOM, no MapLibre).
//
// One sign = one image: the image id is the existing osmc waymark id format with exactly one
// route, so the registered image provider draws a single plate (osmc/index.ts).
import { waymarkImageId } from "../osmc";
import { resolveSign, waymarkSvg } from "../osmc/render";
import { SMALL_SCALE_FACTOR, SMALL_SCALE_ZOOM } from "../style/sizes";
import { MM_PER_PX } from "../style/units";
import type { RouteInfo } from "./routes";

export interface SignSpec {
  /** Rendered sign identity (equal signs of several routes share it). */
  key: string;
  /** Image id for MapLibre ("waymark:…", one route). */
  imageId: string;
  widthMm: number;
  heightMm: number;
  /** Network rank of the route (iwn 0, nwn 1, rwn 2, lwn 3, other 4); lower = more important. */
  rank: number;
}

const NETWORK_RANK = ["iwn", "nwn", "rwn", "lwn"];

/** Size factor of symbols at a zoom (same rule as `iconSizeByScale`). */
export function signSizeFactor(zoom: number): number {
  return zoom < SMALL_SCALE_ZOOM ? SMALL_SCALE_FACTOR : 1;
}

/** Natural size in CSS px per image id. */
const sizeCache = new Map<string, { width: number; height: number } | null>();

function naturalSize(imageId: string, route: RouteInfo): { width: number; height: number } | null {
  let size = sizeCache.get(imageId);
  if (size === undefined) {
    const img = waymarkSvg([route]);
    size = img ? { width: img.width, height: img.height } : null;
    sizeCache.set(imageId, size);
  }
  return size;
}

/** Distinct signs of a route list in route order (tile order = network rank order). */
export function signsForRoutes(routes: readonly RouteInfo[], sizeFactor: number): SignSpec[] {
  const seen = new Set<string>();
  const out: SignSpec[] = [];
  for (const r of routes) {
    const sign = resolveSign({ osmc: r.osmc, ref: r.ref, colour: r.colour, name: r.name });
    if (!sign || seen.has(sign.key)) continue;
    const imageId = waymarkImageId({
      symbols: r.osmc,
      refs: r.ref,
      colours: r.colour,
      names: r.name,
    });
    const size = naturalSize(imageId, r);
    if (!size) continue;
    seen.add(sign.key);
    const rank = NETWORK_RANK.indexOf(r.network);
    out.push({
      key: sign.key,
      imageId,
      widthMm: size.width * MM_PER_PX * sizeFactor,
      heightMm: size.height * MM_PER_PX * sizeFactor,
      rank: rank < 0 ? NETWORK_RANK.length : rank,
    });
  }
  return out;
}
