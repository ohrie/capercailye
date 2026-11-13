// Waymark signs (M3, PLAN.md 3): public API for the style layers.
//
// Tile layer `routes` (tiles/SCHEMA.md) carries per way segment the |-joined, slot-aligned lists
// `symbols` (osmc:symbol), `refs`, `colours` and `names` (at most 4 routes, deduplicated by the
// tile build). The style builds ONE image id per feature from these four attributes with
// waymarkImageExpression(); the image provider registered here (prefix "waymark", icons/runtime.ts)
// parses the id back, runs the fallback chain per route, drops equal signs and draws all signs side
// by side in one SVG in print size. MapLibre therefore places one symbol per segment and cannot
// drop single signs of a combined waymark by collision.
//
// Image id format:
//
//   "waymark:" symbols US refs US colours US names        (US = U+001F, unit separator)
//
// i.e. the four raw tile attributes in this order, separated by U+001F. Control characters are not
// allowed in OSM tag values, and "|" inside values is already replaced by "/" in the tiles, so
// both separators are unambiguous. Ids are long but stable; equal attribute sets share an image.
//
// Usage in a layer (sketch):
//
//   layout: { "icon-image": waymarkImageExpression(), "symbol-placement": "line", ... }
//
// The module registers its provider on import (like style/shields.ts).
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { SvgImage } from "../icons/registry";
import { registerImageProvider } from "../icons/runtime";
import { waymarkSvg, type WaymarkEntry } from "./render";

export {
  parseOsmc,
  cleanText,
  osmcColour,
  OSMC_COLOURS,
  FOREGROUND_SHAPES,
  BACKGROUND_SHAPES,
} from "./parse";
export type {
  ParsedOsmc,
  OsmcBackground,
  OsmcForeground,
  ForegroundShape,
  BackgroundShape,
} from "./parse";
export {
  osmcToSvg,
  waymarkSvg,
  resolveSign,
  resolveSigns,
  nameAbbreviation,
  routeColour,
  contrast,
  WAYMARK_HEIGHT_MM,
  WAYMARK_GAP_MM,
  WAYMARK_MAX_SIGNS,
} from "./render";
export type { WaymarkEntry, Sign, SignOptions } from "./render";

/** Image id prefix of combined waymark images ("waymark:<…>"). */
export const WAYMARK_IMAGE_PREFIX = "waymark";

/** Separator between the four attribute lists in an image id (U+001F, unit separator). */
export const WAYMARK_FIELD_SEPARATOR = "\u001f";

/** Separator of the route slots inside one attribute (as in the tiles). */
export const WAYMARK_SLOT_SEPARATOR = "|";

const FIELDS = ["symbols", "refs", "colours", "names"] as const;

/**
 * MapLibre expression for `icon-image`: "waymark:" + symbols US refs US colours US names, built
 * from the `routes` feature attributes (missing attributes count as empty).
 */
export function waymarkImageExpression(): ExpressionSpecification {
  const parts: (string | ExpressionSpecification)[] = [`${WAYMARK_IMAGE_PREFIX}:`];
  FIELDS.forEach((f, i) => {
    if (i > 0) parts.push(WAYMARK_FIELD_SEPARATOR);
    parts.push(["coalesce", ["to-string", ["get", f]], ""] as ExpressionSpecification);
  });
  return ["concat", ...parts] as ExpressionSpecification;
}

/** Builds the image id from feature attributes (same result as the expression; for tests/tools). */
export function waymarkImageId(props: Partial<Record<(typeof FIELDS)[number], string>>): string {
  return `${WAYMARK_IMAGE_PREFIX}:${FIELDS.map((f) => props[f] ?? "").join(WAYMARK_FIELD_SEPARATOR)}`;
}

/** Parses the name part of an image id (without "waymark:") into one entry per route slot. */
export function parseWaymarkId(name: string): WaymarkEntry[] {
  const fields = name.split(WAYMARK_FIELD_SEPARATOR).map((f) => f.split(WAYMARK_SLOT_SEPARATOR));
  const slots = Math.max(...fields.map((f) => f.length));
  const entries: WaymarkEntry[] = [];
  for (let i = 0; i < slots; i++) {
    const get = (k: number): string | undefined => {
      const v = fields[k]?.[i]?.trim();
      return v ? v : undefined;
    };
    const e: WaymarkEntry = {};
    const osmc = get(0);
    const ref = get(1);
    const colour = get(2);
    const routeName = get(3);
    if (osmc) e.osmc = osmc;
    if (ref) e.ref = ref;
    if (colour) e.colour = colour;
    if (routeName) e.name = routeName;
    entries.push(e);
  }
  return entries;
}

/** Image provider: name part of "waymark:<…>" -> combined SVG (undefined if nothing to show). */
export function waymarkImage(name: string): SvgImage | undefined {
  return waymarkSvg(parseWaymarkId(name));
}

registerImageProvider(WAYMARK_IMAGE_PREFIX, waymarkImage);
