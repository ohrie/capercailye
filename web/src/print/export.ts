// Single-sheet PDF export: hidden render at print zoom -> A4 PDF.
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { VectorTileZoomMode } from "../style/sources";
import { tileZoomHistogram } from "../tiles";
import { type Orientation, printableArea, type SizeMm } from "./paper";
import { composePdf, IMAGE_FORMAT } from "./pdf";
import { renderMapImage } from "./render";
import { zoomForScale } from "./scale";

export interface ExportOptions {
  center: [number, number];
  scale: number;
  orientation: Orientation;
  dpi: number;
  style: StyleSpecification;
  vectorTileZoom?: VectorTileZoomMode;
}

export interface ExportMeta {
  scale: number;
  orientation: Orientation;
  dpi: number;
  center: [number, number];
  zoom: number;
  pageMm: SizeMm;
  imageMm: SizeMm & { x: number; y: number };
  imagePx: [number, number];
  cssSize: [number, number];
  requestedCanvasPx: [number, number];
  actualCanvasPx: [number, number];
  effectiveDpi: number;
  reduced: boolean;
  imageFormat: string;
  /** Vector tile requests by zoom during the export render. */
  tileZooms: Record<number, number>;
  renderMs: number;
  totalMs: number;
}

export interface ExportResult {
  blob: Blob;
  meta: ExportMeta;
}

export async function exportPdf(opts: ExportOptions): Promise<ExportResult> {
  const t0 = performance.now();
  const zoom = zoomForScale(opts.scale, opts.center[1]);
  const sizeMm = printableArea(opts.orientation);
  const render = await renderMapImage({
    style: opts.style,
    center: opts.center,
    zoom,
    sizeMm,
    dpi: opts.dpi,
    vectorTileZoom: opts.vectorTileZoom,
  });
  const tileZooms = tileZoomHistogram(t0);
  const pdf = composePdf({
    image: render.canvas,
    orientation: opts.orientation,
    scale: opts.scale,
  });
  return {
    blob: pdf.blob,
    meta: {
      scale: opts.scale,
      orientation: opts.orientation,
      dpi: opts.dpi,
      center: opts.center,
      zoom,
      pageMm: pdf.pageMm,
      imageMm: pdf.imageMm,
      imagePx: [render.canvas.width, render.canvas.height],
      cssSize: render.cssSize,
      requestedCanvasPx: render.requestedCanvasPx,
      actualCanvasPx: render.actualCanvasPx,
      effectiveDpi: render.effectiveDpi,
      reduced: render.reduced,
      imageFormat: IMAGE_FORMAT,
      tileZooms,
      renderMs: render.renderMs,
      totalMs: performance.now() - t0,
    },
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function pdfFilename(scale: number, orientation: Orientation): string {
  return `capercailye-1-${scale}-${orientation === "portrait" ? "hoch" : "quer"}.pdf`;
}
