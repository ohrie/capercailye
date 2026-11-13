// Parser for OSM `osmc:symbol` values (grammar: OSM wiki "Key:osmc:symbol"):
//
//   waycolor:background[:foreground][:foreground2][:text:textcolor]
//
// The split into parts and the colour/shape decomposition follow mueschel/OsmcToSVG (osmc.pm,
// CC0-1.0, https://github.com/mueschel/OsmcToSVG), ported to TypeScript and made more tolerant.
// Tolerance rules (all derived from real values in Baden-Württemberg, see README.md):
//
// - Case and whitespace in colour/shape tokens are ignored ("Red_Diamond", " blue_dot"); the text
//   keeps its case. A part made only of whitespace counts as empty.
// - Positions are decided by the number of parts, not by guessing from the tokens alone, because
//   "L" is both a shape and a typical text: 3 parts = fg; 4 = fg:fg2 when the 4th part is a shape,
//   otherwise fg:text (or text:textcolor, when the 3rd part is no shape and the 4th a colour);
//   5 = fg:text:textcolor (or fg:fg2:text when the 5th part is no colour); 6+ = fg:fg2:text…:textcolor.
// - A foreground part that is no shape and has no colour prefix is text ("red:white:<",
//   "green:white:Waldachtaler Heimatweg:green"), like OsmcToSVG does.
// - A known colour with an unknown shape ("red_frog") is dropped, the rest is drawn (partial
//   rendering, an `issues` entry is recorded). Showing a wrong shape would mislead on the trail;
//   the remaining colour/text still identifies the route.
// - A few frequent typos are mapped (circlce, diamand, …). A background with a known colour but an
//   unknown shape becomes the plain colour; an unknown background colour becomes a white plate.
// - A bare colour as foreground fills the whole sign (OsmcToSVG); as second foreground it is
//   ignored (in practice it is a misplaced text colour, e.g. "blue:blue:white_circle:white").
// - A value is unreadable (`readable: false`) when nothing visible remains: no background colour,
//   no foreground and no text. The caller then falls back to ref/colour/name (PLAN.md 3).

/** OSMC colour names (wiki list plus "pink", which OsmcToSVG knows). `grey` = `gray`. */
export const OSMC_COLOURS = {
  black: "#1d1d1b",
  white: "#ffffff",
  red: "#e30613",
  yellow: "#ffd200",
  orange: "#f28c00",
  blue: "#0062b1",
  green: "#00913a",
  brown: "#8b5524",
  purple: "#7f3f98",
  gray: "#9d9d9c",
  grey: "#9d9d9c",
  pink: "#ef7fb0",
} as const;

export type OsmcColour = keyof typeof OSMC_COLOURS;

/** Foreground shapes this renderer can draw (see shapes.ts). */
export const FOREGROUND_SHAPES = [
  "bar",
  "stripe",
  "cross",
  "x",
  "slash",
  "backslash",
  "dot",
  "circle",
  "triangle",
  "triangle_line",
  "triangle_turned",
  "diamond",
  "diamond_line",
  "diamond_left",
  "diamond_right",
  "rectangle",
  "rectangle_line",
  "lower",
  "upper",
  "left",
  "right",
  "corner",
  "corner_left",
  "pointer",
  "pointer_line",
  "left_pointer",
  "left_pointer_line",
  "arrow",
  "left_arrow",
  "up_arrow",
  "down_arrow",
  "fork",
  "turned_T",
  "L",
  "arch",
  "bowl",
  "upper_bowl",
  "crest",
  "house",
  "drop",
  "drop_line",
  "frame",
  "hexagon",
  "hiker",
  "wheel",
  "bicycle",
  "wheelchair",
  "shell",
  "shell_modern",
  "heart",
  "tower",
  "wolfshook",
] as const;

export type ForegroundShape = (typeof FOREGROUND_SHAPES)[number];

/** Background shapes; any foreground shape is also accepted as background (drawn under the fg). */
export const BACKGROUND_SHAPES = [
  "circle",
  "round",
  "frame",
  "bar",
  "stripe",
  "diamond",
  "diamond_line",
] as const;

export type BackgroundShape = (typeof BACKGROUND_SHAPES)[number] | ForegroundShape;

/** Lower-case token -> canonical shape (synonyms, case-sensitive names, typos seen in BW). */
const SHAPE_ALIASES: Record<string, string> = {
  right_pointer: "pointer",
  right_pointer_line: "pointer_line",
  right_arrow: "arrow",
  turned_t: "turned_T",
  l: "L",
  circlce: "circle",
  cirlce: "circle",
  diamand: "diamond",
  diamont: "diamond",
  dimond: "diamond",
  diamond_line_: "diamond_line",
  triangel: "triangle",
  stripes: "stripe",
  wheel_chair: "wheelchair",
  wolfsangel: "wolfshook",
  shell_moderne: "shell_modern",
  shellmodern: "shell_modern",
  modern_shell: "shell_modern",
  square: "rectangle",
};

const FG_SET = new Set<string>(FOREGROUND_SHAPES);
const BG_SET = new Set<string>(BACKGROUND_SHAPES);

export interface OsmcBackground {
  /** Hex colour; undefined for an empty background ("yellow::yellow_diamond"). */
  colour?: string;
  /** Second colour (fill of circle/frame backgrounds, "red_white_frame"). */
  colour2?: string;
  /** Undefined = the colour fills the whole sign. */
  shape?: BackgroundShape;
}

export interface OsmcForeground {
  /** Undefined = the colour fills the whole sign (bare colour as foreground). */
  shape?: ForegroundShape;
  colour: string;
  /** Second colour: right half of a diamond, chevron of a fork, stem of turned_T. */
  colour2?: string;
}

export interface ParsedOsmc {
  /** The raw value, trimmed. */
  value: string;
  waycolor?: string;
  background: OsmcBackground;
  /** 0–2 foreground layers, bottom first. */
  foreground: OsmcForeground[];
  /** Text as shown (cleaned, at most 4 characters). */
  text?: string;
  /** Text colour as given (hex); undefined when missing or unknown (renderer picks contrast). */
  textColour?: string;
  /** Something visible can be drawn. */
  readable: boolean;
  /** Parts that were ignored or corrected (for tests and debugging). */
  issues: string[];
}

const norm = (s: string): string => s.replace(/\s+/g, "").toLowerCase();

/** Hex colour for an OSMC colour name (case/whitespace tolerant), or undefined. */
export function osmcColour(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const t = norm(token);
  return t in OSMC_COLOURS ? OSMC_COLOURS[t as OsmcColour] : undefined;
}

function canonicalShape(s: string): string | undefined {
  const a = SHAPE_ALIASES[s] ?? s;
  if (FG_SET.has(a) || BG_SET.has(a)) return a;
  return undefined;
}

type Token =
  | { kind: "empty" }
  | { kind: "colour"; colour: string }
  | { kind: "shape"; colour?: string; colour2?: string; shape: string }
  /** Known colour prefix, unknown shape. */
  | { kind: "unknown"; colour: string; rest: string }
  | { kind: "other" };

/** Splits "<colour>[_<colour2>]_<shape>" into its pieces. */
function classify(raw: string | undefined): Token {
  if (raw === undefined) return { kind: "empty" };
  const t = norm(raw);
  if (t === "") return { kind: "empty" };
  const single = osmcColour(t);
  if (single) return { kind: "colour", colour: single };
  let rest = t;
  const colours: string[] = [];
  for (let i = 0; i < 2; i++) {
    const m = /^([a-z]+)_(.+)$/.exec(rest);
    if (!m) break;
    const c = osmcColour(m[1]);
    // "diamond_line" etc.: stop when the prefix is no colour.
    if (!c) break;
    colours.push(c);
    rest = m[2]!;
  }
  const shape = canonicalShape(rest);
  if (shape) {
    // Bare single-letter shapes ("L") only with a colour prefix; alone they are text.
    if (colours.length === 0 && shape.length < 2) return { kind: "other" };
    return { kind: "shape", colour: colours[0], colour2: colours[1], shape };
  }
  if (colours.length > 0) return { kind: "unknown", colour: colours[0]!, rest };
  return { kind: "other" };
}

const isShape = (t: Token): boolean => t.kind === "shape" || t.kind === "unknown";

function parseBackground(raw: string | undefined, issues: string[]): OsmcBackground {
  const t = classify(raw);
  switch (t.kind) {
    case "empty":
      return {};
    case "colour":
      return { colour: t.colour };
    case "shape":
      if (!t.colour) {
        issues.push(`Hintergrund ohne Farbe: ${raw}`);
        return {};
      }
      return { colour: t.colour, colour2: t.colour2, shape: t.shape as BackgroundShape };
    case "unknown":
      issues.push(`unbekannte Hintergrundform: ${t.rest}`);
      return { colour: t.colour };
    case "other":
      issues.push(`unbekannter Hintergrund: ${raw}`);
      return {};
  }
}

function toForeground(
  t: Token,
  raw: string,
  second: boolean,
  issues: string[],
): OsmcForeground | undefined {
  switch (t.kind) {
    case "colour":
      if (second) {
        issues.push(`Farbe als zweiter Vordergrund ignoriert: ${raw}`);
        return undefined;
      }
      return { colour: t.colour };
    case "shape":
      if (!FG_SET.has(t.shape)) {
        issues.push(`Form nur als Hintergrund bekannt: ${raw}`);
        return undefined;
      }
      return {
        shape: t.shape as ForegroundShape,
        // OsmcToSVG draws shapes without colour in black; shells are yellow on real signs.
        colour:
          t.colour ?? (t.shape.startsWith("shell") ? OSMC_COLOURS.yellow : OSMC_COLOURS.black),
        colour2: t.colour2,
      };
    case "unknown":
      issues.push(`unbekannte Vordergrundform: ${t.rest}`);
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Cleans the sign text: trimmed, at most 4 characters. Longer texts with several words become
 * initials ("Waldachtaler Heimatweg" -> "WH"), otherwise the first 4 characters. A lone "/" is
 * shown as "|": the tile build replaces "|" in tag values by "/" (SCHEMA.md), and "|" is a common
 * one-character text in BW ("red:white:red_diamond:|:white").
 */
export function cleanText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let t = raw.trim();
  if (t === "") return undefined;
  // Template placeholders copied from the wiki ("foreground2") are not text.
  if (/^(foreground|background)\d*$/i.test(t)) return undefined;
  if (t === "/") return "|";
  const chars = Array.from(t);
  if (chars.length <= 4) return t;
  const words = t.split(/\s+/).filter((w) => w.length > 0);
  if (words.length > 1) {
    t = words
      .map((w) => Array.from(w)[0]!)
      .join("")
      .toUpperCase();
    return Array.from(t).slice(0, 4).join("");
  }
  return chars.slice(0, 4).join("");
}

/** Parses an `osmc:symbol` value. Never throws. */
export function parseOsmc(value: string | undefined | null): ParsedOsmc {
  const v = (value ?? "").trim();
  const issues: string[] = [];
  const parts = v === "" ? [] : v.split(":");
  const waycolor = osmcColour(parts[0]);
  if (parts[0] !== undefined && norm(parts[0]) !== "" && !waycolor) {
    issues.push(`unbekannte Wegfarbe: ${parts[0]}`);
  }
  const background = parseBackground(parts[1], issues);
  const rest = parts.slice(2);
  const tok = rest.map((r) => classify(r));

  let fgTokens: [Token, string][] = [];
  let textRaw: string | undefined;
  let textColourRaw: string | undefined;
  const textish = (t: Token | undefined): boolean => t === undefined || t.kind === "other";
  const colourish = (t: Token | undefined): boolean =>
    t !== undefined && (t.kind === "colour" || t.kind === "empty");

  const n = rest.length;
  if (n === 1) {
    if (textish(tok[0])) textRaw = rest[0];
    else fgTokens = [[tok[0]!, rest[0]!]];
  } else if (n === 2) {
    if (textish(tok[0]) && colourish(tok[1])) {
      textRaw = rest[0];
      textColourRaw = rest[1];
    } else {
      if (!textish(tok[0])) fgTokens.push([tok[0]!, rest[0]!]);
      else textRaw = rest[0];
      if (isShape(tok[1]!)) fgTokens.push([tok[1]!, rest[1]!]);
      else if (tok[1]!.kind === "other") textRaw ??= rest[1];
      else if (tok[1]!.kind === "colour") issues.push(`Textfarbe ohne Text: ${rest[1]}`);
    }
  } else if (n === 3) {
    if (!colourish(tok[2]) && isShape(tok[1]!)) {
      fgTokens = [
        [tok[0]!, rest[0]!],
        [tok[1]!, rest[1]!],
      ];
      textRaw = rest[2];
    } else {
      fgTokens = [[tok[0]!, rest[0]!]];
      textRaw = rest[1];
      textColourRaw = rest[2];
    }
  } else if (n >= 4) {
    fgTokens = [
      [tok[0]!, rest[0]!],
      [tok[1]!, rest[1]!],
    ];
    textRaw = rest.slice(2, n - 1).join(":");
    textColourRaw = rest[n - 1];
    if (n > 4) issues.push(`mehr als 6 Teile: ${n + 2}`);
  }

  const foreground: OsmcForeground[] = [];
  fgTokens.forEach(([t, raw], i) => {
    if (t.kind === "other") {
      // A text-like part in a foreground position (6+ parts); show it if there is no text.
      if (textRaw === undefined || textRaw.trim() === "") textRaw = raw;
      else issues.push(`unbekannter Vordergrund: ${raw}`);
      return;
    }
    const fg = toForeground(t, raw, i > 0, issues);
    if (fg) foreground.push(fg);
  });

  const text = cleanText(textRaw);
  const textColour = osmcColour(textColourRaw);
  if (textColourRaw !== undefined && norm(textColourRaw) !== "" && !textColour) {
    issues.push(`unbekannte Textfarbe: ${textColourRaw}`);
  }
  const readable = background.colour !== undefined || foreground.length > 0 || text !== undefined;
  return {
    value: v,
    ...(waycolor ? { waycolor } : {}),
    background,
    foreground,
    ...(text !== undefined ? { text } : {}),
    ...(textColour ? { textColour } : {}),
    readable,
    issues,
  };
}
