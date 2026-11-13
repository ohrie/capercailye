// Hillshade from the Mapterhorn DEM (C7), tuned for print: the "igor" method shades slopes only
// and leaves flat land untouched, so the map does not get darker overall and the forest green
// stays clean. No highlights (they would wash out the pale landcover tints on paper).
import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { DEM_SOURCE } from "./sources";

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
        "hillshade-shadow-color": "rgba(62, 56, 70, 0.62)",
        "hillshade-highlight-color": "rgba(255, 255, 255, 0)",
        "hillshade-accent-color": "rgba(0, 0, 0, 0)",
        "hillshade-illumination-direction": 315,
        "hillshade-illumination-anchor": "map",
      },
    },
  ];
}

/**
 * Slot for M4: contour lines (10 m, index lines every 50 m, labelled) from maplibre-contour.
 * The group is registered in index.ts without a sidebar label until it has layers.
 */
export function contourLayers(): LayerSpecification[] {
  return [];
}
