import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { expression } from "@maplibre/maplibre-gl-style-spec";
import { svgForImageId } from "../icons/runtime";
import { ICON_MM } from "../style/sizes";
import { mm } from "../style/units";
import {
  OSMC_COLOURS as C,
  FOREGROUND_SHAPES,
  nameAbbreviation,
  osmcToSvg,
  parseOsmc,
  parseWaymarkId,
  resolveSign,
  resolveSigns,
  routeColour,
  WAYMARK_FIELD_SEPARATOR,
  WAYMARK_HEIGHT_MM,
  waymarkImageExpression,
  waymarkImageId,
  waymarkSvg,
} from "./index";

/** The most frequent values of route=hiking|foot relations in BW (share of routes in %). */
const BW_TOP: [string, number][] = [
  ["yellow:white:yellow_diamond", 55.75],
  ["blue:white:blue_diamond", 11.48],
  ["red:white:red_diamond", 3.06],
  ["blue:white:blue_dot", 1.29],
  ["red:white:black_red_diamond", 1.25],
  ["yellow::yellow_diamond", 1.12],
  ["red:yellow:white_red_diamond", 1.03],
  ["blue:white:blue_pointer", 0.94],
  ["red:white:red_diamond:|:white", 0.88],
  ["red:white:red_diamond:W:blue", 0.86],
  ["blue:white:blue_bar", 0.85],
  ["red:white:red_cross", 0.77],
  ["red:white:red_diamond:K:white", 0.72],
  ["red:white:red_dot", 0.72],
  ["blue:white:blue_cross", 0.63],
  ["red:white:red_fork", 0.56],
  ["red:yellow:red_diamond", 0.55],
  ["black::white_diamond:HII:black", 0.51],
  ["red:white:green_diamond:rs:white", 0.43],
  ["red:yellow:blue_red_diamond", 0.42],
  ["red:yellow:green_diamond", 0.41],
  ["red:white:green_diamond:•:red", 0.4],
  ["red:white:red_diamond:W:green", 0.39],
  ["yellow:white:yellow_circle", 0.35],
  ["yellow:white:yellow_pointer", 0.35],
  ["blue:blue:shell_modern", 0.32],
  ["yellow:white:yellow_fork", 0.31],
  ["green:white:green_diamond:♡:red", 0.3],
  ["green:white:green_diamond_line:-s^:blue", 0.29],
  ["green:white:green_diamond_line:S:blue", 0.28],
  ["blue:white:blue_fork", 0.26],
  ["blue:blue:red_dot", 0.21],
  ["red:yellow:blue_diamond", 0.19],
  ["red:red:yellow_cross", 0.17],
  ["blue:blue_diamond_line:grey_diamond:m:green", 0.16],
  ["white:white:black_diamond_line:🎩:black", 0.16],
  ["red:yellow:white_diamond:n:black", 0.15],
  ["blue:white:blue_dot::green", 0.14],
  ["blue:blue:green_lower:Y:white", 0.12],
  ["yellow:yellow_circle::2:yellow", 0.11],
  ["blue:white:blue_diamond:~:white", 0.11],
  ["red:white::>:red", 0.08],
  ["yellow:black:yellow_circle:1:yellow", 0.08],
  ["red:white:red_triangle_turned:WWW:black", 0.08],
  ["blue:white:blue_arch", 0.08],
  ["orange:orange:red_right:white_backslash", 0.06],
  ["black:yellow:white_black_diamond", 0.06],
  ["red:white:red_diamond:K:white", 0.72],
];

describe("parseOsmc: real BW values", () => {
  test.each(BW_TOP)("%s is fully understood", (value) => {
    const p = parseOsmc(value);
    expect(p.readable).toBe(true);
    expect(p.issues).toEqual([]);
    expect(osmcToSvg(value)).toBeDefined();
  });

  test("yellow:white:yellow_diamond", () => {
    const p = parseOsmc("yellow:white:yellow_diamond");
    expect(p.waycolor).toBe(C.yellow);
    expect(p.background).toEqual({ colour: C.white });
    expect(p.foreground).toEqual([{ shape: "diamond", colour: C.yellow, colour2: undefined }]);
    expect(p.text).toBeUndefined();
  });

  test("empty background: yellow::yellow_diamond draws on a white plate", () => {
    const p = parseOsmc("yellow::yellow_diamond");
    expect(p.background).toEqual({});
    expect(p.foreground[0]?.shape).toBe("diamond");
    expect(p.readable).toBe(true);
    const svg = osmcToSvg("yellow::yellow_diamond")!.svg;
    expect(svg).toContain('fill="#ffffff"'); // plate
    expect(svg).toContain(`fill="${C.yellow}"`);
  });

  test("two-colour diamond: left half first colour, right half second", () => {
    const p = parseOsmc("red:white:black_red_diamond");
    expect(p.foreground[0]).toEqual({ shape: "diamond", colour: C.black, colour2: C.red });
  });

  test("text and text colour", () => {
    const p = parseOsmc("red:white:red_diamond:W:blue");
    expect(p.text).toBe("W");
    expect(p.textColour).toBe(C.blue);
    const q = parseOsmc("red:white::>:red");
    expect(q.foreground).toEqual([]);
    expect(q.text).toBe(">");
    expect(q.textColour).toBe(C.red);
  });

  test("'|' (written as '/' by the tile build) is shown as '|'", () => {
    expect(parseOsmc("red:white:red_diamond:/:white").text).toBe("|");
    expect(parseOsmc("red:white:red_diamond:|:white").text).toBe("|");
  });

  test("second foreground", () => {
    const p = parseOsmc("orange:orange:red_right:white_backslash");
    expect(p.foreground.map((f) => f.shape)).toEqual(["right", "backslash"]);
    const q = parseOsmc("green:green_circlce:white_dot:green_triangle");
    expect(q.background.shape).toBe("circle"); // typo mapped
    expect(q.foreground.map((f) => f.shape)).toEqual(["dot", "triangle"]);
  });

  test("background shapes", () => {
    expect(parseOsmc("blue:blue_round:white_hiker").background).toEqual({
      colour: C.blue,
      colour2: undefined,
      shape: "round",
    });
    expect(parseOsmc("yellow:black_circle:::K:black").background.shape).toBe("circle");
    expect(parseOsmc("yellow:black_circle:::K:black").text).toBe("K");
    expect(parseOsmc("green:green_frame:red_arrow").background.shape).toBe("frame");
    expect(parseOsmc("blue:blue_diamond_line:white_diamond:s:blue").background.shape).toBe(
      "diamond_line",
    );
  });

  test("case, whitespace and missing parts are tolerated", () => {
    const p = parseOsmc("  Yellow:WHITE: Yellow_Diamond ");
    expect(p.issues).toEqual([]);
    expect(p.foreground[0]).toEqual({ shape: "diamond", colour: C.yellow, colour2: undefined });
    expect(parseOsmc("yellow:white: blue_dot:Z:yellow").foreground[0]?.shape).toBe("dot");
    expect(parseOsmc("black:white: :1:black").text).toBe("1");
    expect(parseOsmc("::::R:red").text).toBe("R");
    expect(parseOsmc("green:green").background.colour).toBe(C.green);
    expect(parseOsmc("green:green").readable).toBe(true);
  });

  test("shape without colour is black, shells yellow", () => {
    expect(parseOsmc("black:white:tower").foreground[0]?.colour).toBe(C.black);
    expect(parseOsmc("blue:blue:shell_modern").foreground[0]?.colour).toBe(C.yellow);
  });

  test("non-shape foreground parts become text", () => {
    expect(parseOsmc("red:white:<").text).toBe("<");
    expect(parseOsmc("black:white::♜").text).toBe("♜");
    const w = parseOsmc("green:white:Waldachtaler Heimatweg:green");
    expect(w.text).toBe("WH");
    expect(w.textColour).toBe(C.green);
    expect(parseOsmc("green:white::L:green").text).toBe("L"); // "L" is a shape, but here text
    expect(parseOsmc("red:white:red_L").foreground[0]?.shape).toBe("L");
  });

  test("unknown parts: partial rendering with issues", () => {
    const frog = parseOsmc("green:blue:green_frog");
    expect(frog.readable).toBe(true);
    expect(frog.foreground).toEqual([]);
    expect(frog.background.colour).toBe(C.blue);
    expect(frog.issues.length).toBe(1);
    const planet = parseOsmc("brown:brown:planet:PO:white");
    expect(planet.text).toBe("PO");
    expect(planet.foreground).toEqual([]);
    // Bare colour as second foreground = misplaced text colour, ignored.
    expect(parseOsmc("blue:blue:white_circle:white").foreground.length).toBe(1);
  });

  test("unreadable values", () => {
    for (const v of ["green", "red", "green_circle", "", "   ", "Gelb:Weiß"]) {
      expect(parseOsmc(v).readable).toBe(false);
      expect(osmcToSvg(v)).toBeUndefined();
    }
  });

  test("text is cut to 4 characters", () => {
    expect(parseOsmc("x:white::ABCDEFG:black").text).toBe("ABCD");
  });

  test("every foreground shape draws something", () => {
    for (const s of FOREGROUND_SHAPES) {
      const v = s.length < 2 ? `red:white:red_${s}` : `red:white:red_${s}`;
      const p = parseOsmc(v);
      expect(p.foreground[0]?.shape).toBe(s);
      const svg = osmcToSvg(v)!.svg;
      // White plate + some shape element in the red of the shape.
      expect(svg).toContain(C.red);
    }
  });
});

describe("fallback chain", () => {
  test("readable osmc wins", () => {
    expect(resolveSign({ osmc: "red:white:red_dot", ref: "X", colour: "blue" })?.kind).toBe("osmc");
  });
  test("ref with colour", () => {
    const s = resolveSign({ ref: "HW3", colour: "red" });
    expect(s).toMatchObject({ kind: "ref-colour", text: "HW3", colour: C.red });
    expect(resolveSign({ ref: "1", colour: "#a0b" })).toMatchObject({ colour: "#a0b" });
  });
  test("unreadable osmc: ref with the way colour", () => {
    expect(resolveSign({ osmc: "green", ref: "G2" })).toMatchObject({
      kind: "ref-colour",
      colour: C.green,
    });
  });
  test("ref alone, unknown colour", () => {
    expect(resolveSign({ ref: "12", colour: "Mauve-ish" })).toMatchObject({
      kind: "ref",
      text: "12",
    });
  });
  test("name initials", () => {
    expect(resolveSign({ name: "Rundweg Hohenzollern" })).toMatchObject({
      kind: "name",
      text: "RH",
    });
    expect(nameAbbreviation("Weg der Sinne")).toBe("WS");
    expect(nameAbbreviation("Rundweg 3")).toBe("R3");
    expect(nameAbbreviation("Panoramaweg")).toBe("Pan");
    expect(nameAbbreviation("Rundwanderweg Nr. 12 Am Hohen Stein")).toBe("RN12");
    expect(nameAbbreviation("")).toBeUndefined();
  });
  test("nothing to show", () => {
    expect(resolveSign({})).toBeUndefined();
    expect(resolveSign({ osmc: "red" })).toBeUndefined();
  });
  test("routeColour", () => {
    expect(routeColour("Blue")).toBe(C.blue);
    expect(routeColour("#FF0000")).toBe("#ff0000");
    expect(routeColour("red;blue")).toBe(C.red);
    expect(routeColour("url(x)")).toBeUndefined();
  });
});

describe("combined image", () => {
  const signs = (svg: string): number =>
    (svg.match(/<g transform="translate\([^)]*\)"><rect/g) ?? []).length;

  test("signs side by side, equal signs once, fallback signs deduplicated", () => {
    const img = waymarkSvg([
      { osmc: "yellow:white:yellow_diamond" },
      { osmc: "Yellow:white:yellow_diamond " }, // same sign, other spelling
      { ref: "7" },
      { ref: "7" },
      { name: "Weg der Sinne" },
    ])!;
    expect(signs(img.svg)).toBe(3);
    expect(img.height).toBeCloseTo(mm(WAYMARK_HEIGHT_MM));
    expect(img.width).toBeGreaterThan(3 * img.height);
  });

  test("at most 4 signs", () => {
    const entries = ["red", "blue", "green", "yellow", "black"].map((c) => ({
      osmc: `${c}:white:${c}_dot`,
    }));
    expect(resolveSigns(entries).length).toBe(4);
    expect(signs(waymarkSvg(entries)!.svg)).toBe(4);
  });

  test("single sign is as high as a boxed pictogram (style/sizes.ts)", () => {
    const img = osmcToSvg("blue:white:blue_diamond")!;
    expect(img.height / mm(1)).toBeCloseTo(ICON_MM, 6);
    expect(img.width).toBeCloseTo(img.height);
  });

  test("clip ids are unique within one image", () => {
    const svg = waymarkSvg([
      { osmc: "red:white:red_dot" },
      { osmc: "blue:blue_circle:blue_dot" },
    ])!.svg;
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("text is XML-escaped", () => {
    const svg = osmcToSvg('red:white::<&">:red')!.svg;
    expect(svg).not.toContain('<&">');
    expect(svg).toContain("&#60;&#38;&#34;&#62;");
  });

  test("empty entries give no image", () => {
    expect(waymarkSvg([{}, { osmc: "red" }])).toBeUndefined();
  });
});

describe("image id round trip", () => {
  const evaluate = (props: Record<string, string>): string => {
    const r = expression.createExpression(waymarkImageExpression(), "layers[0].layout.icon-image");
    if (r.result !== "success") throw new Error(JSON.stringify(r.value));
    return String(r.value.evaluate({ zoom: 12 }, { type: 2, properties: props } as never));
  };

  const feature = {
    symbols: "blue:blue:shell_modern|green:blue::DZW|yellow:white:yellow_pointer|",
    refs: "JW||7|HW3",
    colours: "|||red",
    names: "Jakobsweg|Zollernweg|Rundweg 7|Hauptwanderweg 3",
  };

  test("expression -> id equals waymarkImageId", () => {
    const id = evaluate(feature);
    expect(id).toBe(waymarkImageId(feature));
    expect(id.startsWith("waymark:")).toBe(true);
    expect(id.split(WAYMARK_FIELD_SEPARATOR).length).toBe(4);
  });

  test("id -> entries, slots aligned", () => {
    const id = evaluate(feature);
    const entries = parseWaymarkId(id.slice("waymark:".length));
    expect(entries).toEqual([
      { osmc: "blue:blue:shell_modern", ref: "JW", name: "Jakobsweg" },
      { osmc: "green:blue::DZW", name: "Zollernweg" },
      { osmc: "yellow:white:yellow_pointer", ref: "7", name: "Rundweg 7" },
      { ref: "HW3", colour: "red", name: "Hauptwanderweg 3" },
    ]);
    expect(resolveSigns(entries).map((s) => s.kind)).toEqual([
      "osmc",
      "osmc",
      "osmc",
      "ref-colour",
    ]);
  });

  test("missing attributes count as empty", () => {
    const id = evaluate({ symbols: "red:white:red_dot" });
    expect(parseWaymarkId(id.slice(8))).toEqual([{ osmc: "red:white:red_dot" }]);
  });

  test("provider is registered for the prefix", () => {
    const img = svgForImageId(waymarkImageId(feature));
    expect(img).toBeDefined();
    expect((img!.svg.match(/<g transform="translate\([^)]*\)"><rect/g) ?? []).length).toBe(4);
    expect(svgForImageId(waymarkImageId({ symbols: "", refs: "", names: "" }))).toBeUndefined();
  });

  test("colons inside osmc values survive", () => {
    const id = waymarkImageId({ symbols: "red:white:red_diamond:W:blue" });
    expect(parseWaymarkId(id.slice(8))[0]?.osmc).toBe("red:white:red_diamond:W:blue");
  });
});

describe("coverage of BW values (osmc-bw.tsv, ≥ 95 % of routes with osmc:symbol)", () => {
  const rows = readFileSync(new URL("./osmc-bw.tsv", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .map(([n, share, cum, value]) => ({
      n: Number(n),
      share: Number(share),
      cum: Number(cum),
      value: value!,
    }));

  test("the list reaches 95 %", () => {
    expect(rows.at(-1)!.cum).toBeGreaterThanOrEqual(95);
  });

  // Only a colour, no sign: unreadable on purpose, these routes use the fallback chain.
  const UNREADABLE = ["green_circle", "green", "red"];

  test("every listed value parses without issues and renders", () => {
    const failed = rows.filter((r) => {
      if (UNREADABLE.includes(r.value)) return false;
      const p = parseOsmc(r.value);
      // A text colour without text is harmless (nothing is lost).
      const issues = p.issues.filter((i) => !i.startsWith("Textfarbe ohne Text"));
      return !p.readable || issues.length > 0 || !osmcToSvg(r.value);
    });
    expect(failed.map((r) => r.value)).toEqual([]);
    for (const v of UNREADABLE) expect(parseOsmc(v).readable).toBe(false);
  });
});
