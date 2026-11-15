// Source credits (pure, testable): `<name> (<licence>, Stand <date>)` per source.
//
// The data date is shown on the website only (sidebar footer, map attribution). The PDF sheet
// margin carries the same sources without a date (`line`, by decision), with the OSM copyright
// URL and a pointer to the sources page as text (a printed page has no links).
import {
  BUSSTOPS_CREDIT,
  OSM_CREDIT,
  RELIEF_CREDIT,
  SEARCH_ATTRIBUTION,
  SOURCES_PATH,
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

/** A credit split for display: the (linkable) name and the rest, `" (<licence>, Stand <date>)"`. */
export interface CreditPart {
  name: string;
  href?: string;
  suffix: string;
}

/** `<name>` and ` (<licence>, Stand <date>)`; without a date only ", Stand …" drops out. */
export function creditPart(credit: SourceCredit, stand?: string): CreditPart {
  const parts = [credit.license, stand ? `Stand ${stand}` : undefined].filter(Boolean);
  return {
    name: credit.name,
    href: credit.href,
    suffix: parts.length > 0 ? ` (${parts.join(", ")})` : "",
  };
}

/** Plain text of a part. */
export function partText(part: CreditPart): string {
  return part.name + part.suffix;
}

/** `<name> (<licence>, Stand <date>)`; without a date only ", Stand …" drops out. */
export function creditText(credit: SourceCredit, stand?: string): string {
  return partText(creditPart(credit, stand));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML of a credit for the MapLibre attribution control (which sanitizes it, `a` with `href` and
 * `target` survive): the name is a link if the credit has a target. Only constants go in, but
 * everything is escaped anyway.
 */
export function creditHtml(credit: SourceCredit, stand?: string): string {
  const part = creditPart(credit, stand);
  const name = escapeHtml(part.name);
  const linked = part.href
    ? `<a href="${escapeHtml(part.href)}" target="_blank" rel="noopener">${name}</a>`
    : name;
  return linked + escapeHtml(part.suffix);
}

/** Wording on the PDF sheet margin: the credit's `print` text, else name and licence; no date. */
export function creditPrint(credit: SourceCredit): string {
  return credit.print ?? creditText({ ...credit, stand: undefined });
}

export interface Credits {
  /** HTML for the map attribution (with data dates, names linked). */
  osm: string;
  relief: string;
  busstops: string;
  /** PDF sheet margin: the sources without data dates, as plain text. */
  line: string;
  /** Sidebar footer: the sources with data dates, plus the search; the sidebar builds the links. */
  sidebar: CreditPart[];
}

export interface CreditInput {
  /** Formatted data dates (see osmStand, gtfsStand). */
  osm?: string;
  gtfs?: string;
  /** Without the bus stop file the source is not credited (default true). */
  busstopsAvailable?: boolean;
  relief?: SourceCredit;
  /**
   * Host of the site (`window.location.host`, never hard-coded): the PDF line points to
   * `<host>/quellen` for the licence references. Without it the pointer is left out.
   */
  host?: string;
}

export function buildCredits(input: CreditInput = {}): Credits {
  const relief = input.relief ?? RELIEF_CREDIT;
  const withBusstops = input.busstopsAvailable ?? true;
  const site = [
    creditPart(OSM_CREDIT, input.osm),
    creditPart(relief, relief.stand),
    ...(withBusstops ? [creditPart(BUSSTOPS_CREDIT, input.gtfs)] : []),
  ];
  return {
    osm: creditHtml(OSM_CREDIT, input.osm),
    relief: creditHtml(relief, relief.stand),
    busstops: creditHtml(BUSSTOPS_CREDIT, input.gtfs),
    line: [
      creditPrint(OSM_CREDIT),
      creditPrint(relief),
      ...(withBusstops ? [creditPrint(BUSSTOPS_CREDIT)] : []),
      ...(input.host ? [`Lizenzen: ${input.host}${SOURCES_PATH.replace(/\/$/, "")}`] : []),
    ].join(" · "),
    sidebar: [...site, { name: SEARCH_ATTRIBUTION, suffix: "" }],
  };
}
