// Boxes of symbols that MapLibre places itself (layers with role "obstacle", e.g. the waymarks
// along the route lines): their positions only exist after MapLibre's own placement, so they are
// read back from MapLibre's collision index and handed to the displacement as obstacles.
//
// This uses MapLibre internals (map.style.placement.collisionIndex.grid and the tile buckets);
// there is no public API for placed symbol positions. Written against maplibre-gl 6.18. If the
// structure is not found, the function returns no boxes and warns once: pictograms then simply do
// not avoid the waymarks (they are still drawn, nothing drops out).
//
// Stability: "obstacle" layers sit above the icon clones and are placed first, so their boxes do
// not depend on the pictograms; the boxes read after one placement stay valid after the
// placement source got its new data.
import type { Map as MapLibreMap } from "maplibre-gl";
import { MM_PER_PX } from "../style/units";
import type { Obstacle } from "./displace";
import { lngLatToMm } from "./geo";
import type { ManagedLayer } from "./layers";

/** MapLibre's collision grid extends 100 px beyond the viewport on every side (CollisionIndex). */
const GRID_OFFSET_PX = 100;

interface GridLike {
  boxKeys: ({ bucketInstanceId?: number } | null)[];
  bboxes: number[];
}

interface TileLike {
  buckets?: Record<string, { bucketInstanceId?: number } | undefined>;
}

interface TileManagerLike {
  getRenderableIds(): (string | number)[];
  getTileByID(id: string | number): TileLike | undefined;
}

interface MapInternals {
  style?: {
    placement?: { collisionIndex?: { grid?: GridLike } };
    tileManagers?: Record<string, TileManagerLike | undefined>;
  };
}

let warned = false;
function warnOnce(msg: string): void {
  if (warned) return;
  warned = true;
  console.warn(`Druck-Platzierung: ${msg}; Piktogramme weichen den Wegzeichen nicht aus.`);
}

/** `icon-padding` of a layer in CSS px if it is a plain number (or [n]), else 0. */
export function iconPaddingPx(layer: ManagedLayer): number {
  const p = (layer.spec.layout as Record<string, unknown> | undefined)?.["icon-padding"];
  if (typeof p === "number") return p;
  if (Array.isArray(p) && p.length === 1 && typeof p[0] === "number") return p[0];
  return 0;
}

/**
 * Placed boxes (global paper mm, without `icon-padding`) of the given "obstacle" layers in the
 * map's last completed placement. Call when the map is idle.
 */
export function renderedObstacles(
  map: MapLibreMap,
  layers: readonly ManagedLayer[],
  zoom: number,
): Obstacle[] {
  if (layers.length === 0) return [];
  const internals = map as unknown as MapInternals;
  const grid = internals.style?.placement?.collisionIndex?.grid;
  const managers = internals.style?.tileManagers;
  if (!grid || !Array.isArray(grid.boxKeys) || !Array.isArray(grid.bboxes) || !managers) {
    warnOnce("MapLibre-Kollisionsindex nicht gefunden");
    return [];
  }

  // Bucket instance id -> padding (px) of the obstacle layer the bucket belongs to.
  const buckets = new Map<number, number>();
  for (const layer of layers) {
    const source = (layer.spec as { source?: string }).source;
    const manager = source ? managers[source] : undefined;
    if (!manager || typeof manager.getRenderableIds !== "function") continue;
    const pad = iconPaddingPx(layer);
    for (const id of manager.getRenderableIds()) {
      const bucket = manager.getTileByID(id)?.buckets?.[layer.id];
      if (bucket?.bucketInstanceId !== undefined) buckets.set(bucket.bucketInstanceId, pad);
    }
  }
  if (buckets.size === 0) return [];

  const origin = map.unproject([0, 0]);
  const [ox, oy] = lngLatToMm(origin.lng, origin.lat, zoom);
  const out: Obstacle[] = [];
  grid.boxKeys.forEach((key, i) => {
    const pad = key?.bucketInstanceId !== undefined ? buckets.get(key.bucketInstanceId) : undefined;
    if (pad === undefined) return;
    const [x1, y1, x2, y2] = grid.bboxes.slice(i * 4, i * 4 + 4) as [
      number,
      number,
      number,
      number,
    ];
    out.push({
      minX: ox + (x1 + pad - GRID_OFFSET_PX) * MM_PER_PX,
      minY: oy + (y1 + pad - GRID_OFFSET_PX) * MM_PER_PX,
      maxX: ox + (x2 - pad - GRID_OFFSET_PX) * MM_PER_PX,
      maxY: oy + (y2 - pad - GRID_OFFSET_PX) * MM_PER_PX,
    });
  });
  return out;
}
