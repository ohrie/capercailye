// MapLibre setup (worker, PMTiles protocol) plus a small log of requested vector tiles
// (used to verify which tile zoom MapLibre loads at the print zoom).
import { addProtocol, setWorkerUrl } from "maplibre-gl";
// MapLibre derives the worker URL from its own module URL, which breaks under
// Vite's dependency pre-bundling; point it at the shipped worker file instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { RequestParameters } from "maplibre-gl";
import { Protocol } from "pmtiles";

export interface TileRequest {
  z: number;
  x: number;
  y: number;
  time: number;
}

export const tileLog: TileRequest[] = [];
const MAX_LOG = 5000;

let registered = false;

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
}

/** Histogram {zoom: count} of tile requests since `since` (performance.now()). */
export function tileZoomHistogram(since = 0): Record<number, number> {
  const hist: Record<number, number> = {};
  for (const t of tileLog) if (t.time >= since) hist[t.z] = (hist[t.z] ?? 0) + 1;
  return hist;
}
