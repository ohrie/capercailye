// MapLibre setup (worker, PMTiles protocol) plus a small log of requested vector tiles
// (used to verify which tile zoom MapLibre loads at the print zoom).
// Relief runs through maplibre-contour: its single DemSource serves both the hillshade
// (dem-shared://) and the contour lines (dem-contour://), so they share the DEM cache and the
// fetch timeout. The DemSource starts a worker, so it lives here and never in src/style/.
import { addProtocol, setWorkerUrl } from "maplibre-gl";
import mlcontour from "maplibre-contour";
// MapLibre derives the worker URL from its own module URL, which breaks under
// Vite's dependency pre-bundling; point it at the shipped worker file instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { RequestParameters } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { DEM_MAXZOOM, DEM_TILES, RELIEF_TIMEOUT_MS } from "./config";
import { CONTOUR_OPTIONS, type ReliefUrls } from "./style/sources";

export interface TileRequest {
  z: number;
  x: number;
  y: number;
  time: number;
}

export const tileLog: TileRequest[] = [];
const MAX_LOG = 5000;

let registered = false;
let relief: ReliefUrls | undefined;

export function setupMapLibre(): void {
  if (registered) return;
  registered = true;
  setWorkerUrl(workerUrl);
  const protocol = new Protocol();
  addProtocol("pmtiles", (params: RequestParameters, abort: AbortController) => {
    const m = /\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
    if (m) {
      tileLog.push({ z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), time: performance.now() });
      if (tileLog.length > MAX_LOG) tileLog.splice(0, tileLog.length - MAX_LOG);
    }
    return protocol.tile(params, abort);
  });
  // Only one DemSource may exist (a second one would register under another protocol prefix).
  const dem = new mlcontour.DemSource({
    url: DEM_TILES,
    encoding: "terrarium",
    maxzoom: DEM_MAXZOOM,
    worker: true,
    timeoutMs: RELIEF_TIMEOUT_MS,
    cacheSize: 100,
  });
  dem.setupMaplibre({ addProtocol });
  relief = {
    dem: dem.sharedDemProtocolUrl,
    contours: dem.contourProtocolUrl({
      ...CONTOUR_OPTIONS,
      // The library wants mutable arrays; CONTOUR_OPTIONS is readonly.
      thresholds: Object.fromEntries(
        Object.entries(CONTOUR_OPTIONS.thresholds).map(([z, t]) => [z, [...t]]),
      ),
    }),
  };
}

/** Tile URLs of hillshade and contour sources; valid after setupMapLibre(). */
export function reliefUrls(): ReliefUrls {
  if (!relief) throw new Error("setupMapLibre() zuerst aufrufen");
  return relief;
}

/** Histogram {zoom: count} of tile requests since `since` (performance.now()). */
export function tileZoomHistogram(since = 0): Record<number, number> {
  const hist: Record<number, number> = {};
  for (const t of tileLog) if (t.time >= since) hist[t.z] = (hist[t.z] ?? 0) + 1;
  return hist;
}
