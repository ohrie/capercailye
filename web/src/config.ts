// Application-wide constants.

/** Initial view: Dahn im Pfälzerwald (Rheinland-Pfalz). BW: Veringenstadt [9.2103, 48.1836]. */
export const INITIAL_CENTER: [number, number] = [7.7765, 49.1505];
export const INITIAL_ZOOM = 13;

/** PMTiles file, served by the dev server from $CAPERCAILYE_DATA (default ~/.local/share/capercailye). */
export const PMTILES_PATH = "data/capercailye-rp.pmtiles";

/**
 * Bus stops from GTFS (PLAN.md 4c), a second small PMTiles file next to the OSM one
 * (layer `bus_stop`, zoom 10-14). Optional: without the file the app runs without bus stops.
 */
export const BUSSTOPS_PMTILES_PATH = "data/capercailye-busstops.pmtiles";

/** Mapterhorn terrain tiles (Terrarium-encoded WebP, 512 px). */
export const DEM_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
/** Highest DEM zoom requested; finer levels would add requests without visible gain in a subtle hillshade. */
export const DEM_MAXZOOM = 14;

/**
 * Fetch timeout per DEM tile (maplibre-contour DemSource, shared by hillshade and contour lines).
 * After it the tile is `errored`, which MapLibre counts as finished, so `idle` still comes and the
 * export does not hang on a stalled connection.
 */
export const RELIEF_TIMEOUT_MS = 15_000;

/**
 * Credit line of the GTFS bus stops (map attribution, sidebar footer, PDF sheet margin).
 * Provisional wording: adjust the text here once the data source and its licence text are final.
 */
export const BUSSTOPS_ATTRIBUTION = "Fahrplandaten: DELFI e.V. / gtfs.de, CC BY 4.0";

export const OSM_ATTRIBUTION = "© OpenStreetMap-Mitwirkende";
/**
 * Elevation sources inside the Mapterhorn tiles, per area (key = `<area>` of
 * `capercailye-<area>.pmtiles`). Producer texts from https://mapterhorn.com/attribution
 * (attribution.json, "producer"); both are licensed dl-de/by-2-0.
 */
const RELIEF_SOURCES: Record<string, string> = {
  bw: "LGL, www.lgl-bw.de (dl-de/by-2-0)",
  rp: "©GeoBasis-DE / LVermGeoRP (dl-de/by-2-0)",
};

/** Area key of the loaded PMTiles file, e.g. "rp" for data/capercailye-rp.pmtiles. */
export const AREA = /capercailye-([^/]+)\.pmtiles$/.exec(PMTILES_PATH)?.[1] ?? "";

/** Relief credit for the loaded area; unknown areas point to Mapterhorn's full source list. */
export const RELIEF_ATTRIBUTION = `Relief: Mapterhorn, ${
  RELIEF_SOURCES[AREA] ?? "Quellen: mapterhorn.com/attribution"
}`;

export const ATTRIBUTION_TEXT = [OSM_ATTRIBUTION, RELIEF_ATTRIBUTION, BUSSTOPS_ATTRIBUTION].join(
  " · ",
);

/** Place search; named in the sidebar footer only (the sheet margin lists what is printed on it). */
export const SEARCH_ATTRIBUTION = "Suche: Photon (komoot)";
export const SIDEBAR_ATTRIBUTION_TEXT = `${ATTRIBUTION_TEXT} · ${SEARCH_ATTRIBUTION}`;

/** Absolute URL relative to the app base (MapLibre needs absolute URLs for glyphs and pmtiles). */
export function appUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, window.location.origin).href;
}
