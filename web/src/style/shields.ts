// Road number shields for Autobahnen (blue, white number) and Bundesstrassen (yellow, black
// number), drawn as upright symbols along the road. Landes-/Kreisstrassen keep the plain number
// of the `names-road-ref` layer (labels.ts), which this module excludes for A/B refs.
//
// The shield bitmaps are created at run time in print resolution, like the POI icons: image ids
// are "shield:<ref>" (the full tile `ref`, e.g. "A 8;B 10"), the provider registered below returns
// an SVG, and the runtime resolver (icons/runtime.ts, styleimagemissing) rasterises it.
// Sizes are paper mm (units.ts).
import type { ExpressionSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { SvgImage } from "../icons/registry";
import { registerImageProvider } from "../icons/runtime";
import { all, flag, kindIn, matchAttr, not } from "./expr";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { mm, pt } from "./units";

export const SHIELD_IMAGE_PREFIX = "shield";

/** Road kinds that can carry a shield (same set as the plain numbers in labels.ts). */
const SHIELD_KINDS = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified"];

/** Shield height on paper in mm; the number is set at SHIELD_FONT_PT. */
export const SHIELD_HEIGHT_MM = 3.8;
export const SHIELD_FONT_PT = 6.8;
/** Distance between two shields of the same road on paper in mm. */
export const SHIELD_SPACING_MM = 90;

const RING_MM = 0.2; // white / black ring inside the edge
const EDGE_MM = 0.1; // thin dark edge of the Autobahn shield
const GAP_MM = 0.5; // between two shields of one image
const MAX_SHIELDS = 3;
const FONT_FAMILY = "'DejaVu Sans','Liberation Sans',Arial,Helvetica,sans-serif";
/** Average glyph advance of a bold sans digit in em. */
const DIGIT_EM = 0.64;

export type ShieldKind = "motorway" | "federal";

export interface Shield {
  kind: ShieldKind;
  /** Number shown on the shield ("8", "10", "27a"). */
  number: string;
}

/** A/B shields in a raw `ref` ("A 8;B 10;L 415"): Autobahn first, then Bundesstrassen, no duplicates. */
export function parseShields(ref: string): Shield[] {
  const found: Shield[] = [];
  for (const part of ref.split(";")) {
    const m = /^\s*([AB])\s?(\d+[a-zA-Z]?)\s*$/.exec(part);
    if (!m) continue;
    const kind: ShieldKind = m[1] === "A" ? "motorway" : "federal";
    if (!found.some((s) => s.kind === kind && s.number === m[2])) {
      found.push({ kind, number: m[2]! });
    }
  }
  return found.sort((a, b) => Number(a.kind === "federal") - Number(b.kind === "federal"));
}

interface Look {
  fill: string;
  ring: string;
  edge: string | undefined;
  text: string;
}

const LOOKS: Record<ShieldKind, Look> = {
  motorway: {
    fill: COLORS.shieldMotorway,
    ring: COLORS.shieldMotorwayRing,
    edge: COLORS.shieldMotorwayEdge,
    text: COLORS.shieldMotorwayText,
  },
  federal: {
    fill: COLORS.shieldFederal,
    ring: COLORS.shieldFederalRing,
    edge: undefined,
    text: COLORS.shieldFederalText,
  },
};

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/** SVG for the image id name (= tile `ref`), or undefined if it has no A/B number. */
export function shieldSvg(ref: string): SvgImage | undefined {
  const shields = parseShields(ref).slice(0, MAX_SHIELDS);
  if (shields.length === 0) return undefined;

  const h = mm(SHIELD_HEIGHT_MM);
  const fontPx = pt(SHIELD_FONT_PT);
  const pad = mm(0.9);
  const gap = mm(GAP_MM);
  const radius = mm(0.7);
  let x = 0;
  let body = "";
  for (const s of shields) {
    const look = LOOKS[s.kind];
    const w = Math.max(h * 0.95, s.number.length * DIGIT_EM * fontPx + 2 * pad);
    // Layers from outside in: edge (optional), ring, fill.
    let inset = 0;
    const rect = (color: string, d: number): void => {
      const r = Math.max(0, radius - d);
      body += `<rect x="${num(x + d)}" y="${num(d)}" width="${num(w - 2 * d)}" height="${num(h - 2 * d)}" rx="${num(r)}" fill="${color}"/>`;
    };
    if (look.edge) {
      rect(look.edge, inset);
      inset += mm(EDGE_MM);
    }
    rect(look.ring, inset);
    inset += mm(RING_MM);
    rect(look.fill, inset);
    body +=
      `<text x="${num(x + w / 2)}" y="${num(h / 2 + 0.36 * fontPx)}" text-anchor="middle" ` +
      `font-family="${FONT_FAMILY}" font-weight="700" font-size="${num(fontPx)}" ` +
      `fill="${look.text}">${escapeXml(s.number)}</text>`;
    x += w + gap;
  }
  const width = x - gap;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(h)}">` +
    `${body}</svg>`;
  return { svg, width, height: h };
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Image provider for ids "shield:<ref>" (no change to icons/runtime.ts needed).
registerImageProvider(SHIELD_IMAGE_PREFIX, shieldSvg);

// ---------------------------------------------------------------------------------------------
// Style layers

/** True for features with an A or B number somewhere in `ref` (also "L 415;B 10"). */
export const hasShieldRef: ExpressionSpecification = [
  "all",
  ["has", "ref"],
  [
    "any",
    ["in", ["slice", ["to-string", ["get", "ref"]], 0, 2], ["literal", ["A ", "B "]]],
    [">=", ["index-of", ";A ", ["to-string", ["get", "ref"]]], 0],
    [">=", ["index-of", ";B ", ["to-string", ["get", "ref"]]], 0],
  ],
];

// Bridges and tunnels are split off as short separate features; MapLibre anchors at least one
// symbol per feature, so shields there would crowd the road. Only the plain carriageway gets them.
const shieldFilter = all(
  not(flag("rail")),
  not(flag("bridge")),
  not(flag("tunnel")),
  kindIn(...SHIELD_KINDS),
  hasShieldRef,
);

export function shieldLayers(): LayerSpecification[] {
  return [
    {
      id: "shields-road",
      type: "symbol",
      source: OSM_SOURCE,
      "source-layer": "transport",
      filter: shieldFilter,
      minzoom: 10,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": mm(SHIELD_SPACING_MM),
        "icon-image": ["concat", `${SHIELD_IMAGE_PREFIX}:`, ["get", "ref"]],
        "icon-rotation-alignment": "viewport",
        "icon-padding": mm(7),
        // Autobahn first, then Bundesstrassen.
        "symbol-sort-key": matchAttr(
          "kind",
          [
            ["motorway", 0],
            ["trunk", 1],
            ["primary", 2],
          ],
          3,
        ),
      },
    } as LayerSpecification,
  ];
}

/**
 * Removes A/B refs from the plain road number layer (`names-road-ref`, labels.ts): those roads
 * get a shield instead. Other layers pass through unchanged.
 */
export function withoutShieldRefs(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((layer) => {
    if (layer.id !== "names-road-ref" || !("filter" in layer) || !layer.filter) return layer;
    return { ...layer, filter: ["all", layer.filter, ["!", hasShieldRef]] } as LayerSpecification;
  });
}
