import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mm } from "../style/units";
import { POI_ICONS, POI_KINDS, flagGeometry, iconSvg, poiIconSvg } from "./registry";
import { svgForImageId, registerImageProvider } from "./runtime";
import "./index";

const SCHEMA = readFileSync(new URL("../../../tiles/SCHEMA.md", import.meta.url), "utf8");

/** Kinds of the `poi` table in tiles/SCHEMA.md. */
function schemaPoiKinds(): string[] {
  const section = SCHEMA.slice(SCHEMA.indexOf("## `poi`"), SCHEMA.indexOf("### Densities"));
  return [...section.matchAll(/^\| `([a-z_]+)` \| \d+ \|/gm)].map((m) => m[1]!);
}

/** Minimal XML well-formedness check: balanced tags, quoted attributes, single root. */
function checkXml(xml: string): void {
  const stack: string[] = [];
  let roots = 0;
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let pos = 0;
  for (const m of xml.matchAll(tagRe)) {
    expect(xml.slice(pos, m.index).trim()).toBe(""); // no stray text / broken tags
    pos = m.index! + m[0].length;
    const [, close, name, , selfClose] = m;
    if (close) {
      expect(stack.pop()).toBe(name);
    } else {
      if (stack.length === 0) roots++;
      if (!selfClose) stack.push(name!);
    }
  }
  expect(xml.slice(pos).trim()).toBe("");
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

describe("POI icon registry", () => {
  test("POI_KINDS matches the poi kinds of tiles/SCHEMA.md", () => {
    const kinds = schemaPoiKinds();
    expect(kinds.length).toBeGreaterThan(30);
    expect<string[]>([...POI_KINDS].sort()).toEqual([...kinds].sort());
  });

  test.each(schemaPoiKinds())("%s has an icon and well-formed SVG", (kind) => {
    const img = poiIconSvg(kind);
    expect(img).toBeDefined();
    const { svg, width, height } = img!;
    checkXml(svg);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ')).toBe(true);
    expect(svg).not.toMatch(/undefined|NaN/);
    // Every path has non-empty data made of SVG path characters only.
    for (const [, d] of svg.matchAll(/ d="([^"]*)"/g)) {
      expect(d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
    }
    expect(width).toBe(height);
  });

  test("paper sizes: boxes 3.0–3.6 mm, plain symbols 1.8–3 mm", () => {
    for (const [name, def] of Object.entries(POI_ICONS)) {
      const [lo, hi] = def.style === "plain" ? [1.8, 3] : [3, 3.6];
      expect(def.sizeMm, name).toBeGreaterThanOrEqual(lo);
      expect(def.sizeMm, name).toBeLessThanOrEqual(hi);
      expect(iconSvg(def).width).toBeCloseTo(mm(def.sizeMm), 6);
    }
  });

  test("flag pole foot lands on the anchor point", () => {
    const g = flagGeometry("guidepost");
    expect(g.iconOffset[0]).toBeLessThan(0);
    expect(g.iconOffset[1]).toBeGreaterThanOrEqual(0);
    expect(g.pennantRightPx).toBeGreaterThan(0);
    expect(g.pennantMidYPx).toBeLessThan(0);
  });
});

describe("image providers", () => {
  test("poi: prefix resolves, unknown ids do not", () => {
    expect(svgForImageId("poi:castle")?.svg).toContain("<svg");
    expect(svgForImageId("poi:nope")).toBeUndefined();
    expect(svgForImageId("osmc:red:white:red_bar")).toBeUndefined();
    expect(svgForImageId("castle")).toBeUndefined();
  });

  test("further prefixes can be registered (osmc in M3)", () => {
    registerImageProvider("test", (name) =>
      name === "x" ? { svg: '<svg viewBox="0 0 1 1"/>', width: 1, height: 1 } : undefined,
    );
    expect(svgForImageId("test:x")?.width).toBe(1);
    expect(svgForImageId("test:y")).toBeUndefined();
  });
});
