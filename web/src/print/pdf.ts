// Composes an A4 PDF page: map image placed in millimetres, sheet furniture as vectors.
import { jsPDF } from "jspdf";
import {
  LEGEND_STRIP_MM,
  MARGIN_MM,
  pageSize,
  printableArea,
  type Orientation,
  type SizeMm,
} from "./paper";
import { formatDistance, formatScale, scaleBarLength } from "./scale";

/** PNG keeps line work crisp; JPEG would be faster and smaller. */
export const IMAGE_FORMAT: "PNG" | "JPEG" = "PNG";
const JPEG_QUALITY = 0.92;

export interface SheetInfo {
  number: number;
  total: number;
  /** Position in the grid (0-based) and grid size, for the overview in the strip. */
  col: number;
  row: number;
  cols: number;
  rows: number;
  neighbours: { top?: number; right?: number; bottom?: number; left?: number };
}

export interface PdfPageInput {
  image: HTMLCanvasElement;
  orientation: Orientation;
  scale: number;
  /** Sheet number and neighbours; without it (one sheet) only the north arrow is drawn. */
  sheet?: SheetInfo;
  /** Source credits for the sheet margin (without data dates, see credits.ts `line`). */
  credits: string;
}

export interface PdfPageResult {
  pageMm: SizeMm;
  imageMm: SizeMm & { x: number; y: number };
}

const CHECK_LINE_MM = 100;
const SCALE_BAR_MAX_MM = 40;
const FRAME_LINE_MM = 0.25;
/** Strip furniture stays above this offset from the strip top (the credits line runs below). */
const STRIP_UPPER_MM = 7.2;
/** Distance of the neighbour markers from the frame, and the most they may reach out. */
const NEIGHBOUR_GAP_MM = 1.5;

export function createPdf(orientation: Orientation, title: string): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation, compress: true });
  doc.setProperties({ title, creator: "capercailye" });
  return doc;
}

/** Adds one sheet as a PDF page (the first one uses the page jsPDF created). */
export function addSheetPage(doc: jsPDF, input: PdfPageInput, first: boolean): PdfPageResult {
  const page = pageSize(input.orientation);
  const area = printableArea(input.orientation);
  if (!first) doc.addPage("a4", input.orientation);

  const x0 = MARGIN_MM;
  const y0 = MARGIN_MM;
  // The image is sized in mm, independent of its pixel count: the scale stays correct
  // even if the browser had to reduce the canvas resolution.
  if (IMAGE_FORMAT === "JPEG") {
    const data = input.image.toDataURL("image/jpeg", JPEG_QUALITY);
    doc.addImage(data, "JPEG", x0, y0, area.width, area.height, undefined, "NONE");
  } else {
    doc.addImage(input.image, "PNG", x0, y0, area.width, area.height, undefined, "FAST");
  }

  drawLegendStrip(doc, x0, y0, area, input.scale, input.credits, input.sheet);

  doc.setDrawColor(0);
  doc.setLineWidth(FRAME_LINE_MM);
  doc.rect(x0, y0, area.width, area.height, "S");

  if (input.sheet) drawNeighbours(doc, x0, y0, area, input.sheet.neighbours);

  return { pageMm: page, imageMm: { x: x0, y: y0, width: area.width, height: area.height } };
}

export function finishPdf(doc: jsPDF): Blob {
  return doc.output("blob");
}

/** North arrow: narrow triangle, left half black, "N" above. `x` is the left edge. */
function drawNorthArrow(doc: jsPDF, x: number, top: number): number {
  const w = 2.4;
  const cx = x + w / 2;
  const apexY = top + 3.1;
  const baseY = top + 7.1;
  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.15);
  doc.triangle(cx, apexY, x, baseY, x + w, baseY, "S");
  doc.triangle(cx, apexY, x, baseY, cx, baseY, "F");
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.text("N", cx, top + 2.6, { align: "center" });
  return x + w;
}

function drawLegendStrip(
  doc: jsPDF,
  x0: number,
  y0: number,
  area: SizeMm,
  scale: number,
  credits: string,
  sheet?: SheetInfo,
): void {
  const top = y0 + area.height - LEGEND_STRIP_MM;
  const left = x0 + 3;
  const right = x0 + area.width - 3;

  doc.setFillColor(255, 255, 255);
  doc.rect(x0, top, area.width, LEGEND_STRIP_MM, "F");
  doc.setDrawColor(0);
  doc.setLineWidth(0.15);
  doc.line(x0, top, x0 + area.width, top);

  // Left to right with a cursor: scale number, bar, north arrow, sheet number, grid overview.
  // The bar gets whatever is left up to the check line (at most SCALE_BAR_MAX_MM).
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const scaleText = formatScale(scale);
  const scaleWidth = doc.getTextWidth(scaleText);
  const arrowWidth = 2.4;
  let blattText = "";
  let blattWidth = 0;
  let grid: GridBox | undefined;
  if (sheet) {
    blattText = `Blatt ${sheet.number}`;
    doc.setFontSize(8);
    blattWidth = doc.getTextWidth(blattText);
    grid = gridBox(sheet);
  }
  const used =
    scaleWidth + 4 + 5 + arrowWidth + 3 + (sheet ? blattWidth + 4 + (grid?.width ?? 0) : 0);
  const room = right - CHECK_LINE_MM - 3 - left;
  const barMax = Math.min(SCALE_BAR_MAX_MM, room - used);

  doc.setFontSize(10);
  doc.text(scaleText, left, top + 5.2);
  let cursor = left + scaleWidth + 4;

  // Scale bar: four alternating segments.
  const bar = scaleBarLength(scale, barMax);
  const bx = cursor;
  const by = top + 3.2;
  const bh = 1.1;
  const seg = bar.mm / 4;
  doc.setLineWidth(0.12);
  doc.setDrawColor(0);
  for (let i = 0; i < 4; i++) {
    const v = i % 2 === 0 ? 0 : 255;
    doc.setFillColor(v, v, v);
    doc.rect(bx + i * seg, by, seg, bh, "FD");
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.text("0", bx, by + bh + 2.4, { align: "center" });
  doc.text(formatDistance(bar.meters / 2), bx + bar.mm / 2, by + bh + 2.4, { align: "center" });
  doc.text(formatDistance(bar.meters), bx + bar.mm, by + bh + 2.4, { align: "center" });
  cursor = bx + bar.mm + 5;

  cursor = drawNorthArrow(doc, cursor, top) + 3;

  if (sheet) {
    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(blattText, cursor, top + 4.4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.text(`von ${sheet.total}`, cursor, top + STRIP_UPPER_MM - 0.5);
    cursor += blattWidth + 4;
    if (grid) drawGrid(doc, cursor, top, sheet, grid);
  }

  // 10 cm check line with end ticks.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(0);
  const cx1 = right;
  const cx0 = right - CHECK_LINE_MM;
  const cy = top + 3.8;
  doc.setLineWidth(0.2);
  doc.setDrawColor(0);
  doc.line(cx0, cy, cx1, cy);
  doc.line(cx0, cy - 1.2, cx0, cy + 1.2);
  doc.line(cx1, cy - 1.2, cx1, cy + 1.2);
  doc.text("Kontrollstrecke 10 cm", (cx0 + cx1) / 2, cy + 2.8, { align: "center" });

  // Attribution (OSM, relief, GTFS bus stops; see credits.ts) and print hint. The credits are
  // shrunk if they would run into the hint on a narrow sheet.
  const hint = "Drucken mit 100 % (nicht „An Seite anpassen“)";
  doc.setFontSize(5.5);
  doc.setTextColor(70);
  const hintWidth = doc.getTextWidth(hint);
  const creditWidth = doc.getTextWidth(credits);
  const creditRoom = right - left - hintWidth - 4;
  doc.setFontSize(creditFontSize(creditWidth, creditRoom));
  doc.text(credits, left, top + LEGEND_STRIP_MM - 1.4);
  doc.setFontSize(5.5);
  doc.text(hint, right, top + LEGEND_STRIP_MM - 1.4, { align: "right" });
}

/** Font size of the credits line in pt. */
export const CREDIT_PT = 5.5;
/** The credits are never shrunk below this size. */
export const CREDIT_MIN_PT = 4;

/**
 * Font size of the credits line: CREDIT_PT, shrunk (down to CREDIT_MIN_PT) if the line, measured
 * at CREDIT_PT as `width` mm, does not fit into `room` mm beside the print hint.
 */
export function creditFontSize(width: number, room: number): number {
  return width > room ? Math.max(CREDIT_MIN_PT, (CREDIT_PT * room) / width) : CREDIT_PT;
}

interface GridBox {
  cell: number;
  gap: number;
  width: number;
  height: number;
}

/** Cell size of the grid overview: it must fit between top + 1.7 and the strip's upper limit. */
function gridBox(sheet: SheetInfo): GridBox {
  const gap = 0.3;
  const maxH = STRIP_UPPER_MM - 1.7;
  const cell = Math.min(
    2.4,
    (maxH - (sheet.rows - 1) * gap) / sheet.rows,
    (12 - (sheet.cols - 1) * gap) / sheet.cols,
  );
  return {
    cell,
    gap,
    width: sheet.cols * cell + (sheet.cols - 1) * gap,
    height: sheet.rows * cell + (sheet.rows - 1) * gap,
  };
}

/** Small overview of the sheet grid; the current sheet is filled. */
function drawGrid(doc: jsPDF, x: number, top: number, sheet: SheetInfo, g: GridBox): void {
  const y = top + 1.7 + (STRIP_UPPER_MM - 1.7 - g.height) / 2;
  doc.setDrawColor(0);
  doc.setLineWidth(0.1);
  for (let r = 0; r < sheet.rows; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      const current = r === sheet.row && c === sheet.col;
      doc.setFillColor(current ? 0 : 255, current ? 0 : 255, current ? 0 : 255);
      doc.rect(x + c * (g.cell + g.gap), y + r * (g.cell + g.gap), g.cell, g.cell, "FD");
    }
  }
}

/**
 * Neighbour sheet numbers in the margin outside the frame, centred on each edge: a small filled
 * triangle pointing outwards plus the number. Top and bottom: side by side; left and right: stacked.
 * Vector shapes (the standard fonts have no triangle glyph).
 */
function drawNeighbours(
  doc: jsPDF,
  x0: number,
  y0: number,
  area: SizeMm,
  n: SheetInfo["neighbours"],
): void {
  const gap = NEIGHBOUR_GAP_MM;
  const tw = 3; // triangle base
  const td = 2.4; // triangle depth
  const cap = 1.9; // digit height at 7.5 pt
  const xc = x0 + area.width / 2;
  const yc = y0 + area.height / 2;
  const x1 = x0 + area.width;
  const y1 = y0 + area.height;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(0);
  doc.setFillColor(0, 0, 0);

  const horizontal = (num: number, up: boolean) => {
    const label = String(num);
    const textW = doc.getTextWidth(label);
    const total = tw + 1 + textW;
    const left = xc - total / 2;
    const baseY = up ? y0 - gap : y1 + gap; // triangle side on the frame
    const tipY = up ? baseY - td : baseY + td;
    doc.triangle(left, baseY, left + tw, baseY, left + tw / 2, tipY, "F");
    doc.text(label, left + tw + 1, up ? y0 - gap : y1 + gap + cap);
  };
  const vertical = (num: number, leftSide: boolean) => {
    const label = String(num);
    const textW = doc.getTextWidth(label);
    const colW = Math.max(td, textW);
    const stack = tw + 0.8 + cap;
    const topY = yc - stack / 2;
    // Column next to the frame: right edge at x0 - gap (left) / left edge at x1 + gap (right).
    const colX = leftSide ? x0 - gap - colW : x1 + gap;
    const mid = colX + colW / 2;
    const baseX = leftSide ? mid + td / 2 : mid - td / 2;
    const tipX = leftSide ? mid - td / 2 : mid + td / 2;
    doc.triangle(baseX, topY, baseX, topY + tw, tipX, topY + tw / 2, "F");
    doc.text(label, mid, topY + tw + 0.8 + cap, { align: "center" });
  };
  if (n.top) horizontal(n.top, true);
  if (n.bottom) horizontal(n.bottom, false);
  if (n.left) vertical(n.left, true);
  if (n.right) vertical(n.right, false);
}
