import { describe, expect, test } from "bun:test";
import { POI_ICONS, poiIconSvg } from "./icons/registry";
import { legendSvg, NO_LEGEND } from "./legend";
import { COLORS } from "./style/palette";
import { POI_CATEGORIES } from "./style/poi";
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
