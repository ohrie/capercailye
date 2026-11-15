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
 * The credits are part of the licence compliance (SPEC.md 4.8): where the licence asks for it
 * the name says that the data was changed ("bearbeitet", "ausgewertet"), and the full references
 * (licence texts and URIs, per-state producers) are on the sources page `SOURCES_PATH`.
 */
export interface SourceCredit {
  name: string;
  license?: string;
  /** Static data date (relief only); the others are read at runtime. */
  stand?: string;
  /** Link target of the name on screen (map attribution, sidebar). */
  href?: string;
  /**
   * Wording on the PDF sheet margin (no date, no link); default: name and licence. Kept short: the
   * licence references are behind the pointer to the sources page at the end of the line.
   */
  print?: string;
}

/** The sources and licences page of the site (German), root-absolute like the legal pages. */
export const SOURCES_PATH = "/quellen/";
/** The OSM copyright page the OSM credit links to (OSMF attribution guidelines). */
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

export const OSM_CREDIT: SourceCredit = {
  name: "© OpenStreetMap-Mitwirkende",
  license: "ODbL",
  href: OSM_COPYRIGHT_URL,
  // The OSMF guidelines want the copyright URL printed where the map is printed.
  print: "© OpenStreetMap-Mitwirkende (ODbL), openstreetmap.org/copyright",
};
/** Only stops with at least 4 departures on Saturday and Sunday are kept (transit/README.md). */
export const BUSSTOPS_CREDIT: SourceCredit = {
  name: "Fahrplandaten: DELFI e.V. / gtfs.de, ausgewertet",
  license: "CC BY 4.0",
  href: SOURCES_PATH,
  print: "Fahrplandaten: DELFI/gtfs.de, ausgewertet (CC BY 4.0)",
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
 * three licences and credits the state surveying administrations in general; the per-state
 * producer texts, licence names and URIs are on the sources page (site/quellen/, from
 * attribution.json, retrieved 2026-11-15), which also points to mapterhorn.com/attribution.
 *
 * All names say "bearbeitet": hillshade and contour lines are computed from the elevation model
 * (dl-de/by-2-0 section 2 and CC BY 4.0 section 3(a) ask for an indication of changes).
 */
export const RELIEF_CREDITS: Record<string, SourceCredit> = {
  bw: {
    name: "Relief: Mapterhorn, LGL, www.lgl-bw.de, bearbeitet",
    license: "dl-de/by-2-0",
    stand: "2025/2026",
    href: SOURCES_PATH,
    print: "Relief: Mapterhorn, LGL, bearbeitet",
  },
  rp: {
    name: "Relief: Mapterhorn, ©GeoBasis-DE / LVermGeoRP, bearbeitet",
    license: "dl-de/by-2-0",
    stand: "2025",
    href: SOURCES_PATH,
    print: "Relief: Mapterhorn, GeoBasis-DE/LVermGeoRP, bearbeitet",
  },
  de: {
    name: "Relief: Mapterhorn, © GeoBasis-DE / Vermessungsverwaltungen der Länder, bearbeitet",
    license: "dl-de/by-2-0, CC BY 4.0, dl-de/zero-2-0 je nach Land",
    stand: "2025/2026",
    href: SOURCES_PATH,
    print: "Relief: Mapterhorn, GeoBasis-DE/Länder, bearbeitet",
  },
};

/** Area key of the loaded PMTiles file, e.g. "rp" for data/capercailye-rp.pmtiles. */
export const AREA = /capercailye-([^/]+)\.pmtiles$/.exec(PMTILES_PATH)?.[1] ?? "";

/** Relief credit for the loaded area; unknown areas point to Mapterhorn's full source list, no date. */
export const RELIEF_CREDIT: SourceCredit = RELIEF_CREDITS[AREA] ?? {
  name: "Relief: Mapterhorn, bearbeitet, Quellen: mapterhorn.com/attribution",
  href: SOURCES_PATH,
};

/** Place search; named in the sidebar footer only (the sheet margin lists what is printed on it). */
export const SEARCH_ATTRIBUTION = "Suche: Photon (komoot)";

/** Absolute URL relative to the app base (MapLibre needs absolute URLs for glyphs and pmtiles). */
export function appUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, window.location.origin).href;
}
