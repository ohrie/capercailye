// Hillshade from the Mapterhorn DEM (C7), tuned for print: the "igor" method shades slopes only
// and leaves flat land untouched, so the map does not get darker overall and the forest green
// stays clean. No highlights (they would wash out the pale landcover tints on paper).
import type { ExpressionSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { COLORS } from "./palette";
import { halo, FONT_REGULAR } from "./fonts";
import { CONTOUR_OPTIONS, CONTOUR_SOURCE, DEM_SOURCE } from "./sources";
import { lineWidth, mm, pt } from "./units";

/** Shadow colour of the hillshade (also the legend symbol). */
export const HILLSHADE_SHADOW = "rgba(62, 56, 70, 0.62)";

/** Contour line widths in paper mm (normal, index; also the legend symbol). */
export const CONTOUR_MM = 0.12;
export const CONTOUR_INDEX_MM = 0.22;

export function hillshadeLayers(): LayerSpecification[] {
  return [
    {
      id: "hillshade-relief",
      type: "hillshade",
      source: DEM_SOURCE,
      paint: {
        "hillshade-method": "igor",
        // Stronger in overview zooms (coarser DEM), gentler at print and detail zooms.
        "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 12, 0.5, 15, 0.4],
        "hillshade-shadow-color": HILLSHADE_SHADOW,
        "hillshade-highlight-color": "rgba(255, 255, 255, 0)",
        "hillshade-accent-color": "rgba(0, 0, 0, 0)",
        "hillshade-illumination-direction": 315,
        "hillshade-illumination-anchor": "map",
      },
    },
  ];
}

/**
 * Contour lines from maplibre-contour (M4): 10 m with index lines every 50 m at 1:15 000-1:25 000,
 * 20 m / 100 m from about 1:35 000 (CONTOUR_OPTIONS). Index lines are heavier and labelled.
 * The numbers do not take part in the print placement: they are the lowest symbol layer, placed
 * last by MapLibre, and yield to waymarks, names and pictograms (like names, PLAN.md 4a).
 */
export function contourLayers(): LayerSpecification[] {
  const { contourLayer, elevationKey, levelKey } = CONTOUR_OPTIONS;
  const common = { source: CONTOUR_SOURCE, "source-layer": contourLayer } as const;
  const normal: ExpressionSpecification = ["==", ["get", levelKey], 0];
  const index: ExpressionSpecification = [">", ["get", levelKey], 0];
  return [
    {
      id: "contours-line",
      type: "line",
      ...common,
      minzoom: 10.5,
      filter: normal,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": COLORS.contour, "line-width": lineWidth(CONTOUR_MM) },
    },
    {
      id: "contours-index",
      type: "line",
      ...common,
      minzoom: 10.5,
      filter: index,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": COLORS.contourIndex, "line-width": lineWidth(CONTOUR_INDEX_MM) },
    },
    {
      id: "contours-label",
      type: "symbol",
      ...common,
      minzoom: 11,
      filter: index,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": mm(60),
        // to-string, not number-format: that would give "1.493" in de-DE.
        "text-field": ["to-string", ["get", elevationKey]],
        "text-font": FONT_REGULAR,
        "text-size": pt(6.5),
        // The DEM's small zigzags make MapLibre drop most numbers below ~90 degrees.
        "text-max-angle": 90,
        "text-padding": mm(1),
        "text-keep-upright": true,
        "text-rotation-alignment": "map",
      },
      paint: { "text-color": COLORS.contourText, ...halo(0.25) },
    },
  ];
}
