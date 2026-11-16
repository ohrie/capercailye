import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POI_ICONS, POI_KINDS, poiIconSvg } from "./icons/registry";
import { LEGEND_SECTION_KEYS, legendCatalog, legendSvg, NO_LEGEND } from "./legend";
import { COLORS } from "./style/palette";
import { POI_CATEGORIES } from "./style/poi";
import { PROTECTED_BANDS } from "./style/protected";
import { SECTIONS, uiGroups } from "./style";

const labelled = SECTIONS.flatMap((s) => uiGroups(s.id));

describe("legendSvg", () => {
  test("every labelled group except the sub-switches has an image", () => {
    for (const g of labelled) {
      const image = legendSvg(g.id);
      if (NO_LEGEND.test(g.id)) {
        expect(image, g.id).toBeUndefined();
        continue;
      }
      expect(image, g.id).toBeDefined();
      expect(image!.svg.startsWith("<svg"), g.id).toBe(true);
      expect(image!.svg, g.id).toContain("viewBox=");
      expect(image!.width, g.id).toBeGreaterThan(0);
      expect(image!.height, g.id).toBeGreaterThan(0);
    }
  });

  test("the sub-switches have none", () => {
    for (const id of ["net-iwn", "net-nwn", "net-rwn", "net-lwn", "guidepostnames"]) {
      expect(legendSvg(id), id).toBeUndefined();
    }
    expect(labelled.some((g) => g.id.startsWith("net-"))).toBe(true);
  });

  test("legend kinds of a category: one or two, part of its kinds, known icons", () => {
    for (const c of POI_CATEGORIES) {
      expect(c.legend.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.legend.length, c.id).toBeLessThanOrEqual(2);
      for (const k of c.legend) {
        expect(c.kinds, `${c.id}/${k}`).toContain(k);
        expect(POI_ICONS[k], `${c.id}/${k}`).toBeDefined();
      }
    }
  });

  test("symbols come from the map's sources", () => {
    expect(legendSvg("busstops")!.svg).toContain(poiIconSvg("busstop")!.svg);
    expect(legendSvg("viewpoints")!.svg).toBe(poiIconSvg("viewpoint")!.svg);
    expect(legendSvg("routes")!.svg).toContain(COLORS.route);
    expect(legendSvg("routes")!.svg).toContain(COLORS.path);
    expect(legendSvg("contours")!.svg).toContain(COLORS.contour);
    expect(legendSvg("buildings")!.svg).toContain(COLORS.building);
    expect(legendSvg("protected")!.svg).toContain(COLORS.protectedReserve);
  });

  test("two kinds sit side by side, each with its own icon", () => {
    const two = legendSvg("shelters")!;
    expect(two.svg.match(/<svg /g)!.length).toBe(3); // outer + two nested
    const one = poiIconSvg("shelter")!;
    expect(two.width).toBeGreaterThan(2 * one.width);
    expect(legendSvg("parking")!.svg).toBe(poiIconSvg("parking")!.svg);
  });
});

describe("legendCatalog", () => {
  const catalog = legendCatalog();
  const symbols = catalog.filter((g) => g.section === "symbols");
  const areas = catalog.filter((g) => g.section === "areas");
  const entries = catalog.flatMap((g) => g.entries);
  const messages = (locale: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(import.meta.dir, "..", "messages", `${locale}.json`), "utf8"));

  test("every pictogram kind appears exactly once (plus the bus stop, without guidepost_small)", () => {
    const keys = symbols.flatMap((g) => g.entries.map((e) => e.key));
    expect([...keys].sort()).toEqual([...POI_KINDS, "busstop"].sort());
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("guidepost_small");
  });

  test("symbol groups: the categories, then viewpoints, bus stops and the rest", () => {
    const ids = symbols.map((g) => g.id);
    expect(ids).toEqual([...POI_CATEGORIES.map((c) => c.id), "viewpoints", "busstops", "poi"]);
    for (const c of POI_CATEGORIES) {
      const group = symbols.find((g) => g.id === c.id)!;
      expect(group.entries.map((e) => e.key)).toEqual(c.kinds);
      expect(group.titleKey).toBe(`layer_${c.id}`);
    }
    expect(symbols.find((g) => g.id === "poi")!.entries.length).toBeGreaterThan(0);
  });

  test("pictograms come from poiIconSvg", () => {
    for (const g of symbols) {
      for (const e of g.entries) expect(e.image.svg, e.key).toBe(poiIconSvg(e.key)!.svg);
    }
  });

  test("areas: land cover, water, one entry per protected-area kind, buildings", () => {
    expect(areas.length).toBe(1);
    const keys = areas[0]!.entries.map((e) => e.key);
    for (const k of ["forest", "meadow", "farmland", "quarry", "industrial", "water", "building"]) {
      expect(keys, k).toContain(k);
    }
    for (const [kind, , color] of PROTECTED_BANDS) {
      const entry = areas[0]!.entries.find((e) => e.key === kind)!;
      expect(entry.image.svg, kind).toContain(color);
    }
    expect(areas[0]!.entries.find((e) => e.key === "forest")!.image.svg).toContain(
      COLORS.forestEdge,
    );
    expect(areas[0]!.entries.find((e) => e.key === "water")!.image.svg).toContain(
      COLORS.waterOutline,
    );
    expect(areas[0]!.entries.find((e) => e.key === "building")!.image.svg).toContain(
      COLORS.building,
    );
  });

  test("SAC scale: dashes, dots, alpine dots in the warning colour", () => {
    const paths = catalog.filter((g) => g.section === "paths");
    expect(paths.length).toBe(1);
    const [hiking, mountain, alpine] = paths[0]!.entries;
    expect(paths[0]!.entries.map((e) => e.key)).toEqual([
      "sac_hiking",
      "sac_mountain",
      "sac_alpine",
      "private",
    ]);
    expect(hiking!.image.svg).toContain(COLORS.path);
    expect(mountain!.image.svg).toContain('stroke-linecap="round"');
    expect(alpine!.image.svg).toContain(COLORS.pathAlpine);
  });

  test("every image has a viewBox and a size", () => {
    expect(entries.length).toBeGreaterThan(50);
    for (const e of entries) {
      expect(e.image.svg.startsWith("<svg"), e.key).toBe(true);
      expect(e.image.svg, e.key).toContain("viewBox=");
      expect(e.image.width, e.key).toBeGreaterThan(0);
      expect(e.image.height, e.key).toBeGreaterThan(0);
    }
  });

  test("no routes or way signatures", () => {
    for (const e of entries.filter((e) => !e.key.startsWith("sac_"))) {
      expect(e.key, e.key).not.toMatch(/route|path|track|road|trail|waymark|net-/);
      expect(e.image.svg, e.key).not.toContain(COLORS.route);
      expect(e.image.svg, e.key).not.toContain(COLORS.path);
    }
  });

  test("every label key exists in both languages", () => {
    const keys = [
      ...entries.map((e) => e.labelKey),
      ...catalog.flatMap((g) => (g.titleKey ? [g.titleKey] : [])),
      ...Object.values(LEGEND_SECTION_KEYS),
      "legend_open",
      "legend_heading",
      "legend_close",
    ];
    for (const locale of ["de", "en"]) {
      const known = messages(locale);
      for (const k of keys) expect(known[k], `${locale}.${k}`).toBeString();
    }
  });
});
