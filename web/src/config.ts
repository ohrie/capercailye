// Application-wide constants.

/** Initial view: Dahn im Pfälzerwald (Rheinland-Pfalz). BW: Veringenstadt [9.2103, 48.1836]. */
export const INITIAL_CENTER: [number, number] = [7.7765, 49.1505];
export const INITIAL_ZOOM = 13;

/**
 * PMTiles file, relative to the app base. Set `VITE_PMTILES_PATH` at build time to override it
 * (e.g. `data/capercailye-de.pmtiles`). The dev server serves `data/` from $CAPERCAILYE_DATA
 * (default ~/.local/share/capercailye). `import.meta.env` is undefined under `bun test`.
 */
export const PMTILES_PATH: string =
  import.meta.env?.VITE_PMTILES_PATH ?? "data/capercailye-rp.pmtiles";

/**
 * Bus stops from GTFS (SPEC.md 5), a second small PMTiles file next to the OSM one
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
 * Source credits. Pattern per source: `<name> (<licence>, Stand <date>)`; the date part is added
 * by src/credits.ts (OSM and GTFS: read from the data files, relief: static, see below).
 * Provisional wording of the GTFS credit: adjust here once the licence text is final.
 */
export interface SourceCredit {
  name: string;
  license?: string;
  /** Static data date (relief only); the others are read at runtime. */
  stand?: string;
}

export const OSM_CREDIT: SourceCredit = { name: "© OpenStreetMap-Mitwirkende", license: "ODbL" };
export const BUSSTOPS_CREDIT: SourceCredit = {
  name: "Fahrplandaten: DELFI e.V. / gtfs.de",
  license: "CC BY 4.0",
};

/**
 * Elevation sources inside the Mapterhorn tiles, per area (key = `<area>` of
 * `capercailye-<area>.pmtiles`). Mapterhorn offers no queryable data date (the TileJSON has none,
 * the tiles' Last-Modified is the tile build, download.mapterhorn.com/attribution.json has no
 * CORS), so the date is static: `access_year` of the producers in attribution.json (retrieved
 * 2026-11-14): derlp 2025 (rp); debw 2025 and debw025 (DGM ALS_3) 2026 (bw). Producer texts as
 * given there; both licensed dl-de/by-2-0.
 *
 * `de` (all of Germany): attribution.json lists 17 German producers (all 16 states; Baden-Württemberg
 * has two): access_year 2025 for all but `dehessen` and `debw025`, which have 2026, hence
 * "2025/2026". The licences differ per state: dl-de/by-2-0 (BW, BB, HH, RP, SL, SN, ST, TH),
 * CC BY 4.0 (BY, HB, MV, NI, SH) and dl-de/zero-2-0 (BE, HE, NW). The credit therefore names the
 * three licences, credits the state surveying administrations in general and points to
 * mapterhorn.com/attribution for the per-state producer texts. Retrieved 2026-11-14.
 */
const RELIEF_CREDITS: Record<string, SourceCredit> = {
  bw: {
    name: "Relief: Mapterhorn, LGL, www.lgl-bw.de",
    license: "dl-de/by-2-0",
    stand: "2025/2026",
  },
  rp: {
    name: "Relief: Mapterhorn, ©GeoBasis-DE / LVermGeoRP",
    license: "dl-de/by-2-0",
    stand: "2025",
  },
  de: {
    name: "Relief: Mapterhorn, © GeoBasis-DE / Landesvermessungsverwaltungen, Quellen: mapterhorn.com/attribution",
    license: "dl-de/by-2-0, CC BY 4.0, dl-de/zero-2-0 je nach Land",
    stand: "2025/2026",
  },
};

/** Area key of the loaded PMTiles file, e.g. "rp" for data/capercailye-rp.pmtiles. */
export const AREA = /capercailye-([^/]+)\.pmtiles$/.exec(PMTILES_PATH)?.[1] ?? "";

/** Relief credit for the loaded area; unknown areas point to Mapterhorn's full source list, no date. */
export const RELIEF_CREDIT: SourceCredit = RELIEF_CREDITS[AREA] ?? {
  name: "Relief: Mapterhorn, Quellen: mapterhorn.com/attribution",
};

/** Place search; named in the sidebar footer only (the sheet margin lists what is printed on it). */
export const SEARCH_ATTRIBUTION = "Suche: Photon (komoot)";

/** Absolute URL relative to the app base (MapLibre needs absolute URLs for glyphs and pmtiles). */
export function appUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, window.location.origin).href;
}
