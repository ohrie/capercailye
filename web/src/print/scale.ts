// Scale <-> zoom maths for 512 px Web-Mercator tiles and 96 CSS px per inch.
import { formatNumber, type Locale } from "../i18n";
import { getLocale } from "../paraglide/runtime.js";

export const EARTH_CIRCUMFERENCE_M = 40075016.686;
export const CSS_PX_PER_INCH = 96;
export const METERS_PER_INCH = 0.0254;
const TILE_SIZE = 512;

/** Map zoom at which 1 CSS px on screen corresponds to the given scale on paper (1:scale). */
export function zoomForScale(scale: number, latDeg: number): number {
  const cosLat = Math.cos((latDeg * Math.PI) / 180);
  return Math.log2(
    (EARTH_CIRCUMFERENCE_M * cosLat * CSS_PX_PER_INCH) / (TILE_SIZE * scale * METERS_PER_INCH),
  );
}

/** Inverse of zoomForScale. */
export function scaleForZoom(zoom: number, latDeg: number): number {
  const cosLat = Math.cos((latDeg * Math.PI) / 180);
  return (
    (EARTH_CIRCUMFERENCE_M * cosLat * CSS_PX_PER_INCH) / (TILE_SIZE * 2 ** zoom * METERS_PER_INCH)
  );
}

/** Ground metres per CSS pixel at zoom and latitude. */
export function metersPerCssPx(zoom: number, latDeg: number): number {
  const cosLat = Math.cos((latDeg * Math.PI) / 180);
  return (EARTH_CIRCUMFERENCE_M * cosLat) / (TILE_SIZE * 2 ** zoom);
}

/** Paper length in mm of a ground distance at 1:scale. */
export function paperMm(groundMeters: number, scale: number): number {
  return (groundMeters * 1000) / scale;
}

const NICE_LENGTHS_M = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** Largest "nice" ground length whose scale bar fits into maxMm on paper. */
export function scaleBarLength(scale: number, maxMm: number): { meters: number; mm: number } {
  let best = NICE_LENGTHS_M[0]!;
  for (const m of NICE_LENGTHS_M) if (paperMm(m, scale) <= maxMm) best = m;
  return { meters: best, mm: paperMm(best, scale) };
}

/**
 * "1:25 000" (de, plain spaces: safe for PDF standard fonts) or "1:25,000" (en). The active
 * locale unless one is given.
 */
export function formatScale(scale: number, locale: Locale = getLocale()): string {
  const separator = locale === "de" ? " " : ",";
  const digits = String(Math.round(scale)).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return `1:${digits}`;
}

/** "500 m", "2,5 km" (de) or "2.5 km" (en). */
export function formatDistance(meters: number, locale: Locale = getLocale()): string {
  return meters >= 1000
    ? `${formatNumber(meters / 1000, { maximumFractionDigits: 3, useGrouping: false }, locale)} km`
    : `${meters} m`;
}
