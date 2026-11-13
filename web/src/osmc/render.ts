// Waymark signs as SVG: a single osmc:symbol (osmcToSvg), the fallback chain for routes without a
// readable symbol (ref + colour -> ref -> name initials, PLAN.md 3) and the combined image of all
// routes on a way segment (waymarkSvg). Pure functions, no DOM.
//
// Look: every sign sits on a small white plate with a thin dark outline, like an enamel sign
// screwed to a tree: the outline separates the sign from forest/meadow colours, the white rim
// keeps coloured backgrounds apart from the outline. Sizes are paper mm (style/units.ts).
import type { SvgImage } from "../icons/registry";
import { mm } from "../style/units";
import { osmcColour, parseOsmc, type ParsedOsmc } from "./parse";
import { circle, foregroundElems, path, rect, render, type Elem, type Halo } from "./shapes";

/** Height of one sign (plate) on paper in mm. */
export const WAYMARK_HEIGHT_MM = 4.8;
/** Gap between two signs of a combined image in mm. */
export const WAYMARK_GAP_MM = 0.5;
/** At most this many signs per image (the tiles cap at 4 as well). */
export const WAYMARK_MAX_SIGNS = 4;

const OUTLINE_MM = 0.12;
const RIM_MM = 0.3;
const OUTLINE = "#2b2b2b";
const WHITE = "#ffffff";
const DARK = "#1d1d1b";
const FONT_FAMILY = "'DejaVu Sans','Liberation Sans',Arial,Helvetica,sans-serif";

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

export interface WaymarkEntry {
  /** Raw `osmc:symbol`. */
  osmc?: string;
  ref?: string;
  /** Raw `colour` tag (OSMC colour name or #hex). */
  colour?: string;
  name?: string;
}

/** A resolved sign: what one route shows after the fallback chain. */
export type Sign =
  | { kind: "osmc"; key: string; parsed: ParsedOsmc }
  | { kind: "ref-colour"; key: string; text: string; colour: string }
  | { kind: "ref"; key: string; text: string }
  | { kind: "name"; key: string; text: string };

export interface SignOptions {
  /** Plate height on paper in mm (default WAYMARK_HEIGHT_MM). */
  heightMm?: number;
}

// --- Colours --------------------------------------------------------------------------------

/** `colour` tag -> hex: OSMC names, CSS hex (#rgb, #rrggbb); first value of a list. */
export function routeColour(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(";")[0]!.trim().toLowerCase();
  const named = osmcColour(first);
  if (named) return named;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(first)) return first;
  return undefined;
}

function rgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two hex colours. */
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

const isLight = (hex: string): boolean => luminance(hex) > 0.4;
const against = (hex: string): string => (isLight(hex) ? DARK : WHITE);

// --- Fallback chain -------------------------------------------------------------------------

const STOPWORDS = new Set(
  "der die das den dem des am im an auf aus bei beim von vom zum zur zu und in ob unter über um mit nach ins a the of".split(
    " ",
  ),
);

/**
 * Short form of a route name for the last fallback: initials of the significant words, numbers
 * kept whole ("Rundweg 3" -> "R3", "Weg der Sinne" -> "WS"), a single word gives its first three
 * letters ("Panoramaweg" -> "Pan"). At most 4 characters.
 */
export function nameAbbreviation(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const words = name
    .replace(/[()[\]"„“”'.,]/g, " ")
    .split(/[\s\-–—/+&]+/)
    .filter((w) => w.length > 0);
  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const use = significant.length > 0 ? significant : words;
  if (use.length === 0) return undefined;
  if (use.length === 1) {
    const w = use[0]!;
    return /^\d+[a-z]?$/i.test(w) ? w.slice(0, 4) : Array.from(w).slice(0, 3).join("");
  }
  let out = "";
  for (const w of use) {
    out += /^\d+[a-z]?$/i.test(w) ? w : Array.from(w)[0]!.toUpperCase();
    if (Array.from(out).length >= 4) break;
  }
  return Array.from(out).slice(0, 4).join("");
}

/** Cleans a ref for display: trimmed, first value of a list, at most 6 characters. */
function cleanRef(ref: string | undefined): string | undefined {
  const r = ref?.split(";")[0]?.trim();
  if (!r) return undefined;
  return Array.from(r).slice(0, 6).join("");
}

function osmcKey(p: ParsedOsmc): string {
  return `o:${JSON.stringify([p.background, p.foreground, p.text ?? "", p.textColour ?? ""])}`;
}

/**
 * The sign one route shows: `osmc:symbol` if readable; otherwise `ref` in a frame of the route
 * colour (`colour` tag, or the way colour of an unreadable symbol); otherwise `ref`; otherwise
 * initials of the name. Undefined if the route has nothing to show.
 */
export function resolveSign(entry: WaymarkEntry): Sign | undefined {
  const parsed = entry.osmc?.trim() ? parseOsmc(entry.osmc) : undefined;
  if (parsed?.readable) return { kind: "osmc", key: osmcKey(parsed), parsed };
  const ref = cleanRef(entry.ref);
  if (ref) {
    const colour = routeColour(entry.colour) ?? parsed?.waycolor;
    if (colour) return { kind: "ref-colour", key: `r:${ref}:${colour}`, text: ref, colour };
    return { kind: "ref", key: `r:${ref}:`, text: ref };
  }
  const abbr = nameAbbreviation(entry.name);
  if (abbr) return { kind: "name", key: `n:${abbr}`, text: abbr };
  return undefined;
}

/** Resolves, deduplicates (same rendered sign once, first wins) and caps the entries. */
export function resolveSigns(entries: readonly WaymarkEntry[]): Sign[] {
  const seen = new Set<string>();
  const out: Sign[] = [];
  for (const e of entries) {
    const s = resolveSign(e);
    if (!s || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s);
    if (out.length >= WAYMARK_MAX_SIGNS) break;
  }
  return out;
}

// --- Drawing --------------------------------------------------------------------------------

/** A sign's content in units (20 = content height of a normal sign). */
interface Graphic {
  w: number;
  h: number;
  /** SVG body in units; `id` makes clip ids unique within one image. */
  body: (id: string) => string;
}

/** Rough advance width of a character in em (bold sans). */
function charEm(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp > 0x2e7f) return 1.05; // CJK, emoji
  if (cp > 0x24f) return 0.8; // symbols
  if ("WMmw".includes(ch)) return 0.95;
  if ("Iijl|!.,:;'".includes(ch)) return 0.36;
  if (ch >= "A" && ch <= "Z") return 0.74;
  if (ch >= "0" && ch <= "9") return 0.66;
  return 0.6;
}

const textEm = (t: string): number => Array.from(t).reduce((s, c) => s + charEm(c), 0);

function textElem(
  text: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  opts: { italic?: boolean; halo?: string } = {},
): string {
  const esc = text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const halo = opts.halo
    ? ` stroke="${opts.halo}" stroke-width="${num(size * 0.13)}" stroke-linejoin="round" paint-order="stroke"`
    : "";
  return (
    `<text x="${num(x)}" y="${num(y)}" text-anchor="middle" font-family="${FONT_FAMILY}" ` +
    `font-weight="700"${opts.italic ? ' font-style="italic"' : ""} font-size="${num(size)}" ` +
    `fill="${colour}"${halo}>${esc}</text>`
  );
}

/** Foreground shapes whose fill covers the sign centre (where the text sits). */
const CENTRE_FILL = new Set([
  "diamond",
  "dot",
  "rectangle",
  "cross",
  "bar",
  "stripe",
  "triangle",
  "triangle_turned",
  "hexagon",
  "pointer",
  "left_pointer",
  "crest",
  "house",
  "drop",
  "heart",
]);

/** Room for the text by what lies behind it: share of the sign width, max size in units. */
const TEXT_ROOM: Record<string, [number, number]> = {
  diamond: [0.56, 8],
  diamond_line: [0.5, 8],
  dot: [0.58, 9],
  hexagon: [0.62, 9],
  triangle: [0.42, 6.5],
  triangle_turned: [0.55, 6.5],
  pointer: [0.45, 7],
  left_pointer: [0.45, 7],
  circle: [0.56, 8.5],
  rectangle: [0.48, 7.5],
};

function osmcGraphic(p: ParsedOsmc): Graphic {
  const bg = p.background;
  let w = 20;
  let h = 20;
  if (bg.shape === "stripe") w = 10;
  else if (bg.shape === "bar") h = 10;
  else if (bg.shape === "diamond" || bg.shape === "diamond_line") w = 32;
  const hu = h / 20;
  const wu = w / 20;

  // Background layer, clip area, effective colour behind the foreground.
  const bgElems: Elem[] = [];
  let clip: Elem = rect(0, 0, w, h, {});
  let behind = WHITE;
  let textRoom: [number, number] = [0.86, 12];
  const inner = bg.colour2 ?? WHITE;
  const c = bg.colour;
  if (c) {
    switch (bg.shape) {
      case undefined:
      case "bar":
      case "stripe":
        bgElems.push(rect(0, 0, w, h, { fill: c }));
        behind = c;
        break;
      case "circle":
        bgElems.push(circle(w / 2, h / 2, hu * 8.6, { fill: inner, stroke: c, sw: hu * 2.4 }));
        clip = circle(w / 2, h / 2, hu * 7.6, {});
        behind = inner;
        textRoom = [0.62, 10];
        break;
      case "round":
        bgElems.push(circle(w / 2, h / 2, hu * 9.6, { fill: c }));
        clip = circle(w / 2, h / 2, hu * 9.6, {});
        behind = c;
        textRoom = [0.74, 11];
        break;
      case "frame":
        bgElems.push(
          rect(hu * 1.2, hu * 1.2, w - hu * 2.4, h - hu * 2.4, {
            fill: inner,
            stroke: c,
            sw: hu * 2.4,
          }),
        );
        clip = rect(hu * 2.4, hu * 2.4, w - hu * 4.8, h - hu * 4.8, {});
        behind = inner;
        textRoom = [0.74, 11];
        break;
      case "diamond": {
        const d = `M${num(w / 2)} 0L${num(w)} ${num(h / 2)}L${num(w / 2)} ${num(h)}L0 ${num(h / 2)}Z`;
        bgElems.push(path(d, { fill: c }));
        clip = path(d, {});
        behind = c;
        textRoom = [0.5, 9];
        break;
      }
      case "diamond_line": {
        const d = `M${num(w / 2)} ${num(hu)}L${num(w - wu)} ${num(h / 2)}L${num(w / 2)} ${num(h - hu)}L${num(wu)} ${num(h / 2)}Z`;
        bgElems.push(path(d, { fill: inner, stroke: c, sw: hu * 2 }));
        const di = `M${num(w / 2)} ${num(hu * 2.6)}L${num(w - wu * 2.6)} ${num(h / 2)}L${num(w / 2)} ${num(h - hu * 2.6)}L${num(wu * 2.6)} ${num(h / 2)}Z`;
        clip = path(di, {});
        behind = inner;
        textRoom = [0.5, 9];
        break;
      }
      default:
        // A foreground shape used as background ("red_lower") is not a valid background shape;
        // like Waymarked Trails, only its colour counts and fills the whole sign.
        bgElems.push(rect(0, 0, w, h, { fill: c }));
        behind = c;
    }
  }

  // Foreground layers; a shape in the colour of its background gets a contrasting halo.
  let fgSvg = "";
  let textBehind = behind;
  // Background diamonds are 32 units wide: their text room is set above, not from the table.
  let textShape: string | undefined =
    bg.shape && bg.shape in TEXT_ROOM && w === 20 ? bg.shape : undefined;
  let textDy = 0;
  for (const fg of p.foreground) {
    if (!fg.shape) {
      fgSvg += render([rect(0, 0, w, h, { fill: fg.colour })]);
      textBehind = fg.colour;
      textShape = undefined;
      continue;
    }
    const elems = foregroundElems(fg.shape, fg.colour, fg.colour2, w, h);
    if (fg.colour === behind || fg.colour2 === behind) {
      const halo: Halo = { colour: against(behind), width: hu * 0.7 };
      fgSvg += render(elems, halo);
    }
    fgSvg += render(elems);
    if (CENTRE_FILL.has(fg.shape)) textBehind = fg.colour;
    if (fg.shape in TEXT_ROOM) textShape = fg.shape;
    if (fg.shape === "triangle") textDy = hu * 2.2;
    if (fg.shape === "triangle_turned") textDy = -hu * 2.2;
  }

  // Text: size by length, shrunk to the room behind it; colour as tagged, or the contrast colour
  // when missing or equal to what lies behind; a halo when the contrast stays weak (yellow on white).
  let textSvg = "";
  if (p.text) {
    const n = Array.from(p.text).length;
    const [share, max] = textShape ? TEXT_ROOM[textShape]! : textRoom;
    const sizeByLen = [0, 12, 10, 8, 6.6][Math.min(n, 4)]!;
    const size = Math.min(sizeByLen * hu, max * hu, (share * w) / Math.max(0.5, textEm(p.text)));
    let colour = p.textColour ?? against(textBehind);
    if (colour === textBehind) colour = against(textBehind);
    // Weak contrast (yellow on white, blue on red) gets a thin outline in the contrast colour of
    // the text, so the text stays readable at 4–5 mm on paper.
    const halo = contrast(colour, textBehind) < 1.6 ? against(colour) : undefined;
    textSvg = textElem(p.text, w / 2, h / 2 + 0.36 * size + textDy, size, colour, { halo });
  }

  return {
    w,
    h,
    body: (id) => {
      const clipSvg = render([clip]).replace(/ fill="none"/, "");
      return (
        render(bgElems) +
        `<clipPath id="${id}">${clipSvg}</clipPath>` +
        `<g clip-path="url(#${id})">${fgSvg}${textSvg}</g>`
      );
    },
  };
}

function textGraphic(text: string, opts: { frame?: string; italic?: boolean }): Graphic {
  const h = 20;
  const n = Array.from(text).length;
  const size = n <= 2 ? 11 : n === 3 ? 9.6 : 8.6;
  const w = Math.max(20, textEm(text) * size + (opts.frame ? 8 : 5));
  let body = "";
  let colour = DARK;
  if (opts.frame) {
    body += render([
      rect(1.2, 1.2, w - 2.4, h - 2.4, { fill: WHITE, stroke: opts.frame, sw: 2.4 }),
    ]);
    if (contrast(opts.frame, WHITE) >= 2.5) colour = opts.frame;
  }
  body += textElem(text, w / 2, h / 2 + 0.36 * size, size, colour, { italic: opts.italic });
  return { w, h, body: () => body };
}

function signGraphic(sign: Sign): Graphic {
  switch (sign.kind) {
    case "osmc":
      return osmcGraphic(sign.parsed);
    case "ref-colour":
      return textGraphic(sign.text, { frame: sign.colour });
    case "ref":
      return textGraphic(sign.text, {});
    case "name":
      return textGraphic(sign.text, { italic: true });
  }
}

/** Lays signs out side by side on white plates; undefined if there is nothing to draw. */
function composeSigns(signs: readonly Sign[], opts: SignOptions = {}): SvgImage | undefined {
  if (signs.length === 0) return undefined;
  const plateH = mm(opts.heightMm ?? WAYMARK_HEIGHT_MM);
  const rim = mm(RIM_MM);
  const outline = mm(OUTLINE_MM);
  const u = (plateH - 2 * rim) / 20;
  const gap = mm(WAYMARK_GAP_MM);
  const radius = mm(0.45);
  let x = 0;
  let body = "";
  signs.forEach((sign, i) => {
    const g = signGraphic(sign);
    const pw = g.w * u + 2 * rim;
    const ph = g.h * u + 2 * rim;
    const y = (plateH - ph) / 2;
    body +=
      `<g transform="translate(${num(x)},${num(y)})">` +
      `<rect x="${num(outline / 2)}" y="${num(outline / 2)}" width="${num(pw - outline)}" ` +
      `height="${num(ph - outline)}" rx="${num(radius)}" fill="${WHITE}" stroke="${OUTLINE}" ` +
      `stroke-width="${num(outline)}"/>` +
      `<g transform="translate(${num(rim)},${num(rim)}) scale(${num(u)})">` +
      `<clipPath id="p${i}"><rect width="${num(g.w)}" height="${num(g.h)}" rx="${num(radius / u - rim / u + 0.6)}"/></clipPath>` +
      `<g clip-path="url(#p${i})">${g.body(`c${i}`)}</g></g></g>`;
    x += pw + gap;
  });
  const width = x - gap;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(plateH)}">` +
    `${body}</svg>`;
  return { svg, width, height: plateH };
}

/**
 * SVG for a single `osmc:symbol` value on its plate, or undefined if the value is unreadable.
 * Width/height are CSS px at the print zoom (SvgImage convention).
 */
export function osmcToSvg(value: string, opts: SignOptions = {}): SvgImage | undefined {
  const parsed = parseOsmc(value);
  if (!parsed.readable) return undefined;
  return composeSigns([{ kind: "osmc", key: osmcKey(parsed), parsed }], opts);
}

/**
 * Combined image for all routes of a way segment: each entry goes through the fallback chain,
 * equal signs appear once, at most WAYMARK_MAX_SIGNS signs side by side. Undefined if no entry
 * yields a sign.
 */
export function waymarkSvg(
  entries: readonly WaymarkEntry[],
  opts: SignOptions = {},
): SvgImage | undefined {
  return composeSigns(resolveSigns(entries), opts);
}
