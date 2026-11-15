// Source credits (pure, testable): `<name> (<licence>, as of <date>)` per source, in the active
// language (or the `locale` passed in; "Stand <date>" in German).
//
// The data date is shown on the website only (sidebar footer, map attribution). The PDF sheet
// margin carries the same sources without a date (`line`, by decision), with the OSM copyright
// URL and a pointer to the sources page as text (a printed page has no links).
import {
  busstopsCredit,
  osmCredit,
  reliefCredit,
  searchAttribution,
  SOURCES_PATH,
  type SourceCredit,
} from "./config";
import type { Locale } from "./i18n";
import { m } from "./paraglide/messages.js";
import { getLocale } from "./paraglide/runtime.js";

/** Planetiler writes the replication time of the OSM extract into the PMTiles metadata. */
const OSM_STAND_KEY = "planetiler:osm:osmosisreplicationtime";
/** transit/build.sh writes `feed_date=YYYY-MM-DD` into the description of the bus stop file. */
const GTFS_FEED_DATE = /feed_date=(\d{4}-\d{2}-\d{2})/;

/**
 * "2026-11-12T21:23:05Z" -> "12.11.2026" (de) or "Nov 12, 2026" (en): the UTC date part, in the
 * locale's medium date format; undefined if it is no ISO date.
 */
export function formatStand(iso: string, locale: Locale = getLocale()): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(iso.trim());
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function record(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

/** Data date of the OSM extract from the PMTiles metadata, formatted; undefined if unknown. */
export function osmStand(meta: unknown, locale?: Locale): string | undefined {
  const value = record(meta)[OSM_STAND_KEY];
  return typeof value === "string" ? formatStand(value, locale) : undefined;
}

/** Feed date of the bus stop file from the PMTiles metadata (description), formatted. */
export function gtfsStand(meta: unknown, locale?: Locale): string | undefined {
  const description = record(meta).description;
  const match = typeof description === "string" ? GTFS_FEED_DATE.exec(description) : null;
  return match ? formatStand(match[1]!, locale) : undefined;
}

/** A credit split for display: the (linkable) name and the rest, `" (<licence>, as of <date>)"`. */
export interface CreditPart {
  name: string;
  href?: string;
  suffix: string;
}

/** `<name>` and ` (<licence>, as of <date>)`; without a date only ", as of …" drops out. */
export function creditPart(credit: SourceCredit, stand?: string, locale?: Locale): CreditPart {
  const parts = [
    credit.license,
    stand ? m.credit_stand({ date: stand }, { locale }) : undefined,
  ].filter(Boolean);
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

/** `<name> (<licence>, as of <date>)`; without a date only ", as of …" drops out. */
export function creditText(credit: SourceCredit, stand?: string, locale?: Locale): string {
  return partText(creditPart(credit, stand, locale));
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
export function creditHtml(credit: SourceCredit, stand?: string, locale?: Locale): string {
  const part = creditPart(credit, stand, locale);
  const name = escapeHtml(part.name);
  const linked = part.href
    ? `<a href="${escapeHtml(part.href)}" target="_blank" rel="noopener">${name}</a>`
    : name;
  return linked + escapeHtml(part.suffix);
}

/** Wording on the PDF sheet margin: the credit's `print` text, else name and licence; no date. */
export function creditPrint(credit: SourceCredit, locale?: Locale): string {
  return credit.print ?? creditText({ ...credit, stand: undefined }, undefined, locale);
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
  /** Language of the texts; default: the active locale. Pass `relief` in the same language. */
  locale?: Locale;
  /**
   * Host of the site (`window.location.host`, never hard-coded): the PDF line points to
   * `<host>/quellen` for the licence references. Without it the pointer is left out.
   */
  host?: string;
}

export function buildCredits(input: CreditInput = {}): Credits {
  const locale = input.locale;
  const osm = osmCredit(locale);
  const busstops = busstopsCredit(locale);
  const relief = input.relief ?? reliefCredit(locale);
  const withBusstops = input.busstopsAvailable ?? true;
  const site = [
    creditPart(osm, input.osm, locale),
    creditPart(relief, relief.stand, locale),
    ...(withBusstops ? [creditPart(busstops, input.gtfs, locale)] : []),
  ];
  return {
    osm: creditHtml(osm, input.osm, locale),
    relief: creditHtml(relief, relief.stand, locale),
    busstops: creditHtml(busstops, input.gtfs, locale),
    line: [
      creditPrint(osm, locale),
      creditPrint(relief, locale),
      ...(withBusstops ? [creditPrint(busstops, locale)] : []),
      ...(input.host
        ? [
            m.credit_licences_pointer(
              { url: `${input.host}${SOURCES_PATH.replace(/\/$/, "")}` },
              { locale },
            ),
          ]
        : []),
    ].join(" · "),
    sidebar: [...site, { name: searchAttribution(locale), suffix: "" }],
  };
}
