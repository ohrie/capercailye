// Sheet layout (PLAN.md 4): an area on the map -> a grid of overlapping A4 sheets at one common
// zoom. Pure maths (no DOM, no MapLibre), shared by the preview frame, the placement region and
// the multi-page export.
//
// Everything is computed in global paper millimetres at the layout zoom (placement/geo.ts), where
// Web-Mercator is linear: the area and every sheet are true rectangles on screen and on paper.
import { lngLatToMm, mmToLngLat, type RectMm } from "../placement/geo";
import { BLEED_MM, LEGEND_STRIP_MM, type Orientation, printableArea, type SizeMm } from "./paper";
import { formatScale, zoomForScale } from "./scale";

/** Area on the map in longitude / latitude (degrees). */
export interface Area {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type PrintMode = "scale" | "pages";

export interface LayoutSettings {
  mode: PrintMode;
  /** Scale denominator; used in mode "scale". */
  scale: number;
  /** Number of sheets; used in mode "pages". */
  pages: number;
  orientation: Orientation;
  area: Area;
}

export interface Sheet {
  /** 1..N, row by row from the top left. */
  number: number;
  col: number;
  row: number;
  /** lng/lat of the centre of `printMm` = the render point of the sheet's map image. */
  center: [number, number];
  /** Map field (printable area minus legend strip): the part that overlaps the neighbours. */
  fieldMm: RectMm;
  /** Printable area = field plus the legend strip at the bottom. */
  printMm: RectMm;
  /** Sheet numbers of the four edge neighbours (none diagonally). */
  neighbours: { top?: number; right?: number; bottom?: number; left?: number };
}

export interface SheetLayout {
  mode: PrintMode;
  scale: number;
  zoom: number;
  orientation: Orientation;
  cols: number;
  rows: number;
  /** Empty if `tooLarge`. */
  sheets: Sheet[];
  /** Number of sheets, also when `tooLarge` (then > MAX_SHEETS). */
  count: number;
  /** Centre of the area (lng/lat, centre in Mercator). */
  center: [number, number];
  /** The area at the layout zoom. */
  areaMm: RectMm;
  /** Grid of map fields (without the legend strip below the last row). */
  gridMm: RectMm;
  /** Placement region: printable areas of all sheets plus the bleed all around. */
  regionMm: RectMm;
  /** Mode "pages": false if even 1:50 000 would not cover the area. */
  areaCovered: boolean;
  /** More than MAX_SHEETS: no sheets, no export. */
  tooLarge: boolean;
}

/** Overlap between neighbouring map fields. */
export const OVERLAP_MM = 10;
export const MAX_SHEETS = 24;
/** Validity range of the style sizes (README: print band z11.5..14.5). */
export const MIN_SCALE = 10000;
export const MAX_SCALE = 50000;
export const PAGE_CHOICES = [1, 2, 3, 4, 6, 8, 9, 12] as const;
export const SCALE_CHOICES = [15000, 25000, 50000] as const;

/** Reference scale at which the area is measured in mode "pages". */
const REF_SCALE = 25000;
/** Guards ceil() against floating-point noise (e.g. 2.0000000001 -> 3). */
const EPS = 1e-9;

/** Map field of one sheet: the printable area minus the legend strip. */
export function fieldSize(orientation: Orientation): SizeMm {
  const area = printableArea(orientation);
  return { width: area.width, height: area.height - LEGEND_STRIP_MM };
}

/** Rounds a scale up to the next full 1 000, so the area stays covered. */
export function roundScaleUp(s: number): number {
  return Math.ceil(s / 1000 - EPS) * 1000;
}

function areaToMm(area: Area, zoom: number): RectMm {
  const [minX, minY] = lngLatToMm(area.west, area.north, zoom);
  const [maxX, maxY] = lngLatToMm(area.east, area.south, zoom);
  return { minX, minY, maxX, maxY };
}

function mmToArea(r: RectMm, zoom: number): Area {
  const [west, north] = mmToLngLat(r.minX, r.minY, zoom);
  const [east, south] = mmToLngLat(r.maxX, r.maxY, zoom);
  return { west, south, east, north };
}

function mmCentre(r: RectMm): [number, number] {
  return [(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2];
}

/** Centre of an area in Mercator (not the arithmetic mean of the latitudes). */
export function areaCenter(area: Area): [number, number] {
  const [x, y] = mmCentre(areaToMm(area, 0));
  return mmToLngLat(x, y, 0);
}

function gridExtent(count: number, field: number): number {
  return count * field - (count - 1) * OVERLAP_MM;
}

/** Columns / rows needed to cover `size` mm. */
function cellsFor(size: number, field: number): number {
  return Math.max(1, Math.ceil((size - OVERLAP_MM) / (field - OVERLAP_MM) - EPS));
}

/** Scale at which a c x r grid just covers the area (measured at the reference scale). */
function scaleToFit(c: number, r: number, ref: SizeMm, field: SizeMm): number {
  return (
    REF_SCALE *
    Math.max(ref.width / gridExtent(c, field.width), ref.height / gridExtent(r, field.height))
  );
}

export function computeLayout(settings: LayoutSettings): SheetLayout {
  const { area, orientation } = settings;
  const field = fieldSize(orientation);
  const center = areaCenter(area);
  const lat = center[1];

  let scale: number;
  let cols: number;
  let rows: number;
  let areaCovered = true;

  if (settings.mode === "scale") {
    scale = settings.scale;
    const m = areaToMm(area, zoomForScale(scale, lat));
    cols = cellsFor(m.maxX - m.minX, field.width);
    rows = cellsFor(m.maxY - m.minY, field.height);
  } else {
    const n = Math.max(1, Math.round(settings.pages));
    const mRef = areaToMm(area, zoomForScale(REF_SCALE, lat));
    const ref = { width: mRef.maxX - mRef.minX, height: mRef.maxY - mRef.minY };
    let best = Infinity;
    cols = 1;
    rows = n;
    for (let c = 1; c <= n; c++) {
      if (n % c !== 0) continue;
      const s = scaleToFit(c, n / c, ref, field);
      if (s < best) {
        best = s;
        cols = c;
        rows = n / c;
      }
    }
    const rounded = roundScaleUp(best);
    areaCovered = rounded <= MAX_SCALE;
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rounded));
  }

  const zoom = zoomForScale(scale, lat);
  const areaMm = areaToMm(area, zoom);
  const [cx, cy] = mmCentre(areaMm);
  const count = cols * rows;
  const tooLarge = count > MAX_SHEETS;
  if (tooLarge) areaCovered = false;

  const gridW = gridExtent(cols, field.width);
  const gridH = gridExtent(rows, field.height);
  const gridMm: RectMm = {
    minX: cx - gridW / 2,
    minY: cy - gridH / 2,
    maxX: cx + gridW / 2,
    maxY: cy + gridH / 2,
  };
  const margin = BLEED_MM;
  const regionMm: RectMm = {
    minX: gridMm.minX - margin,
    minY: gridMm.minY - margin,
    maxX: gridMm.maxX + margin,
    maxY: gridMm.maxY + LEGEND_STRIP_MM + margin,
  };

  const sheets: Sheet[] = [];
  if (!tooLarge) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const minX = gridMm.minX + col * (field.width - OVERLAP_MM);
        const minY = gridMm.minY + row * (field.height - OVERLAP_MM);
        const fieldMm: RectMm = {
          minX,
          minY,
          maxX: minX + field.width,
          maxY: minY + field.height,
        };
        const printMm: RectMm = { ...fieldMm, maxY: fieldMm.maxY + LEGEND_STRIP_MM };
        const [mx, my] = mmCentre(printMm);
        const number = row * cols + col + 1;
        const neighbours: Sheet["neighbours"] = {};
        if (row > 0) neighbours.top = number - cols;
        if (col < cols - 1) neighbours.right = number + 1;
        if (row < rows - 1) neighbours.bottom = number + cols;
        if (col > 0) neighbours.left = number - 1;
        sheets.push({
          number,
          col,
          row,
          center: mmToLngLat(mx, my, zoom),
          fieldMm,
          printMm,
          neighbours,
        });
      }
    }
  }

  return {
    mode: settings.mode,
    scale,
    zoom,
    orientation,
    cols,
    rows,
    sheets,
    count,
    center,
    areaMm,
    gridMm,
    regionMm,
    areaCovered,
    tooLarge,
  };
}

/** Initial area: 90 % of one map field at `scale`, around `center` (lng/lat). */
export function defaultArea(
  center: [number, number],
  orientation: Orientation,
  scale: number,
): Area {
  const field = fieldSize(orientation);
  const zoom = zoomForScale(scale, center[1]);
  const [cx, cy] = lngLatToMm(center[0], center[1], zoom);
  const w = 0.9 * field.width;
  const h = 0.9 * field.height;
  return mmToArea({ minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 }, zoom);
}

/** Moves the area (in Mercator, size unchanged) so that its centre is at `center` (lng/lat). */
export function recenterArea(area: Area, center: [number, number]): Area {
  const m = areaToMm(area, 0);
  const [cx, cy] = mmCentre(m);
  const [nx, ny] = lngLatToMm(center[0], center[1], 0);
  const dx = nx - cx;
  const dy = ny - cy;
  return mmToArea(
    { minX: m.minX + dx, minY: m.minY + dy, maxX: m.maxX + dx, maxY: m.maxY + dy },
    0,
  );
}

/** "capercailye-1-25000-hoch.pdf", with several sheets "capercailye-1-21000-hoch-6-seiten.pdf". */
export function layoutFilename(
  layout: Pick<SheetLayout, "scale" | "orientation" | "count">,
): string {
  const o = layout.orientation === "portrait" ? "hoch" : "quer";
  const pages = layout.count > 1 ? `-${layout.count}-seiten` : "";
  return `capercailye-1-${layout.scale}-${o}${pages}.pdf`;
}

/** "6 × A4 hoch · 1:21 000" */
export function layoutLabel(layout: Pick<SheetLayout, "scale" | "orientation" | "count">): string {
  const o = layout.orientation === "portrait" ? "hoch" : "quer";
  return `${layout.count} × A4 ${o} · ${formatScale(layout.scale)}`;
}
