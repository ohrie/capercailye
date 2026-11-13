// Composes an A4 PDF page: map image placed in millimetres, sheet furniture as vectors.
import { jsPDF } from "jspdf";
import { ATTRIBUTION_TEXT } from "../config";
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

export interface PdfPageInput {
  image: HTMLCanvasElement;
  orientation: Orientation;
  scale: number;
}

export interface PdfResult {
  blob: Blob;
  pageMm: SizeMm;
  imageMm: SizeMm & { x: number; y: number };
}

const CHECK_LINE_MM = 100;
const SCALE_BAR_MAX_MM = 45;
const FRAME_LINE_MM = 0.25;

export function composePdf(input: PdfPageInput): PdfResult {
  const page = pageSize(input.orientation);
  const area = printableArea(input.orientation);
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: input.orientation,
    compress: true,
  });
  doc.setProperties({ title: `capercailye ${formatScale(input.scale)}`, creator: "capercailye" });

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

  drawLegendStrip(doc, x0, y0, area, input.scale);

  doc.setDrawColor(0);
  doc.setLineWidth(FRAME_LINE_MM);
  doc.rect(x0, y0, area.width, area.height, "S");

  return {
    blob: doc.output("blob"),
    pageMm: page,
    imageMm: { x: x0, y: y0, width: area.width, height: area.height },
  };
}

function drawLegendStrip(doc: jsPDF, x0: number, y0: number, area: SizeMm, scale: number): void {
  const top = y0 + area.height - LEGEND_STRIP_MM;
  const left = x0 + 3;
  const right = x0 + area.width - 3;

  doc.setFillColor(255, 255, 255);
  doc.rect(x0, top, area.width, LEGEND_STRIP_MM, "F");
  doc.setDrawColor(0);
  doc.setLineWidth(0.15);
  doc.line(x0, top, x0 + area.width, top);

  // Scale number.
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(formatScale(scale), left, top + 5.2);

  // Scale bar: four alternating segments.
  const bar = scaleBarLength(scale, SCALE_BAR_MAX_MM);
  const bx = left + 25;
  const by = top + 3.2;
  const bh = 1.1;
  const seg = bar.mm / 4;
  doc.setLineWidth(0.12);
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

  // 10 cm check line with end ticks.
  const cx1 = right;
  const cx0 = right - CHECK_LINE_MM;
  const cy = top + 3.8;
  doc.setLineWidth(0.2);
  doc.line(cx0, cy, cx1, cy);
  doc.line(cx0, cy - 1.2, cx0, cy + 1.2);
  doc.line(cx1, cy - 1.2, cx1, cy + 1.2);
  doc.text("Kontrollstrecke 10 cm", (cx0 + cx1) / 2, cy + 2.8, { align: "center" });

  // Attribution (OSM, relief, GTFS bus stops; see config.ts) and print hint. The credits are
  // shrunk if they would run into the hint on a narrow sheet.
  const hint = "Drucken mit 100 % (nicht „An Seite anpassen“)";
  doc.setFontSize(5.5);
  doc.setTextColor(70);
  const hintWidth = doc.getTextWidth(hint);
  const creditWidth = doc.getTextWidth(ATTRIBUTION_TEXT);
  const room = right - left - hintWidth - 4;
  if (creditWidth > room) doc.setFontSize(Math.max(4, (5.5 * room) / creditWidth));
  doc.text(ATTRIBUTION_TEXT, left, top + LEGEND_STRIP_MM - 1.4);
  doc.setFontSize(5.5);
  doc.text(hint, right, top + LEGEND_STRIP_MM - 1.4, { align: "right" });
}
