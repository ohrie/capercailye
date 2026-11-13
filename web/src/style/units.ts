// Print units. At the print zoom one CSS pixel is exactly 1/96 inch on paper,
// so style sizes are written in paper millimetres / points and converted here.
//
// Print zooms (48.5° N): 1:50 000 ≈ z11.9, 1:25 000 ≈ z12.9, 1:15 000 ≈ z13.7. In "pages
// leading" mode the scale can be anything in between, so every size is constant over the whole
// print band PRINT_MIN_ZOOM..PRINT_MAX_ZOOM and only thins out (overview) or grows (screen zoom-in)
// outside it.
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

export const MM_PER_PX = 25.4 / 96; // 0.2646 mm
export const PX_PER_MM = 96 / 25.4;

/** Zoom range in which sizes are exactly their paper value. */
export const PRINT_MIN_ZOOM = 11.5;
export const PRINT_MAX_ZOOM = 14.5;

/** Paper millimetres -> CSS px at print zoom. */
export function mm(value: number): number {
  return value * PX_PER_MM;
}

/** Typographic points -> CSS px (1 pt = 1/72 inch). */
export function pt(value: number): number {
  return (value * 96) / 72;
}

type Num = number | ExpressionSpecification;

function times(f: number, v: Num): Num {
  return typeof v === "number" ? v * f : ["*", f, v];
}

/**
 * Zoom-scaled pixel value: exact within the print band, thinner below (factor `low` at z8,
 * reached linearly), wider above (factor `high` at z17). `px` may be a data expression; it is
 * nested inside the single top-level zoom interpolation MapLibre allows.
 */
export function zoomScaled(px: Num, low = 0.35, high = 1.6): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    8,
    times(low, px),
    PRINT_MIN_ZOOM,
    px,
    PRINT_MAX_ZOOM,
    px,
    17,
    times(high, px),
  ];
}

/** Line width given in paper mm (number or data expression yielding mm). */
export function lineWidth(mmValue: Num, low?: number, high?: number): ExpressionSpecification {
  return zoomScaled(times(PX_PER_MM, mmValue), low, high);
}

/** Paper-mm dash pattern -> dasharray in multiples of the line width. */
export function dashes(lineWidthMm: number, ...patternMm: number[]): number[] {
  return patternMm.map((v) => v / lineWidthMm);
}

/**
 * Dots of diameter = line width, centre distance `pitchMm`. Needs `line-cap: round`
 * (a zero-length dash with round caps renders as a dot).
 */
export function dots(lineWidthMm: number, pitchMm: number): number[] {
  return [0, pitchMm / lineWidthMm];
}
