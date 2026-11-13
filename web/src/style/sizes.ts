// The one place for symbol sizes on paper (mm at the print zoom, see units.ts).
//
// Boxed pictograms, plain symbols, bus stops and waymark signs all take their size from here;
// registry.ts, osmc/render.ts, poi.ts and routes.ts hold no size numbers of their own.
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

/** Boxed pictograms (restaurant, castle, station …): edge length. */
export const ICON_MM = 3.4;
/** Smaller boxes (parking, toilets, hotel …). */
export const ICON_SMALL_MM = 3.0;
/** One waymark sign (plate height): as large as a boxed pictogram. */
export const WAYMARK_MM = ICON_MM;
/** Gap between two signs of a combined waymark image. */
export const WAYMARK_GAP_MM = 0.35;
/** White rim between plate outline and sign, outline stroke and corner radius of a plate. */
export const WAYMARK_RIM_MM = 0.2;
export const WAYMARK_OUTLINE_MM = 0.1;
export const WAYMARK_RADIUS_MM = 0.35;

// Plain symbols (no box, white halo) in steps relative to the box size, so one change of ICON_MM
// moves them all: churches, GTFS bus stop and guidepost flag are the largest.
const step = (factor: number): number => Math.round(ICON_MM * factor * 100) / 100;
/** Bus stop and guidepost flag: kept as large as the small boxes (the "H" and the flag must read). */
export const PLAIN_XL_MM = ICON_SMALL_MM;
/** Church. */
export const PLAIN_L_MM = step(0.8);
/** Chapel, spring, towers, wind turbines … */
export const PLAIN_MM = step(0.7);
/** Crosses, shrines, rocks, weirs … */
export const PLAIN_SMALL_MM = step(0.6);
/** Smallest: boulders, the flag of an unnamed guidepost. */
export const PLAIN_XS_MM = step(0.55);

/**
 * Below this zoom (print scales smaller than about 1:35 000, i.e. 1:50 000) every symbol is drawn
 * at SMALL_SCALE_FACTOR of its size: the sheet shows four times the area. Pictograms, bus stops and
 * waymarks share this one rule (the print zoom of 1:25 000 is about z12.95, 1:50 000 about z11.95).
 */
export const SMALL_SCALE_ZOOM = 12.4;
export const SMALL_SCALE_FACTOR = 0.85;

/** `icon-size` of every symbol layer: SMALL_SCALE_FACTOR at 1:50 000, 1 from 1:25 000 on. */
export const iconSizeByScale: ExpressionSpecification = [
  "step",
  ["zoom"],
  SMALL_SCALE_FACTOR,
  SMALL_SCALE_ZOOM,
  1,
];
