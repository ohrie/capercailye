// OSMC sign shapes as SVG elements.
//
// Ported from mueschel/OsmcToSVG (osmc.pm, https://github.com/mueschel/OsmcToSVG), licence
// CC0-1.0 (public domain dedication); thanks to its author. Geometry, the 20-unit grid
// (hu = height/20, wu = width/20) and the pictograms hiker, wheel, bicycle, shell and
// shell_modern come from there (pictogram paths pre-transformed into a 0..1 square). Own additions
// for this project (MIT): wheelchair, heart, tower, wolfshook, the hexagon geometry, the halo pass
// and the explicit transforms instead of CSS transform-origin. Waymarked Trails (GPL-3.0) was
// used only to compare behaviour; no code or SVG was taken from it.
//
// Every shape is drawn into a sign of w x h units (h = 20 for a normal sign), in the sign's own
// coordinate system. Shapes return element descriptions; render() turns them into SVG, optionally
// as a halo pass (same geometry, contrasting colour, wider stroke) for shapes that would vanish on
// a background of the same colour.

export interface Paint {
  fill?: string;
  stroke?: string;
  /** Stroke width in the element's local units. */
  sw?: number;
  /** Line cap/join for strokes (default butt/miter). */
  cap?: "round" | "butt" | "square";
  join?: "round" | "miter";
}

export interface Elem {
  tag: "path" | "rect" | "circle";
  attrs: Record<string, number | string>;
  paint: Paint;
  /** Optional transform and its uniform scale (local units -> sign units). */
  transform?: string;
  scale?: number;
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

export function rect(x: number, y: number, w: number, h: number, paint: Paint): Elem {
  return { tag: "rect", attrs: { x, y, width: w, height: h }, paint };
}

export function circle(cx: number, cy: number, r: number, paint: Paint): Elem {
  return { tag: "circle", attrs: { cx, cy, r }, paint };
}

export function path(d: string, paint: Paint): Elem {
  return { tag: "path", attrs: { d }, paint };
}

/** Path in a 0..1 square, centred in the w x h sign at size min(w,h) * k. */
function unit(d: string, paint: Paint, w: number, h: number, k = 1): Elem {
  const s = Math.min(w, h) * k;
  return {
    tag: "path",
    attrs: { d },
    paint,
    transform: `matrix(${num(s)},0,0,${num(s)},${num((w - s) / 2)},${num((h - s) / 2)})`,
    scale: s,
  };
}

function unitCircle(
  cx: number,
  cy: number,
  r: number,
  paint: Paint,
  w: number,
  h: number,
  k = 1,
): Elem {
  const s = Math.min(w, h) * k;
  return { ...circle(cx, cy, r, paint), transform: unit("", paint, w, h, k).transform, scale: s };
}

/** Polygon path from points. */
function poly(...pts: [number, number][]): string {
  return `M${pts.map(([x, y]) => `${num(x)} ${num(y)}`).join("L")}Z`;
}

// Pictograms from OsmcToSVG, transformed into the unit square (see file header).
const HIKER = {
  head: "M0.589 0.224C0.589 0.255 0.559 0.279 0.522 0.279C0.485 0.279 0.455 0.255 0.455 0.224C0.455 0.194 0.485 0.17 0.522 0.17C0.559 0.17 0.589 0.194 0.589 0.224Z",
  pack: "M0.304 0.263L0.383 0.278L0.341 0.44L0.261 0.425Z",
  stick: "M0.74 0.365L0.638 0.814",
  arm: "M0.676 0.472L0.568 0.447L0.534 0.346",
  legs: "M0.333 0.791L0.438 0.457M0.555 0.79L0.46 0.456",
  body: "M0.493 0.355L0.452 0.499",
};
const WHEEL = {
  rim: "M0.792 0.5C0.792 0.66 0.662 0.79 0.502 0.79C0.341 0.79 0.211 0.66 0.211 0.5C0.211 0.34 0.341 0.21 0.502 0.21C0.662 0.21 0.792 0.34 0.792 0.5Z",
  hub: "M0.551 0.5C0.551 0.528 0.528 0.551 0.5 0.551C0.472 0.551 0.449 0.528 0.449 0.5C0.449 0.472 0.472 0.449 0.5 0.449C0.528 0.449 0.551 0.472 0.551 0.5Z",
  spokes:
    "M0.236 0.476L0.442 0.476L0.442 0.526L0.236 0.526ZM0.563 0.474L0.769 0.474L0.769 0.525L0.563 0.525ZM0.389 0.257L0.491 0.435L0.448 0.46L0.345 0.282ZM0.553 0.54L0.656 0.718L0.612 0.743L0.509 0.565ZM0.655 0.282L0.552 0.46L0.508 0.435L0.611 0.257ZM0.492 0.566L0.389 0.744L0.345 0.718L0.448 0.54Z",
};
const BICYCLE_FRAME =
  "M0.419 0.154C0.243 0.156 0.273 0.136 0.177 0.441C0.1 0.686 0.108 0.659 0.108 0.676C0.108 0.689 0.118 0.7 0.132 0.701C0.16 0.698 0.148 0.704 0.246 0.402C0.601 0.777 0.468 0.716 0.659 0.724C0.911 0.721 0.931 0.737 0.934 0.7C0.934 0.687 0.928 0.68 0.755 0.296L0.772 0.25L0.829 0.249L0.827 0.202L0.615 0.202C0.596 0.227 0.622 0.227 0.717 0.248L0.7 0.295L0.278 0.296C0.306 0.196 0.29 0.202 0.418 0.203L0.419 0.154ZM0.265 0.347L0.679 0.346L0.56 0.667L0.265 0.347ZM0.729 0.366L0.612 0.674L0.868 0.674L0.729 0.366Z";
const SHELL =
  "M0.5 0.1L0 0.3M0.5 0.1L0.1 0.5M0.5 0.1L0.2 0.65M0.5 0.1L0.35 0.8M0.5 0.1L0.5 0.85M0.5 0.1L0.65 0.8M0.5 0.1L0.8 0.65M0.5 0.1L0.9 0.5M0.5 0.1L1 0.3";
const SHELL_MODERN =
  "M0.1 0.5L0.3 0M0.1 0.5L0.5 0.1M0.1 0.5L0.65 0.2M0.1 0.5L0.8 0.35M0.1 0.5L0.85 0.5M0.1 0.5L0.8 0.65M0.1 0.5L0.65 0.8M0.1 0.5L0.5 0.9M0.1 0.5L0.3 1";

// Own pictograms (MIT), unit square.
const HEART =
  "M0.5 0.86C0.18 0.62 0.06 0.47 0.1 0.3C0.14 0.13 0.4 0.1 0.5 0.3C0.6 0.1 0.86 0.13 0.9 0.3C0.94 0.47 0.82 0.62 0.5 0.86Z";
const TOWER =
  "M0.3 0.9L0.33 0.38L0.24 0.38L0.24 0.12L0.34 0.12L0.34 0.2L0.45 0.2L0.45 0.12L0.55 0.12L0.55 0.2L0.66 0.2L0.66 0.12L0.76 0.12L0.76 0.38L0.67 0.38L0.7 0.9ZM0.44 0.9L0.44 0.72C0.44 0.62 0.56 0.62 0.56 0.72L0.56 0.9Z";
const WOLFSHOOK = "M0.5 0.12L0.5 0.88M0.5 0.12L0.72 0.3M0.5 0.88L0.28 0.7M0.28 0.5L0.72 0.5";
const WHEELCHAIR_BODY = "M0.42 0.3L0.44 0.56L0.68 0.56L0.78 0.82M0.43 0.42L0.62 0.42";
const WHEELCHAIR_WHEEL = "M0.3 0.5A0.22 0.22 0 1 0 0.62 0.74";

/**
 * Elements for a foreground shape in a w x h sign. `c2` is the second colour (diamond right
 * half, fork chevron, turned_T stem, drop fill); it defaults to `c`.
 */
export function foregroundElems(
  shape: string,
  c: string,
  c2: string | undefined,
  w: number,
  h: number,
): Elem[] {
  const hu = h / 20;
  const wu = w / 20;
  const k2 = c2 ?? c;
  const fill = { fill: c };
  switch (shape) {
    case "corner":
      return [
        path(`M0 0L${num(w)} ${num(h)}L${num(w)} 0Z`, fill),
        ...(k2 !== c ? [path(`M0 0L${num(w)} ${num(h)}L0 ${num(h)}Z`, { fill: k2 })] : []),
      ];
    case "corner_left":
      return [
        path(`M0 0L0 ${num(h)}L${num(w)} 0Z`, fill),
        ...(k2 !== c ? [path(`M${num(w)} 0L${num(w)} ${num(h)}L0 ${num(h)}Z`, { fill: k2 })] : []),
      ];
    case "bar":
      return [rect(0, hu * 7, w, hu * 6, fill)];
    case "stripe":
      return [rect(wu * 7, 0, wu * 6, h, fill)];
    case "cross":
      return [rect(0, hu * 7, w, hu * 6, fill), rect(wu * 7, 0, wu * 6, h, fill)];
    case "slash":
      return [path(`M${num(w)} 0L0 ${num(h)}`, { stroke: c, sw: hu * 3 })];
    case "backslash":
      return [path(`M0 0L${num(w)} ${num(h)}`, { stroke: c, sw: hu * 3 })];
    case "x":
      return [path(`M${num(w)} 0L0 ${num(h)}M0 0L${num(w)} ${num(h)}`, { stroke: c, sw: hu * 3 })];
    case "dot":
      return [circle(w / 2, h / 2, hu * 6.5, fill)];
    case "circle":
      return [circle(w / 2, h / 2, hu * 6.5, { stroke: c, sw: hu * 2 })];
    case "pointer":
      return [path(poly([wu * 3, hu * 3], [wu * 3, hu * 17], [wu * 17, hu * 10]), fill)];
    case "pointer_line":
      return [
        path(poly([wu * 4, hu * 4], [wu * 4, hu * 16], [wu * 16, hu * 10]), {
          stroke: c,
          sw: hu * 2,
        }),
      ];
    case "left_pointer":
      return [path(poly([wu * 17, hu * 3], [wu * 17, hu * 17], [wu * 3, hu * 10]), fill)];
    case "left_pointer_line":
      return [
        path(poly([wu * 16, hu * 4], [wu * 16, hu * 16], [wu * 4, hu * 10]), {
          stroke: c,
          sw: hu * 2,
        }),
      ];
    case "triangle":
      return [path(poly([wu * 3, hu * 17], [wu * 17, hu * 17], [wu * 10, hu * 3]), fill)];
    case "triangle_turned":
      return [path(poly([wu * 3, hu * 3], [wu * 17, hu * 3], [wu * 10, hu * 17]), fill)];
    case "triangle_line": {
      // OsmcToSVG: the triangle scaled by 0.7 around the centre, stroke 3 units.
      const p = (x: number, y: number): [number, number] => [
        w / 2 + (x - w / 2) * 0.7,
        h / 2 + (y - h / 2) * 0.7,
      ];
      return [
        path(poly(p(wu * 3, hu * 17), p(wu * 17, hu * 17), p(wu * 10, hu * 3)), {
          stroke: c,
          sw: hu * 2.4,
          join: "miter",
        }),
      ];
    }
    case "lower":
      return [rect(0, h / 2, w, h / 2, fill)];
    case "upper":
      return [rect(0, 0, w, h / 2, fill)];
    case "right":
      return [rect(w / 2, 0, w / 2, h, fill)];
    case "left":
      return [rect(0, 0, w / 2, h, fill)];
    case "frame":
      // Not in the wiki as foreground; drawn like the frame background ("black:white:black_frame").
      return [rect(hu * 1.2, hu * 1.2, w - hu * 2.4, h - hu * 2.4, { stroke: c, sw: hu * 2.4 })];
    case "rectangle":
      return [rect(wu * 5, hu * 5, wu * 10, hu * 10, fill)];
    case "rectangle_line":
      // OsmcToSVG: scaled by 0.8 around the centre.
      return [rect(wu * 6, hu * 6, wu * 8, hu * 8, { stroke: c, sw: hu * 2.4 })];
    case "diamond":
      // Two halves: left in the first colour, right in the second ("black_red_diamond").
      // Slightly taller than in OsmcToSVG (3..17 instead of 4..16): the diamond is by far the
      // most frequent sign in BW and fills the plate on real signs.
      return [
        path(poly([w / 2, hu * 3], [w / 2, hu * 17], [wu * 1.5, h / 2]), {
          fill: c,
          stroke: c,
          sw: 0.05,
        }),
        path(poly([w / 2, hu * 3], [w / 2, hu * 17], [wu * 18.5, h / 2]), {
          fill: k2,
          stroke: k2,
          sw: 0.05,
        }),
      ];
    case "diamond_line":
      return [
        path(poly([w / 2, hu * 3.8], [wu * 17.8, h / 2], [w / 2, hu * 16.2], [wu * 2.2, h / 2]), {
          stroke: c,
          sw: hu * 2,
        }),
      ];
    case "diamond_left":
      return [unit("M0 0.5L0.5 0L0.5 1Z", fill, w, h)];
    case "diamond_right":
      return [unit("M1 0.5L0.5 0L0.5 1Z", fill, w, h)];
    case "turned_T":
      return [
        rect(wu * 3, hu * 14, wu * 14, hu * 2, fill),
        rect(wu * 9, hu * 4, wu * 2, hu * 12, { fill: k2 }),
      ];
    case "fork":
      return [
        rect(wu * 9, hu * 9, wu * 11, hu * 2, fill),
        path(`M${num(-wu)} ${num(hu)}L${num(wu * 9)} ${num(h / 2)}L${num(-wu)} ${num(hu * 19)}`, {
          stroke: k2,
          sw: hu * 2,
        }),
      ];
    case "hexagon": {
      const r = hu * 7.5;
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push([w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a)]);
      }
      return [path(poly(...pts), fill)];
    }
    case "arch":
      return [
        unit(
          "M0.25 0.9L0.25 0.5C0.25 0.166667 0.75 0.166667 0.75 0.5L0.75 0.9",
          { stroke: c, sw: 0.22 },
          w,
          h,
        ),
      ];
    case "arrow":
      return [unit("M0.1 0.7L0.6 0.7L0.6 0.95L1 0.5L0.6 0.05L0.6 0.3L0.1 0.3Z", fill, w, h)];
    case "left_arrow":
      return [unit("M0.9 0.7L0.4 0.7L0.4 0.95L0 0.5L0.4 0.05L0.4 0.3L0.9 0.3Z", fill, w, h)];
    case "up_arrow":
      return [unit("M0.7 0.9L0.7 0.4L0.95 0.4L0.5 0L0.05 0.4L0.3 0.4L0.3 0.9Z", fill, w, h)];
    case "down_arrow":
      return [unit("M0.7 0.1L0.7 0.6L0.95 0.6L0.5 1L0.05 0.6L0.3 0.6L0.3 0.1Z", fill, w, h)];
    case "bowl":
      return [unit("M0.05 0.5L0.95 0.5A0.45 0.45 0 0 1 0.05 0.5Z", fill, w, h)];
    case "upper_bowl":
      return [unit("M0.05 0.5L0.95 0.5A0.45 0.45 0 0 0 0.05 0.5Z", fill, w, h)];
    case "crest":
      return [
        unit(
          "M0.15 0.5L0.15 0.05L0.85 0.05L0.85 0.5A0.4 0.45 0 0 1 0.5 0.95A0.4 0.45 0 0 1 0.15 0.5Z",
          fill,
          w,
          h,
        ),
      ];
    case "house":
      return [unit("M0.2 0.9L0.2 0.4L0.5 0.1L0.8 0.4L0.8 0.9Z", fill, w, h)];
    case "drop":
      return [unit("M0.5 0.2L0.95 0.5L0.5 0.8A0.335 0.335 0 1 1 0.5 0.2Z", fill, w, h)];
    case "drop_line":
      return [
        unit(
          "M0.5 0.2L0.95 0.5L0.5 0.8A0.335 0.335 0 1 1 0.5 0.2Z",
          { fill: c2 && c2 !== c ? c2 : undefined, stroke: c, sw: 0.08 },
          w,
          h,
        ),
      ];
    case "L":
      return [unit("M0.2 0.05L0.2 0.8L0.95 0.8", { stroke: c, sw: 0.3 }, w, h)];
    case "hiker":
      return [
        unit(HIKER.head, fill, w, h, 1.15),
        unit(HIKER.pack, { fill: c, stroke: c, sw: 0.046, join: "round" }, w, h, 1.15),
        unit(HIKER.stick, { stroke: c, sw: 0.035, cap: "round" }, w, h, 1.15),
        unit(HIKER.arm, { stroke: c, sw: 0.055, cap: "round", join: "round" }, w, h, 1.15),
        unit(HIKER.legs, { stroke: c, sw: 0.08, cap: "round" }, w, h, 1.15),
        unit(HIKER.body, { stroke: c, sw: 0.13, cap: "round" }, w, h, 1.15),
      ];
    case "wheel":
      return [
        unit(WHEEL.rim, { stroke: c, sw: 0.055 }, w, h),
        unit(WHEEL.hub, { stroke: c, sw: 0.042 }, w, h),
        unit(WHEEL.spokes, fill, w, h),
      ];
    case "bicycle":
      return [
        unitCircle(0.133, 0.679, 0.215, { stroke: c, sw: 0.053 }, w, h, 0.72),
        unitCircle(0.9, 0.675, 0.215, { stroke: c, sw: 0.053 }, w, h, 0.72),
        {
          ...unit(BICYCLE_FRAME, fill, w, h, 0.72),
          attrs: { d: BICYCLE_FRAME, "fill-rule": "evenodd" },
        },
      ].map((e) => centreUnit(e, w, h, 0.72, 0.515, 0.537));
    case "shell":
      return [unit(SHELL, { stroke: c, sw: 0.06 }, w, h)];
    case "shell_modern":
      return [unit(SHELL_MODERN, { stroke: c, sw: 0.06 }, w, h)];
    case "heart":
      return [unit(HEART, fill, w, h)];
    case "tower":
      return [{ ...unit(TOWER, fill, w, h), attrs: { d: TOWER, "fill-rule": "evenodd" } }];
    case "wolfshook":
      return [unit(WOLFSHOOK, { stroke: c, sw: 0.1, cap: "square" }, w, h)];
    case "wheelchair":
      return [
        unitCircle(0.42, 0.18, 0.08, fill, w, h),
        unit(WHEELCHAIR_BODY, { stroke: c, sw: 0.08, cap: "round", join: "round" }, w, h),
        unit(WHEELCHAIR_WHEEL, { stroke: c, sw: 0.07, cap: "round" }, w, h),
      ];
    default:
      return [];
  }
}

/** Moves a unit element so that unit point (cx, cy) sits in the sign centre (bicycle). */
function centreUnit(e: Elem, w: number, h: number, k: number, cx: number, cy: number): Elem {
  const s = Math.min(w, h) * k;
  const m = `matrix(${num(s)},0,0,${num(s)},${num(w / 2 - cx * s)},${num(h / 2 - cy * s)})`;
  return { ...e, transform: m, scale: s };
}

/** Halo pass: same geometry, colour `halo`, stroke `width` sign units wider. */
export interface Halo {
  colour: string;
  width: number;
}

/** Serialises elements; with `halo`, every element becomes a solid halo silhouette. */
export function render(elems: Elem[], halo?: Halo): string {
  let out = "";
  for (const e of elems) {
    const s = e.scale ?? 1;
    const p = e.paint;
    let fill = p.fill ?? "none";
    let stroke = p.stroke;
    let sw = p.sw ?? 0;
    if (halo) {
      if (fill !== "none") fill = halo.colour;
      stroke = halo.colour;
      sw = (stroke && p.stroke ? sw : 0) + (2 * halo.width) / s;
    }
    let a = Object.entries(e.attrs)
      .map(([k, v]) => `${k}="${typeof v === "number" ? num(v) : v}"`)
      .join(" ");
    a += ` fill="${fill}"`;
    if (stroke && sw > 0) {
      a += ` stroke="${stroke}" stroke-width="${num(sw)}"`;
      if (p.cap || halo) a += ` stroke-linecap="${halo ? "round" : p.cap}"`;
      if (p.join || halo) a += ` stroke-linejoin="${halo ? "round" : p.join}"`;
    }
    if (e.transform) a += ` transform="${e.transform}"`;
    out += `<${e.tag} ${a}/>`;
  }
  return out;
}
