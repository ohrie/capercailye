// Paper geometry in millimetres.

export type Orientation = "portrait" | "landscape";

export const A4_MM = { width: 210, height: 297 } as const;
/** Unprinted margin on each side. */
export const MARGIN_MM = 8;
/** Extra map rendered on each side and cropped afterwards, so labels at the edge are not cut. */
export const BLEED_MM = 5;
/** Height of the white strip at the bottom of the map area holding scale, check line, attribution. */
export const LEGEND_STRIP_MM = 11;

export interface SizeMm {
  width: number;
  height: number;
}

export function pageSize(orientation: Orientation): SizeMm {
  return orientation === "portrait"
    ? { width: A4_MM.width, height: A4_MM.height }
    : { width: A4_MM.height, height: A4_MM.width };
}

/** Printable (= map) area: page minus margins. */
export function printableArea(orientation: Orientation): SizeMm {
  const page = pageSize(orientation);
  return { width: page.width - 2 * MARGIN_MM, height: page.height - 2 * MARGIN_MM };
}

export function mmToCssPx(mm: number): number {
  return (mm * 96) / 25.4;
}

export function mmToDevicePx(mm: number, dpi: number): number {
  return (mm * dpi) / 25.4;
}
