import type { Map as MapLibreMap, VectorTileSource } from "maplibre-gl";
import type { SourceSpecification } from "@maplibre/maplibre-gl-style-spec";
import {
  BUSSTOPS_ATTRIBUTION,
  DEM_MAXZOOM,
  DEM_TILES,
  OSM_ATTRIBUTION,
  RELIEF_ATTRIBUTION,
} from "../config";

export const OSM_SOURCE = "osm";
export const BUSSTOPS_SOURCE = "busstops";
export const DEM_SOURCE = "dem";

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

export function demSource(): SourceSpecification {
  return {
    type: "raster-dem",
    tiles: [DEM_TILES],
    tileSize: 512,
    encoding: "terrarium",
    maxzoom: DEM_MAXZOOM,
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
    return true;
  };
  if (!apply()) map.once("styledata", () => apply());
}
