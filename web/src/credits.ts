// Source credits (pure, testable): `<name> (<licence>, Stand <date>)` per source.
//
// The data date is shown on the website only (sidebar footer, map attribution). The PDF sheet
// margin carries the same sources without a date (`line`, by decision).
import {
  BUSSTOPS_CREDIT,
  OSM_CREDIT,
  RELIEF_CREDIT,
  SEARCH_ATTRIBUTION,
  type SourceCredit,
} from "./config";

/** Planetiler writes the replication time of the OSM extract into the PMTiles metadata. */
const OSM_STAND_KEY = "planetiler:osm:osmosisreplicationtime";
/** transit/build.sh writes `feed_date=YYYY-MM-DD` into the description of the bus stop file. */
const GTFS_FEED_DATE = /feed_date=(\d{4}-\d{2}-\d{2})/;

/** "2026-11-12T21:23:05Z" -> "12.11.2026" (the UTC date part); undefined if it is no ISO date. */
export function formatStand(iso: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(iso.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : undefined;
}

function record(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

/** Data date of the OSM extract from the PMTiles metadata, formatted; undefined if unknown. */
export function osmStand(meta: unknown): string | undefined {
  const value = record(meta)[OSM_STAND_KEY];
  return typeof value === "string" ? formatStand(value) : undefined;
}

/** Feed date of the bus stop file from the PMTiles metadata (description), formatted. */
export function gtfsStand(meta: unknown): string | undefined {
  const description = record(meta).description;
  const m = typeof description === "string" ? GTFS_FEED_DATE.exec(description) : null;
  return m ? formatStand(m[1]!) : undefined;
}

/** `<name> (<licence>, Stand <date>)`; without a date only ", Stand …" drops out. */
export function creditText(credit: SourceCredit, stand?: string): string {
  const parts = [credit.license, stand ? `Stand ${stand}` : undefined].filter(Boolean);
  return parts.length > 0 ? `${credit.name} (${parts.join(", ")})` : credit.name;
}

export interface Credits {
  /** Texts for the map attribution (with data dates). */
  osm: string;
  relief: string;
  busstops: string;
  /** PDF sheet margin: the sources without data dates. */
  line: string;
  /** Sidebar footer: the sources with data dates, plus the search. */
  sidebar: string;
}

export interface CreditInput {
  /** Formatted data dates (see osmStand, gtfsStand). */
  osm?: string;
  gtfs?: string;
  /** Without the bus stop file the source is not credited (default true). */
  busstopsAvailable?: boolean;
  relief?: SourceCredit;
}

export function buildCredits(input: CreditInput = {}): Credits {
  const relief = input.relief ?? RELIEF_CREDIT;
  const withBusstops = input.busstopsAvailable ?? true;
  const osm = creditText(OSM_CREDIT, input.osm);
  const reliefText = creditText(relief, relief.stand);
  const busstops = creditText(BUSSTOPS_CREDIT, input.gtfs);
  const site = [osm, reliefText, ...(withBusstops ? [busstops] : [])];
  return {
    osm,
    relief: reliefText,
    busstops,
    line: [
      creditText(OSM_CREDIT),
      creditText({ ...relief, stand: undefined }),
      ...(withBusstops ? [creditText(BUSSTOPS_CREDIT)] : []),
    ].join(" · "),
    sidebar: [...site, SEARCH_ATTRIBUTION].join(" · "),
  };
}
