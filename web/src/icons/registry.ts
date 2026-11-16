// POI pictogram definitions and the pure kind -> SVG builder (no DOM, testable with bun).
//
// Glyphs live in a 15 x 15 unit grid (the Maki/Temaki grid). Boxed pictograms put the
// glyph into a rounded square with a thin dark border; plain symbols get a white halo.
// Sizes are paper millimetres at the print zoom (style/units.ts: 1 CSS px = 0.2646 mm); the
// numbers live in style/sizes.ts.
import {
  ICON_MM,
  ICON_SMALL_MM,
  PLAIN_L_MM,
  PLAIN_MM,
  PLAIN_SMALL_MM,
  PLAIN_XL_MM,
  PLAIN_XS_MM,
} from "../style/sizes";
import { mm } from "../style/units";
import { CC0_GLYPHS, type Cc0GlyphName } from "./glyphs-cc0";

/** Colour token: "fg" = glyph colour of the style, "bg" = box fill, or a literal CSS colour. */
export type ColorToken = "fg" | "bg" | (string & {});

export interface GlyphPart {
  d: string;
  /** Default "fg" for filled parts, "none" if only `stroke` is given. */
  fill?: ColorToken;
  stroke?: ColorToken;
  /** In glyph units (15 per glyph). */
  strokeWidth?: number;
}

export type BoxStyle = "sight" | "food" | "lodging" | "camp" | "transport" | "water";
export type IconStyle = BoxStyle | "plain";

export interface IconDef {
  style: IconStyle;
  /** CC0 glyph name or own path parts (or both: CC0 base plus own overlay parts). */
  glyph: Cc0GlyphName | GlyphPart[];
  overlay?: GlyphPart[];
  /** Edge length on paper in mm. */
  sizeMm: number;
  /** Glyph colour for plain symbols (default near-black). */
  color?: string;
}

/** Box colours: yellow sights, red food, blue transport/water. */
export const BOX_STYLES: Record<BoxStyle, { bg: string; border: string; fg: string }> = {
  sight: { bg: "#ffd200", border: "#2a2a2a", fg: "#111111" },
  food: { bg: "#d42a2f", border: "#6e1114", fg: "#ffffff" },
  lodging: { bg: "#8a5a32", border: "#4a2c14", fg: "#ffffff" },
  camp: { bg: "#2f8a46", border: "#164a24", fg: "#ffffff" },
  transport: { bg: "#1d5fad", border: "#0d2f5a", fg: "#ffffff" },
  water: { bg: "#2a8fd4", border: "#0f4a78", fg: "#ffffff" },
};

const INK = "#161616";
const WATER_BLUE = "#1f6fb5";
const ROCK_BROWN = "#6b4a2e";
const FLAG_YELLOW = "#ffd200";
const BUS_GREEN = "#0a7d36";
const BUS_YELLOW = "#ffd84a";

/** Box: 20 units with a 0.8 unit border; glyph scaled to 14 units and centred. */
const BOX_UNITS = 20;
const BOX_GLYPH_SCALE = 14 / 15;
/** Plain: glyph 15 units plus 1.5 units halo margin on each side. */
const PLAIN_MARGIN = 1.5;
const PLAIN_UNITS = 15 + 2 * PLAIN_MARGIN;
const HALO_WIDTH = 2.4;

// --- Own glyphs (drawn for this project, MIT) -------------------------------------------

const circle = (cx: number, cy: number, r: number, reverse = false): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 ${reverse ? 1 : 0} ${2 * r} 0a${r} ${r} 0 1 ${reverse ? 1 : 0} ${-2 * r} 0Z`;

const LATIN_CROSS = "M6.75 0.5h1.5v2h2.25v1.5H8.25V8.2h-1.5V4H4.5V2.5h2.25Z";

/** Guidepost flag: pole at x = 2 from y = 1 to 15, pennant x 2.6–13, y 1–7.5. */
export const FLAG_POLE = { x: 2, bottom: 15, pennantRight: 13, pennantMidY: 4.25 };
const FLAG: GlyphPart[] = [
  { d: "M2 1V15", stroke: INK, strokeWidth: 1.3 },
  { d: "M2.6 1H13V7.5H2.6Z", fill: FLAG_YELLOW, stroke: INK, strokeWidth: 0.9 },
];

const OWN = {
  // Arch of a cave mouth.
  cave: [
    {
      d: "M1.5 13.5V9C1.5 4.6 4.3 2 7.5 2S13.5 4.6 13.5 9V13.5H10.3V9.4C10.3 7.6 9.1 6.2 7.5 6.2S4.7 7.6 4.7 9.4V13.5Z",
    },
  ],
  // Filled circle with cross: church. Ring with cross: chapel.
  church: [{ d: LATIN_CROSS }, { d: circle(7.5, 10.6, 3.6) }],
  chapel: [{ d: LATIN_CROSS }, { d: `${circle(7.5, 10.6, 3.6)}${circle(7.5, 10.6, 2.1, true)}` }],
  wayside_cross: [{ d: "M6.4 1h2.2v3.6h3v2.1h-3V14H6.4V6.7h-3V4.6h3Z" }],
  // Bildstock: pillar carrying a small gabled head with a niche.
  wayside_shrine: [
    { d: "M7.5 0.8L11.2 3.9V8.8H8.7V14.2H6.3V8.8H3.8V3.9Z" },
    { d: "M6.1 4.6H8.9V7.6H6.1Z", fill: "#fff" },
  ],
  spring: [
    { d: circle(6, 6, 3.6), stroke: "fg", strokeWidth: 1.6 },
    {
      d: "M8.7 8.7C10.2 10.1 9.4 11.6 10.9 12.6S13 13.2 14.2 14.2",
      stroke: "fg",
      strokeWidth: 1.4,
    },
  ],
  sinkhole: [
    { d: circle(7.5, 7.5, 5.2), stroke: "fg", strokeWidth: 1.3 },
    { d: "M7.5 2.3V5M7.5 12.7V10M2.3 7.5H5M12.7 7.5H10", stroke: "fg", strokeWidth: 1.3 },
  ],
  weir: [
    { d: "M1 5.5H14V8.5H1Z" },
    { d: "M3.5 9.5V13M7.5 9.5V13M11.5 9.5V13", stroke: "fg", strokeWidth: 1.2 },
  ],
  // Bus stop (GTFS), after the German stop sign (Zeichen 224): yellow disc, green ring, green H.
  busstop: [
    { d: circle(7.5, 7.5, 6.4), fill: BUS_YELLOW, stroke: BUS_GREEN, strokeWidth: 1.4 },
    { d: "M4.7 3.6h1.7v3h2.2v-3h1.7v7.8H8.6V8.2H6.4v3.2H4.7Z", fill: BUS_GREEN },
  ],
  flag: FLAG,
} satisfies Record<string, GlyphPart[]>;

// --- Registry ------------------------------------------------------------------------------

/** Icon name (image id without "poi:") -> definition. Names equal the tile `kind` values. */
export const POI_ICONS: Record<string, IconDef> = {
  railway_station: { style: "transport", glyph: "maki/rail", sizeMm: ICON_MM },
  railway_halt: { style: "transport", glyph: "maki/rail", sizeMm: ICON_SMALL_MM },
  viewtower: { style: "sight", glyph: "maki/observation-tower", sizeMm: ICON_MM },
  alpine_hut: { style: "sight", glyph: "maki/home", sizeMm: ICON_MM },
  wilderness_hut: { style: "sight", glyph: "temaki/sleep_shelter", sizeMm: ICON_MM },
  shelter: { style: "sight", glyph: "maki/shelter", sizeMm: ICON_MM },
  castle: { style: "sight", glyph: "maki/castle", sizeMm: ICON_MM },
  castle_ruins: {
    style: "sight",
    glyph: "maki/castle",
    // A crack through the castle marks the ruin.
    overlay: [{ d: "M9.6 4.2L7.6 7.2L9.2 8.8L7.2 11.6", stroke: "bg", strokeWidth: 1.2 }],
    sizeMm: ICON_MM,
  },
  ruins: { style: "sight", glyph: "temaki/ruins", sizeMm: ICON_MM },
  viewpoint: { style: "sight", glyph: "maki/viewpoint", sizeMm: ICON_MM },
  waterfall: { style: "sight", glyph: "maki/waterfall", sizeMm: ICON_MM },
  cave_entrance: { style: "sight", glyph: OWN.cave, sizeMm: ICON_MM },
  monument: { style: "sight", glyph: "maki/monument", sizeMm: ICON_SMALL_MM },
  picnic_site: { style: "sight", glyph: "maki/picnic-site", sizeMm: ICON_SMALL_MM },
  bbq: { style: "sight", glyph: "temaki/campfire", sizeMm: ICON_SMALL_MM },
  restaurant: { style: "food", glyph: "maki/restaurant", sizeMm: ICON_MM },
  cafe: { style: "food", glyph: "maki/cafe", sizeMm: ICON_MM },
  hostel: { style: "lodging", glyph: "temaki/bunk_beds", sizeMm: ICON_SMALL_MM },
  hotel: { style: "lodging", glyph: "maki/lodging", sizeMm: ICON_SMALL_MM },
  camp_site: { style: "camp", glyph: "maki/campsite", sizeMm: ICON_MM },
  caravan_site: { style: "camp", glyph: "temaki/camper_trailer", sizeMm: ICON_SMALL_MM },
  parking: { style: "transport", glyph: "maki/parking", sizeMm: ICON_SMALL_MM },
  toilets: { style: "transport", glyph: "maki/toilet", sizeMm: ICON_SMALL_MM },
  drinking_water: { style: "water", glyph: "maki/drinking-water", sizeMm: ICON_SMALL_MM },
  church: { style: "plain", glyph: OWN.church, sizeMm: PLAIN_L_MM },
  chapel: { style: "plain", glyph: OWN.chapel, sizeMm: PLAIN_MM },
  place_of_worship: { style: "plain", glyph: "maki/place-of-worship", sizeMm: PLAIN_MM },
  spring: { style: "plain", glyph: OWN.spring, sizeMm: PLAIN_MM, color: WATER_BLUE },
  weir: { style: "plain", glyph: OWN.weir, sizeMm: PLAIN_SMALL_MM, color: WATER_BLUE },
  guidepost: { style: "plain", glyph: OWN.flag, sizeMm: PLAIN_XL_MM },
  wayside_cross: { style: "plain", glyph: OWN.wayside_cross, sizeMm: PLAIN_SMALL_MM },
  wayside_shrine: { style: "plain", glyph: OWN.wayside_shrine, sizeMm: PLAIN_SMALL_MM },
  memorial: { style: "plain", glyph: "temaki/milestone", sizeMm: PLAIN_SMALL_MM },
  tower: { style: "plain", glyph: "temaki/tower", sizeMm: PLAIN_MM },
  communication_tower: { style: "plain", glyph: "temaki/tower_communication", sizeMm: PLAIN_MM },
  mast: { style: "plain", glyph: "temaki/mast", sizeMm: PLAIN_MM },
  wind_turbine: { style: "plain", glyph: "temaki/wind_turbine", sizeMm: PLAIN_MM },
  rock: { style: "plain", glyph: "temaki/boulder1", sizeMm: PLAIN_SMALL_MM, color: ROCK_BROWN },
  stone: { style: "plain", glyph: "temaki/boulder2", sizeMm: PLAIN_XS_MM, color: ROCK_BROWN },
  sinkhole: { style: "plain", glyph: OWN.sinkhole, sizeMm: PLAIN_SMALL_MM, color: ROCK_BROWN },
  // Not a tile kind: GTFS bus stops (own PMTiles file, layer `bus_stop`, no `kind`), drawn by the
  // `busstops` group. Larger than the other plain symbols so the "H" stays readable.
  busstop: { style: "plain", glyph: OWN.busstop, sizeMm: PLAIN_XL_MM },
  // Not a tile kind: unnamed guideposts get a smaller flag.
  guidepost_small: { style: "plain", glyph: OWN.flag, sizeMm: PLAIN_SMALL_MM },
};

/** Every `kind` of the `poi` tile layer (tiles/SCHEMA.md). */
export const POI_KINDS = [
  "railway_station",
  "viewtower",
  "alpine_hut",
  "castle",
  "castle_ruins",
  "wilderness_hut",
  "shelter",
  "viewpoint",
  "railway_halt",
  "waterfall",
  "cave_entrance",
  "ruins",
  "church",
  "chapel",
  "camp_site",
  "hostel",
  "restaurant",
  "cafe",
  "spring",
  "drinking_water",
  "guidepost",
  "parking",
  "monument",
  "picnic_site",
  "bbq",
  "hotel",
  "caravan_site",
  "toilets",
  "memorial",
  "communication_tower",
  "tower",
  "place_of_worship",
  "wayside_cross",
  "wayside_shrine",
  "rock",
  "stone",
  "sinkhole",
  "mast",
  "wind_turbine",
  "weir",
] as const;
export type PoiKind = (typeof POI_KINDS)[number];

/** An SVG to rasterise; width/height are CSS px at the print zoom (pixel ratio 1). */
export interface SvgImage {
  svg: string;
  width: number;
  height: number;
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function resolveColor(token: ColorToken | undefined, fg: string, bg: string): string | undefined {
  if (token === undefined) return undefined;
  if (token === "fg") return fg;
  if (token === "bg") return bg;
  return token;
}

function partsOf(def: IconDef): GlyphPart[] {
  const base =
    typeof def.glyph === "string" ? CC0_GLYPHS[def.glyph].map((d) => ({ d })) : def.glyph;
  return [...base, ...(def.overlay ?? [])];
}

function pathEl(part: GlyphPart, fg: string, bg: string): string {
  const fill = resolveColor(part.fill ?? (part.stroke ? "none" : "fg"), fg, bg)!;
  const stroke = resolveColor(part.stroke, fg, bg);
  const strokeAttrs = stroke
    ? ` stroke="${stroke}" stroke-width="${fmt(part.strokeWidth ?? 1)}" stroke-linejoin="round" stroke-linecap="round"`
    : "";
  return `<path d="${part.d}" fill="${fill}"${strokeAttrs}/>`;
}

/** White outline under a plain glyph so it stays legible on forest, hillshade and roads. */
function haloEl(part: GlyphPart): string {
  const filled = part.fill !== "none" && (part.fill !== undefined || !part.stroke);
  const w = (part.stroke ? (part.strokeWidth ?? 1) : 0) + HALO_WIDTH;
  return `<path d="${part.d}" fill="${filled ? "#fff" : "none"}" stroke="#fff" stroke-width="${fmt(w)}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** Builds the SVG for an icon definition. */
export function iconSvg(def: IconDef): SvgImage {
  const size = mm(def.sizeMm);
  const parts = partsOf(def);
  let body: string;
  let units: number;
  if (def.style === "plain") {
    units = PLAIN_UNITS;
    const fg = def.color ?? INK;
    body =
      `<g transform="translate(${PLAIN_MARGIN} ${PLAIN_MARGIN})" opacity="1">` +
      `<g opacity="0.92">${parts.map(haloEl).join("")}</g>` +
      parts.map((p) => pathEl(p, fg, "#fff")).join("") +
      `</g>`;
  } else {
    units = BOX_UNITS;
    const s = BOX_STYLES[def.style];
    const offset = (BOX_UNITS - 15 * BOX_GLYPH_SCALE) / 2;
    body =
      `<rect x="0.6" y="0.6" width="18.8" height="18.8" rx="3" fill="${s.bg}" stroke="${s.border}" stroke-width="0.8"/>` +
      `<g transform="translate(${fmt(offset)} ${fmt(offset)}) scale(${fmt(BOX_GLYPH_SCALE)})">` +
      parts.map((p) => pathEl(p, s.fg, s.bg)).join("") +
      `</g>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${units} ${units}">${body}</svg>`;
  return { svg, width: size, height: size };
}

/** Image provider for the "poi" prefix: icon name -> SVG, or undefined if unknown. */
export function poiIconSvg(name: string): SvgImage | undefined {
  const def = POI_ICONS[name];
  return def ? iconSvg(def) : undefined;
}

/**
 * Offset (CSS px at icon-size 1) that puts the foot of the flag pole exactly on the point when
 * the icon is anchored "bottom-left", plus where the pennant is relative to that point.
 */
export function flagGeometry(name: "guidepost" | "guidepost_small"): {
  iconOffset: [number, number];
  pennantRightPx: number;
  pennantMidYPx: number;
} {
  const pxPerUnit = mm(POI_ICONS[name]!.sizeMm) / PLAIN_UNITS;
  const poleX = PLAIN_MARGIN + FLAG_POLE.x;
  const below = PLAIN_UNITS - (PLAIN_MARGIN + FLAG_POLE.bottom);
  return {
    iconOffset: [-poleX * pxPerUnit, below * pxPerUnit],
    pennantRightPx: (FLAG_POLE.pennantRight - FLAG_POLE.x) * pxPerUnit,
    pennantMidYPx: -(FLAG_POLE.bottom - FLAG_POLE.pennantMidY) * pxPerUnit,
  };
}
