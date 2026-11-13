import type { Map as MapLibreMap, VectorTileSource } from "maplibre-gl";
import type { SourceSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";
import { BUSSTOPS_ATTRIBUTION, DEM_MAXZOOM, OSM_ATTRIBUTION, RELIEF_ATTRIBUTION } from "../config";

export const OSM_SOURCE = "osm";
export const BUSSTOPS_SOURCE = "busstops";
export const DEM_SOURCE = "dem";
export const CONTOUR_SOURCE = "contours";
/** The loaded GPX track (GeoJSON); always part of the style, empty without a track. */
export const GPX_SOURCE = "gpx";

export const EMPTY_GPX: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Contour options for maplibre-contour (the DemSource itself lives in tiles.ts, browser only).
 * Thresholds are keyed by the rounded tile zoom: z13/z14 (1:15 000-1:25 000) 10 m with index
 * lines every 50 m, z12 (1:50 000, boundary ~1:35 000) 20 m / 100 m, z11 50 m / 250 m. Below
 * z10.5 the layers are hidden (minzoom) and the source returns empty tiles without loading DEM.
 * overzoom 1 (contour tile z uses DEM z-1) is calmer: fewer stair steps and slivers in flat land,
 * steep slopes stay resolved, numbers are placed far better, fewer fetches.
 * `level` is 0 for normal and 1+ for index lines.
 */
export const CONTOUR_OPTIONS = {
  thresholds: { 11: [50, 250], 12: [20, 100], 13: [10, 50] },
  overzoom: 1,
  multiplier: 1,
  buffer: 1,
  extent: 4096,
  contourLayer: "contours",
  elevationKey: "ele",
  levelKey: "level",
} as const;

/** Tile URLs of the relief sources (protocols registered by maplibre-contour in tiles.ts). */
export interface ReliefUrls {
  /** Shared DEM tiles (hillshade): `dem-shared://{z}/{x}/{y}`. */
  dem: string;
  /** Contour vector tiles: `dem-contour://{z}/{x}/{y}?...`. */
  contours: string;
}

/**
 * How MapLibre picks the vector tile zoom for a fractional map zoom.
 *
 * MapLibre treats vector tiles as 512 px and by default floors the zoom: at the
 * 1:25 000 print zoom (~12.95) it loads z12 tiles, at 1:50 000 (~11.95) z11.
 * Vector sources must be 512 px in MapLibre >= 5 (tileSize 256 throws), so the
 * lever is the public `roundZoom` source flag: "round" loads z13 at 12.95.
 * Style sizes are screen-space and unaffected; only data detail and tile count change.
 */
export type VectorTileZoomMode = "floor" | "round";
export const VECTOR_TILE_ZOOM: VectorTileZoomMode = "round";

export function osmSource(pmtilesUrl: string): SourceSpecification {
  return {
    type: "vector",
    url: `pmtiles://${pmtilesUrl}`,
    attribution: OSM_ATTRIBUTION,
  };
}

/** GTFS bus stops (separate PMTiles file, layer `bus_stop`). */
export function busstopsSource(pmtilesUrl: string): SourceSpecification {
  return {
    type: "vector",
    url: `pmtiles://${pmtilesUrl}`,
    attribution: BUSSTOPS_ATTRIBUTION,
  };
}

/** GPX track: lines plus start/end points (`_kind`, see src/gpx.ts); empty without a track. */
export function gpxSource(data: FeatureCollection = EMPTY_GPX): SourceSpecification {
  return { type: "geojson", data };
}

export function demSource(url: string): SourceSpecification {
  return {
    type: "raster-dem",
    tiles: [url],
    tileSize: 512,
    encoding: "terrarium",
    maxzoom: DEM_MAXZOOM,
    attribution: RELIEF_ATTRIBUTION,
  };
}

/** Contour lines, generated client-side from the DEM (maplibre-contour). */
export function contourSource(url: string): SourceSpecification {
  return {
    type: "vector",
    tiles: [url],
    maxzoom: DEM_MAXZOOM + 1,
    attribution: RELIEF_ATTRIBUTION,
  };
}

/** Applies VECTOR_TILE_ZOOM to the vector sources; call on every new style. */
export function applyVectorTileZoom(
  map: MapLibreMap,
  mode: VectorTileZoomMode = VECTOR_TILE_ZOOM,
): void {
  const apply = () => {
    const osm = map.getSource<VectorTileSource>(OSM_SOURCE);
    if (!osm) return false;
    const round = mode === "round";
    // The bus stop source (if the style has one) follows the OSM source's tile zoom.
    for (const src of [osm, map.getSource<VectorTileSource>(BUSSTOPS_SOURCE)]) {
      if (src && (src as { roundZoom?: boolean }).roundZoom !== round) {
        (src as { roundZoom?: boolean }).roundZoom = round;
        map.triggerRepaint();
      }
    }
    // The contour thresholds are keyed by the rounded tile zoom (1:25 000 -> z13 -> 10/50 m,
    // 1:50 000 -> z12 -> 20/100 m), so this source always rounds, whatever `mode` says.
    const contours = map.getSource<VectorTileSource>(CONTOUR_SOURCE);
    if (contours && !(contours as { roundZoom?: boolean }).roundZoom) {
      (contours as { roundZoom?: boolean }).roundZoom = true;
      map.triggerRepaint();
    }
    return true;
  };
  if (!apply()) map.once("styledata", () => apply());
}
