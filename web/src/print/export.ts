// Multi-sheet PDF export: every sheet is rendered in a hidden map at the common layout zoom
// and added to one PDF, in sheet order.
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { VectorTileZoomMode } from "../style/sources";
import { tileZoomHistogram } from "../tiles";
import type { SheetLayout } from "./layout";
import { type Orientation, printableArea, type SizeMm } from "./paper";
import { addSheetPage, createPdf, finishPdf, IMAGE_FORMAT, type PdfPageResult } from "./pdf";
import { renderMapImage } from "./render";
import { formatScale } from "./scale";

export interface ExportOptions {
  style: StyleSpecification;
  dpi: number;
  /** Source credits for the sheet margin (credits.ts `line`). */
  credits: string;
  vectorTileZoom?: VectorTileZoomMode;
  /** Checked before each sheet; the running sheet is finished first. */
  signal?: AbortSignal;
  /** Called before each sheet is rendered (1-based). */
  onProgress?: (number: number, total: number) => void;
}

export interface PageMeta {
  number: number;
  col: number;
  row: number;
  center: [number, number];
  imagePx: [number, number];
  actualCanvasPx: [number, number];
  effectiveDpi: number;
  reduced: boolean;
  /** Vector tile requests by zoom while this sheet rendered. */
  tileZooms: Record<number, number>;
  renderMs: number;
  /** DEM / contour tiles that failed to load (offline, timeout): this sheet has incomplete relief. */
  reliefErrors: number;
}

export interface ExportMeta {
  scale: number;
  zoom: number;
  orientation: Orientation;
  dpi: number;
  cols: number;
  rows: number;
  pageCount: number;
  pageMm: SizeMm;
  imageMm: PdfPageResult["imageMm"];
  /** Summed over all sheets. */
  reliefErrors: number;
  /** True if the browser reduced the resolution of any sheet. */
  reduced: boolean;
  /** Smallest effective dpi of all sheets. */
  effectiveDpi: number;
  totalMs: number;
  imageFormat: string;
  pages: PageMeta[];
}

export interface ExportResult {
  blob: Blob;
  meta: ExportMeta;
}

function abortError(): DOMException {
  return new DOMException("Export abgebrochen", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export async function exportLayout(
  layout: SheetLayout,
  opts: ExportOptions,
): Promise<ExportResult> {
  if (layout.tooLarge) {
    throw new Error(`Gebiet zu groß: ${layout.count} Seiten`);
  }
  const t0 = performance.now();
  const total = layout.sheets.length;
  const sizeMm = printableArea(layout.orientation);
  const doc = createPdf(
    layout.orientation,
    total > 1
      ? `capercailye ${formatScale(layout.scale)}, ${total} Seiten`
      : `capercailye ${formatScale(layout.scale)}`,
  );
  const pages: PageMeta[] = [];
  let pdfPage: PdfPageResult | undefined;

  for (const sheet of layout.sheets) {
    if (opts.signal?.aborted) throw abortError();
    opts.onProgress?.(sheet.number, total);
    const tPage = performance.now();
    const render = await renderMapImage({
      style: opts.style,
      center: sheet.center,
      zoom: layout.zoom,
      sizeMm,
      dpi: opts.dpi,
      vectorTileZoom: opts.vectorTileZoom,
    });
    const tileZooms = tileZoomHistogram(tPage);
    pdfPage = addSheetPage(
      doc,
      {
        image: render.canvas,
        orientation: layout.orientation,
        scale: layout.scale,
        credits: opts.credits,
        sheet:
          total > 1
            ? {
                number: sheet.number,
                total,
                col: sheet.col,
                row: sheet.row,
                cols: layout.cols,
                rows: layout.rows,
                neighbours: sheet.neighbours,
              }
            : undefined,
      },
      sheet.number === 1,
    );
    const imagePx: [number, number] = [render.canvas.width, render.canvas.height];
    // Release the pixels now: several A4 canvases at 300 dpi add up quickly.
    render.canvas.width = render.canvas.height = 0;
    pages.push({
      number: sheet.number,
      col: sheet.col,
      row: sheet.row,
      center: sheet.center,
      imagePx,
      actualCanvasPx: render.actualCanvasPx,
      effectiveDpi: render.effectiveDpi,
      reduced: render.reduced,
      tileZooms,
      renderMs: render.renderMs,
      reliefErrors: render.reliefErrors,
    });
  }
  if (!pdfPage) throw new Error("Keine Seiten zu exportieren");

  return {
    blob: finishPdf(doc),
    meta: {
      scale: layout.scale,
      zoom: layout.zoom,
      orientation: layout.orientation,
      dpi: opts.dpi,
      cols: layout.cols,
      rows: layout.rows,
      pageCount: total,
      pageMm: pdfPage.pageMm,
      imageMm: pdfPage.imageMm,
      reliefErrors: pages.reduce((n, p) => n + p.reliefErrors, 0),
      reduced: pages.some((p) => p.reduced),
      effectiveDpi: Math.min(...pages.map((p) => p.effectiveDpi)),
      totalMs: performance.now() - t0,
      imageFormat: IMAGE_FORMAT,
      pages,
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
