// Renders one map image in a hidden MapLibre instance at print resolution.
import { type ErrorEvent, Map as MapLibreMap } from "maplibre-gl";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { m } from "../paraglide/messages.js";
import { installIcons } from "../icons";
import type { UrbanKeep } from "../placement/collect";
import type { Obstacle } from "../placement/displace";
import { PLACEMENT_SOURCE, placeForExport, rectAround, withPlacementLayers } from "../placement";
import {
  applyVectorTileZoom,
  CONTOUR_SOURCE,
  DEM_SOURCE,
  type VectorTileZoomMode,
} from "../style/sources";
import { BLEED_MM, mmToCssPx, type SizeMm } from "./paper";

export interface RenderRequest {
  style: StyleSpecification;
  center: [number, number];
  zoom: number;
  /** Final image size on paper (without bleed). */
  sizeMm: SizeMm;
  dpi: number;
  bleedMm?: number;
  timeoutMs?: number;
  /** Override of VECTOR_TILE_ZOOM (for comparisons). */
  vectorTileZoom?: VectorTileZoomMode;
  /** Print placement of symbols (default true; false = MapLibre collision, for comparisons). */
  placement?: boolean;
  /**
   * Boxes of the waymark signs of the whole sheet layout (waymarks/index.ts, global paper mm at
   * `zoom`): obstacles of the pictogram placement. The signs themselves are in the style.
   */
  waymarkObstacles?: readonly Obstacle[];
  /** Kept urban restaurants/cafés, toilets and hotels of the whole sheet layout (same computation as the signs). */
  urban?: UrbanKeep;
}

export interface RenderResult {
  /** Cropped image (bleed removed). */
  canvas: HTMLCanvasElement;
  /** Container size in CSS px (incl. bleed). */
  cssSize: [number, number];
  /** WebGL canvas size requested from the browser (device px, incl. bleed). */
  requestedCanvasPx: [number, number];
  /** Actual drawing buffer size (device px, incl. bleed). */
  actualCanvasPx: [number, number];
  /** Effective pixel ratio actually used (may be lower than dpi/96). */
  pixelRatio: number;
  effectiveDpi: number;
  /** True if the browser or MapLibre reduced the resolution. */
  reduced: boolean;
  renderMs: number;
  /** Errors of the DEM / contour sources (offline, timeout, 404); the render went on without them. */
  reliefErrors: number;
}

function waitForIdle(map: MapLibreMap, timeoutMs: number, sourceId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      map.off("idle", onIdle);
      reject(new Error(m.app_error_render_timeout({ seconds: timeoutMs / 1000 })));
    }, timeoutMs);
    const onIdle = () => {
      if (map.loaded() && map.areTilesLoaded() && (!sourceId || map.isSourceLoaded(sourceId))) {
        window.clearTimeout(timer);
        map.off("idle", onIdle);
        resolve();
      } else {
        map.triggerRepaint();
      }
    };
    map.on("idle", onIdle);
  });
}

export async function renderMapImage(req: RenderRequest): Promise<RenderResult> {
  const t0 = performance.now();
  const bleed = req.bleedMm ?? BLEED_MM;
  const pixelRatio = req.dpi / 96;
  const cssW = Math.ceil(mmToCssPx(req.sizeMm.width + 2 * bleed));
  const cssH = Math.ceil(mmToCssPx(req.sizeMm.height + 2 * bleed));

  const container = document.createElement("div");
  container.className = "export-container";
  container.style.width = `${cssW}px`;
  container.style.height = `${cssH}px`;
  document.body.appendChild(container);

  const placement = req.placement ?? true;
  const { style, managed } = withPlacementLayers(req.style, placement);

  const map = new MapLibreMap({
    container,
    style,
    center: req.center,
    zoom: req.zoom,
    bearing: 0,
    pitch: 0,
    pixelRatio,
    fadeDuration: 0,
    interactive: false,
    attributionControl: false,
    // Let the browser be the only limit; we detect reductions below.
    maxCanvasSize: [16384, 16384],
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
  });
  // Runtime SVG icons; the worker awaits them per tile, so "idle" below implies icons are in.
  installIcons(map);
  applyVectorTileZoom(map, req.vectorTileZoom);

  let reliefErrors = 0;
  try {
    map.on("error", (e: ErrorEvent) => {
      const sourceId = (e as { sourceId?: string }).sourceId;
      if (sourceId === DEM_SOURCE || sourceId === CONTOUR_SOURCE) reliefErrors++;
      console.warn("Export map:", e.error?.message ?? e);
    });
    await waitForIdle(map, req.timeoutMs ?? 120_000);
    if (placement && managed.length > 0) {
      // Same region as the preview: sheet + bleed around the centre (= this map's viewport).
      const region = rectAround(
        req.center,
        req.zoom,
        req.sizeMm.width + 2 * bleed,
        req.sizeMm.height + 2 * bleed,
      );
      placeForExport(map, managed, {
        zoom: req.zoom,
        region,
        options: { obstacles: req.waymarkObstacles ?? [] },
        urban: req.urban,
      });
      await waitForIdle(map, req.timeoutMs ?? 120_000, PLACEMENT_SOURCE);
    }

    const glCanvas = map.getCanvas();
    const gl = (glCanvas.getContext("webgl2") ?? glCanvas.getContext("webgl")) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    const bufW = gl ? gl.drawingBufferWidth : glCanvas.width;
    const bufH = gl ? gl.drawingBufferHeight : glCanvas.height;
    const requested: [number, number] = [
      Math.floor(cssW * pixelRatio),
      Math.floor(cssH * pixelRatio),
    ];
    const ratio = Math.min(bufW / cssW, bufH / cssH);
    const reduced = bufW < requested[0] - 1 || bufH < requested[1] - 1;

    // Crop the centred printable area out of the bleed.
    const pw = mmToCssPx(req.sizeMm.width);
    const ph = mmToCssPx(req.sizeMm.height);
    // Source coordinates are in canvas-element px; if the drawing buffer is smaller,
    // the browser scales it up to that size when it is used as an image source.
    const elRatio = glCanvas.width / cssW;
    // Integer source rectangle -> 1:1 pixel copy (no resampling) in the normal case.
    const sx = Math.round(((cssW - pw) / 2) * elRatio);
    const sy = Math.round(((cssH - ph) / 2) * elRatio);
    const sw = Math.round(pw * elRatio);
    const sh = Math.round(ph * elRatio);
    const outW = Math.round(pw * ratio);
    const outH = Math.round(ph * ratio);
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error(m.app_error_canvas());
    ctx.drawImage(glCanvas, sx, sy, sw, sh, 0, 0, outW, outH);

    return {
      canvas: out,
      cssSize: [cssW, cssH],
      requestedCanvasPx: requested,
      actualCanvasPx: [bufW, bufH],
      pixelRatio: ratio,
      effectiveDpi: ratio * 96,
      reduced,
      renderMs: performance.now() - t0,
      reliefErrors,
    };
  } finally {
    map.remove();
    container.remove();
  }
}
