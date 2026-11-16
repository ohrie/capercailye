// Legend symbols for the sidebar switches (pure, no DOM): the sidebar doubles as the legend.
//
// Every image comes from the same sources as the map: pictograms from `poiIconSvg`, waymarks from
// `osmcToSvg`, colours from COLORS and line widths from the constants the style modules export.
// No colour is written down here.
//
// Pictograms and waymarks are SvgImages in CSS px at print zoom, like on the map; the sidebar shows
// every legend image at LEGEND_SCALE. The signatures (lines, areas, text) are drawn in a field of
// SIGNATURE_VIEWBOX units whose SvgImage size is 0.8 of that, so after LEGEND_SCALE one unit is one
// CSS px and the widths (paper mm via `mm()`, at least 1 px) are exactly what is on screen.
import { POI_KINDS, poiIconSvg, type SvgImage } from "./icons/registry";
import { osmcToSvg } from "./osmc/render";
import { BUILDING_OUTLINE_MM } from "./style/buildings";
import { CONTOUR_INDEX_MM, CONTOUR_MM, HILLSHADE_SHADOW } from "./style/hillshade";
import { FOREST_EDGE_MM, QUARRY_EDGE_MM } from "./style/landcover";
import { COLORS } from "./style/palette";
import { POI_CATEGORIES } from "./style/poi";
import { PROTECTED_BANDS } from "./style/protected";
import { BAND_MAJOR_MM, BAND_MAJOR_OPACITY } from "./style/routes";
import { WAYMARK_GAP_MM } from "./style/sizes";
import { PATH_MM } from "./style/transport";
import { mm } from "./style/units";
import { WATER_OUTLINE_MM } from "./style/water";

/** Display scale of legend images in the sidebar. */
export const LEGEND_SCALE = 1.25;
/** Display scale of pictograms in the legend dialog (a box icon becomes about 28-32 CSS px). */
export const LEGEND_DIALOG_SCALE = 2.5;
/** Display scale of the area swatches in the legend dialog (32x12.8 -> 60x24 CSS px). */
export const LEGEND_DIALOG_AREA_SCALE = 1.875;
/** Cell of the legend column in CSS px (symbols are left-aligned and vertically centred in it). */
export const LEGEND_CELL = { width: 40, height: 18 } as const;
/** Field of the signatures (viewBox units = CSS px on screen). */
export const SIGNATURE_VIEWBOX = { width: 40, height: 16 } as const;

/** The waymark example: red/white/red horizontal bar (the common "red bar" of a Hauptwanderweg). */
const WAYMARK_EXAMPLE = "red:white:red_bar";

/** Groups with sidebar switches but no symbol of their own (sub-switches). */
export const NO_LEGEND = /^net-|^guidepostnames$/;

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
/** Paper mm -> px of the signature field, at least 1 px. */
const px = (value: number): number => Math.max(1, mm(value));

/** `onPaper`: the field is filled with the map's paper colour, for areas that are light themselves. */
function signature(body: string, onPaper = false): SvgImage {
  const { width, height } = SIGNATURE_VIEWBOX;
  const paper = onPaper ? `<rect width="${width}" height="${height}" fill="${COLORS.paper}"/>` : "";
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paper}${body}</svg>`,
    width: width / LEGEND_SCALE,
    height: height / LEGEND_SCALE,
  };
}

const line = (d: string, color: string, width: number, extra = ""): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(width)}" stroke-linecap="round"${extra}/>`;

/** Band with the way line and the example waymark on it: the signs belong to the routes. */
function routes(): SvgImage {
  const { width, height } = SIGNATURE_VIEWBOX;
  const d = `M3 ${height / 2}H${width - 3}`;
  const sign = osmcToSvg(WAYMARK_EXAMPLE);
  // The signature field shows its units 1:1, the sign image is in print px: scale it up.
  const placed = sign
    ? nested(
        { ...sign, width: sign.width * LEGEND_SCALE, height: sign.height * LEGEND_SCALE },
        (width - sign.width * LEGEND_SCALE) / 2,
        (height - sign.height * LEGEND_SCALE) / 2,
      )
    : "";
  return signature(
    line(d, COLORS.route, px(BAND_MAJOR_MM), ` opacity="${BAND_MAJOR_OPACITY}"`) +
      line(d, COLORS.path, px(PATH_MM)) +
      placed,
  );
}

function contours(): SvgImage {
  const normal = px(CONTOUR_MM);
  // The index line is a little stronger, even where both would round up to the 1 px minimum.
  const index = Math.max(px(CONTOUR_INDEX_MM), normal * 1.5);
  return signature(
    line("M2 5Q10 1 20 5T38 5", COLORS.contour, normal) +
      line("M2 11Q10 7 20 11T38 11", COLORS.contourIndex, index),
  );
}

function hillshade(): SvgImage {
  // Lit slope towards the north west (illumination direction 315), shadow on the far side.
  const outline = "M5 14L17 2L24 9L28 6L35 14Z";
  return signature(
    `<path d="${outline}" fill="${COLORS.scree}"/>` +
      `<path d="M17 2L24 9L28 6L35 14H22Z" fill="${HILLSHADE_SHADOW}"/>`,
  );
}

function protectedArea(kind = "nature_reserve", onPaper = false): SvgImage {
  // A band lying inside the boundary, as on the map (the stroke is centred on an inset rectangle).
  const [, bandMm, color] = PROTECTED_BANDS.find(([k]) => k === kind)!;
  const w = px(bandMm);
  const x = 4;
  const y = 2;
  const width = SIGNATURE_VIEWBOX.width - 2 * x;
  const height = SIGNATURE_VIEWBOX.height - 2 * y;
  return signature(
    `<rect x="${fmt(x + w / 2)}" y="${fmt(y + w / 2)}" width="${fmt(width - w)}" height="${fmt(height - w)}" fill="none" stroke="${color}" stroke-width="${fmt(w)}"/>`,
    onPaper,
  );
}

function buildings(onPaper = false): SvgImage {
  const stroke = `stroke="${COLORS.buildingOutline}" stroke-width="${fmt(px(BUILDING_OUTLINE_MM))}"`;
  const fill = `fill="${COLORS.building}"`;
  return signature(
    `<rect x="7" y="4.5" width="11" height="8" ${fill} ${stroke}/>` +
      `<rect x="22" y="6.5" width="10" height="6" ${fill} ${stroke}/>`,
    onPaper,
  );
}

function labels(): SvgImage {
  return signature(
    `<text x="20" y="12.5" text-anchor="middle" font-family="sans-serif" font-size="13" fill="${COLORS.textPlace}">Aa</text>`,
  );
}

/** Nested <svg> of an image: its viewBox and content, placed at x/y with its own size. */
function nested(image: SvgImage, x: number, y: number): string {
  const m = /^<svg [^>]*?viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/.exec(image.svg);
  if (!m) throw new Error("Legendenbild ohne viewBox");
  return `<svg x="${fmt(x)}" y="${fmt(y)}" width="${fmt(image.width)}" height="${fmt(image.height)}" viewBox="${m[1]}">${m[2]}</svg>`;
}

/** Images side by side with the waymark gap, vertically centred (a single image stays as it is). */
function row(images: SvgImage[]): SvgImage | undefined {
  if (images.length === 0) return undefined;
  if (images.length === 1) return images[0];
  const gap = mm(WAYMARK_GAP_MM);
  const width = images.reduce((sum, i) => sum + i.width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map((i) => i.height));
  let x = 0;
  const parts = images.map((image) => {
    const part = nested(image, x, (height - image.height) / 2);
    x += image.width + gap;
    return part;
  });
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}">${parts.join("")}</svg>`,
    width,
    height,
  };
}

const kinds = (...names: string[]): SvgImage | undefined =>
  row(names.map((n) => poiIconSvg(n)).filter((i): i is SvgImage => i !== undefined));

/**
 * Legend image of a sidebar switch, or undefined for the sub-switches (route networks, guidepost
 * names). Several kinds of a group: at most two side by side.
 */
export function legendSvg(groupId: string): SvgImage | undefined {
  if (NO_LEGEND.test(groupId)) return undefined;
  const category = POI_CATEGORIES.find((c) => c.id === groupId);
  if (category) return kinds(...category.legend);
  switch (groupId) {
    case "routes":
      return routes();
    case "contours":
      return contours();
    case "hillshade":
      return hillshade();
    case "protected":
      return protectedArea();
    case "buildings":
      return buildings();
    case "labels":
      return labels();
    case "viewpoints":
      return kinds("viewpoint");
    case "busstops":
      return kinds("busstop");
    case "poi":
      return kinds("church", "railway_station");
    default:
      return undefined;
  }
}

/** Filled rectangle over the whole field, with the outline the map draws on it (inset, so it stays inside). */
function swatch(fill: string, edge?: { color: string; mm: number }): SvgImage {
  const { width, height } = SIGNATURE_VIEWBOX;
  const w = edge ? px(edge.mm) : 0;
  const stroke = edge ? ` stroke="${edge.color}" stroke-width="${fmt(w)}"` : "";
  return signature(
    `<rect x="${fmt(w / 2)}" y="${fmt(w / 2)}" width="${fmt(width - w)}" height="${fmt(height - w)}" fill="${fill}"${stroke}/>`,
  );
}

/** Area kinds of the legend with their swatch: land cover (style/landcover.ts) and water. */
const AREAS: [string, SvgImage][] = [
  ["forest", swatch(COLORS.forest, { color: COLORS.forestEdge, mm: FOREST_EDGE_MM })],
  ["meadow", swatch(COLORS.meadow)],
  ["farmland", swatch(COLORS.farmland)],
  ["orchard", swatch(COLORS.orchard)],
  ["vineyard", swatch(COLORS.vineyard)],
  ["heath", swatch(COLORS.heath)],
  ["scrub", swatch(COLORS.scrub)],
  ["wetland", swatch(COLORS.wetland)],
  ["bare_rock", swatch(COLORS.bareRock)],
  ["scree", swatch(COLORS.scree)],
  ["quarry", swatch(COLORS.quarry, { color: COLORS.quarryLine, mm: QUARRY_EDGE_MM })],
  ["residential", swatch(COLORS.residential)],
  ["commercial", swatch(COLORS.commercial)],
  ["industrial", swatch(COLORS.industrial)],
  ["water", swatch(COLORS.water, { color: COLORS.waterOutline, mm: WATER_OUTLINE_MM })],
];

/** One entry of the static legend: an image and the message keys of its text. */
export interface LegendEntry {
  /** Pictogram kind (`busstop` included) or area name, unique within the symbols / the areas. */
  key: string;
  labelKey: string;
  image: SvgImage;
}

export interface LegendGroup {
  id: string;
  section: "symbols" | "areas";
  /** Heading of the group; none for the areas (their section heading is enough). */
  titleKey?: string;
  entries: LegendEntry[];
}

/** Message key of the section headings of the legend. */
export const LEGEND_SECTION_KEYS = {
  symbols: "legend_section_symbols",
  areas: "legend_section_areas",
} as const;

/** Pictograms that stand apart from the categories (own switch, but no POI_CATEGORIES entry). */
const SINGLE_GROUPS = [
  { id: "viewpoints", kind: "viewpoint" },
  { id: "busstops", kind: "busstop" },
];

const symbol = (kind: string): LegendEntry => ({
  key: kind,
  labelKey: `legend_kind_${kind}`,
  image: poiIconSvg(kind)!,
});

/**
 * The whole legend, independent of the switches (pure data, built by the dialog on first use):
 * every pictogram kind once, grouped like the sidebar switches, then the areas. No routes, no
 * line signatures. `guidepost_small` is only a variant of `guidepost` and not listed.
 */
export function legendCatalog(): LegendGroup[] {
  const grouped = new Set<string>(POI_CATEGORIES.flatMap((c) => c.kinds));
  for (const g of SINGLE_GROUPS) grouped.add(g.kind);
  const rest = POI_KINDS.filter((k) => !grouped.has(k));
  const symbols: LegendGroup[] = [
    ...POI_CATEGORIES.map((c) => ({
      id: c.id,
      section: "symbols" as const,
      titleKey: `layer_${c.id}`,
      entries: c.kinds.map(symbol),
    })),
    ...SINGLE_GROUPS.map((g) => ({
      id: g.id,
      section: "symbols" as const,
      titleKey: `layer_${g.id}`,
      entries: [symbol(g.kind)],
    })),
    { id: "poi", section: "symbols", titleKey: "layer_poi", entries: rest.map(symbol) },
  ];
  const areas: LegendEntry[] = [
    ...AREAS.map(([key, image]) => ({ key, labelKey: `legend_area_${key}`, image })),
    ...PROTECTED_BANDS.map(([kind]) => ({
      key: kind,
      labelKey: `legend_area_${kind}`,
      image: protectedArea(kind, true),
    })),
    { key: "building", labelKey: "layer_buildings", image: buildings(true) },
  ];
  return [...symbols, { id: "areas", section: "areas", entries: areas }];
}

/** `data:` URL of an image for an <img src>. */
export function legendDataUrl(image: SvgImage): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.svg)}`;
}
