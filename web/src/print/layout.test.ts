import { describe, expect, test } from "bun:test";
import { lngLatToMm } from "../placement/geo";
import {
  type Area,
  areaCenter,
  computeLayout,
  defaultArea,
  fieldSize,
  type LayoutSettings,
  layoutFilename,
  MAX_SHEETS,
  OVERLAP_MM,
  recenterArea,
  roundScaleUp,
} from "./layout";
import { LEGEND_STRIP_MM, printableArea } from "./paper";

const DAHN: Area = { west: 7.7, south: 49.1, east: 7.86, north: 49.2 };
const HUGE: Area = { west: 7, south: 49, east: 8, north: 50 };
const TINY: Area = { west: 7.7, south: 49.1, east: 7.7005, north: 49.1004 };

function settings(over: Partial<LayoutSettings>): LayoutSettings {
  return { mode: "scale", scale: 25000, pages: 6, orientation: "portrait", area: DAHN, ...over };
}

describe("field size", () => {
  test("portrait field is 194 x 270 mm (printable area minus legend strip)", () => {
    expect(fieldSize("portrait")).toEqual({ width: 194, height: 270 });
    const p = printableArea("portrait");
    expect(p.height - fieldSize("portrait").height).toBe(LEGEND_STRIP_MM);
  });
});

describe("mode scale", () => {
  test("Dahn at 1:25 000 portrait: 3 x 2 sheets", () => {
    const l = computeLayout(settings({}));
    expect([l.cols, l.rows, l.count, l.sheets.length]).toEqual([3, 2, 6, 6]);
    expect(l.scale).toBe(25000);
    expect(l.tooLarge).toBe(false);
    expect(l.areaCovered).toBe(true);
  });

  test("the grid covers the area", () => {
    for (const scale of [15000, 25000, 50000]) {
      const l = computeLayout(settings({ scale }));
      expect(l.gridMm.minX).toBeLessThanOrEqual(l.areaMm.minX + 1e-6);
      expect(l.gridMm.minY).toBeLessThanOrEqual(l.areaMm.minY + 1e-6);
      expect(l.gridMm.maxX).toBeGreaterThanOrEqual(l.areaMm.maxX - 1e-6);
      expect(l.gridMm.maxY).toBeGreaterThanOrEqual(l.areaMm.maxY - 1e-6);
    }
  });

  test("default area at 1:25 000 portrait is exactly one sheet", () => {
    const area = defaultArea([7.78, 49.15], "portrait", 25000);
    const l = computeLayout(settings({ area }));
    expect([l.cols, l.rows, l.count]).toEqual([1, 1, 1]);
  });

  test("huge area at 1:15 000 is too large", () => {
    const l = computeLayout(settings({ scale: 15000, area: HUGE }));
    expect(l.tooLarge).toBe(true);
    expect(l.sheets).toEqual([]);
    expect(l.count).toBeGreaterThan(MAX_SHEETS);
  });
});

describe("mode pages", () => {
  test("Dahn on 6 portrait sheets: 3 x 2 at a whole-thousand scale between 1:20 000 and 1:22 000", () => {
    const l = computeLayout(settings({ mode: "pages", pages: 6 }));
    expect([l.cols, l.rows, l.count]).toEqual([3, 2, 6]);
    expect(l.scale % 1000).toBe(0);
    expect(l.scale).toBeGreaterThanOrEqual(20000);
    expect(l.scale).toBeLessThanOrEqual(22000);
    expect(l.areaCovered).toBe(true);
  });

  test("every other decomposition would need a larger scale", () => {
    const best = computeLayout(settings({ mode: "pages", pages: 6 })).scale;
    // Force 2 x 3 / 1 x 6 / 6 x 1 by hand: width and height of the grid at the common scale.
    const field = fieldSize("portrait");
    const l = computeLayout(settings({ mode: "pages", pages: 6 }));
    const wRef = (l.areaMm.maxX - l.areaMm.minX) * (l.scale / 25000);
    const hRef = (l.areaMm.maxY - l.areaMm.minY) * (l.scale / 25000);
    for (const [c, r] of [
      [2, 3],
      [1, 6],
      [6, 1],
    ] as const) {
      const gw = c * field.width - (c - 1) * OVERLAP_MM;
      const gh = r * field.height - (r - 1) * OVERLAP_MM;
      expect(25000 * Math.max(wRef / gw, hRef / gh)).toBeGreaterThan(best);
    }
  });

  test("the grid covers the area when areaCovered", () => {
    for (const pages of [1, 2, 3, 4, 6, 8, 9, 12]) {
      const l = computeLayout(settings({ mode: "pages", pages }));
      if (!l.areaCovered) continue;
      expect(l.gridMm.minX).toBeLessThanOrEqual(l.areaMm.minX + 1e-6);
      expect(l.gridMm.minY).toBeLessThanOrEqual(l.areaMm.minY + 1e-6);
      expect(l.gridMm.maxX).toBeGreaterThanOrEqual(l.areaMm.maxX - 1e-6);
      expect(l.gridMm.maxY).toBeGreaterThanOrEqual(l.areaMm.maxY - 1e-6);
    }
  });

  test("tiny area, 1 sheet: clamped to 1:10 000 (grid larger than the area)", () => {
    const l = computeLayout(settings({ mode: "pages", pages: 1, area: TINY }));
    expect(l.scale).toBe(10000);
    expect(l.areaCovered).toBe(true);
  });

  test("huge area, 1 sheet: clamped to 1:50 000 and not covered", () => {
    const l = computeLayout(settings({ mode: "pages", pages: 1, area: HUGE }));
    expect(l.scale).toBe(50000);
    expect(l.areaCovered).toBe(false);
    expect(l.sheets.length).toBe(1);
  });
});

describe("sheets", () => {
  const l = computeLayout(settings({}));

  test("neighbouring map fields overlap by exactly 10 mm", () => {
    for (const a of l.sheets) {
      for (const b of l.sheets) {
        if (b.row === a.row && b.col === a.col + 1) {
          expect(a.fieldMm.maxX - b.fieldMm.minX).toBeCloseTo(OVERLAP_MM, 6);
          expect(a.fieldMm.minY).toBeCloseTo(b.fieldMm.minY, 6);
        }
        if (b.col === a.col && b.row === a.row + 1) {
          expect(a.fieldMm.maxY - b.fieldMm.minY).toBeCloseTo(OVERLAP_MM, 6);
          expect(a.fieldMm.minX).toBeCloseTo(b.fieldMm.minX, 6);
        }
      }
    }
  });

  test("centre maps back to the middle of the printable area; printMm adds the strip at the bottom", () => {
    for (const s of l.sheets) {
      const [x, y] = lngLatToMm(s.center[0], s.center[1], l.zoom);
      expect(x).toBeCloseTo((s.printMm.minX + s.printMm.maxX) / 2, 6);
      expect(y).toBeCloseTo((s.printMm.minY + s.printMm.maxY) / 2, 6);
      expect(s.printMm.minX).toBe(s.fieldMm.minX);
      expect(s.printMm.minY).toBe(s.fieldMm.minY);
      expect(s.printMm.maxX).toBe(s.fieldMm.maxX);
      expect(s.printMm.maxY - s.fieldMm.maxY).toBeCloseTo(LEGEND_STRIP_MM, 9);
    }
  });

  test("the grid is centred on the area", () => {
    const [ax, ay] = [(l.areaMm.minX + l.areaMm.maxX) / 2, (l.areaMm.minY + l.areaMm.maxY) / 2];
    expect((l.gridMm.minX + l.gridMm.maxX) / 2).toBeCloseTo(ax, 6);
    expect((l.gridMm.minY + l.gridMm.maxY) / 2).toBeCloseTo(ay, 6);
  });

  test("numbered row by row; sheet 2 of 3 x 2 has left 1, right 3, bottom 5 and no top", () => {
    expect(l.sheets.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(l.sheets[1]!.neighbours).toEqual({ left: 1, right: 3, bottom: 5 });
    expect(l.sheets[0]!.neighbours).toEqual({ right: 2, bottom: 4 });
    expect(l.sheets[5]!.neighbours).toEqual({ top: 3, left: 5 });
  });

  test("the placement region is the printable grid plus 5 mm bleed", () => {
    expect(l.regionMm.minX).toBeCloseTo(l.gridMm.minX - 5, 9);
    expect(l.regionMm.maxY).toBeCloseTo(l.gridMm.maxY + LEGEND_STRIP_MM + 5, 9);
  });
});

describe("helpers", () => {
  test("roundScaleUp", () => {
    expect(roundScaleUp(20001)).toBe(21000);
    expect(roundScaleUp(21000)).toBe(21000);
  });

  test("layoutFilename", () => {
    const one = computeLayout(settings({ area: defaultArea([7.78, 49.15], "portrait", 25000) }));
    expect(layoutFilename(one)).toBe("capercailye-1-25000-hoch.pdf");
    const six = computeLayout(settings({ mode: "pages", pages: 6 }));
    expect(layoutFilename(six)).toBe(`capercailye-1-${six.scale}-hoch-6-seiten.pdf`);
    expect(layoutFilename({ scale: 21000, orientation: "portrait", count: 6 })).toBe(
      "capercailye-1-21000-hoch-6-seiten.pdf",
    );
    expect(layoutFilename({ scale: 25000, orientation: "landscape", count: 1 })).toBe(
      "capercailye-1-25000-quer.pdf",
    );
  });

  test("recenterArea keeps the size in Mercator and moves the centre", () => {
    const moved = recenterArea(DAHN, [8.5, 49.5]);
    const c = areaCenter(moved);
    expect(c[0]).toBeCloseTo(8.5, 9);
    expect(c[1]).toBeCloseTo(49.5, 9);
    const a = computeLayout(settings({ area: DAHN, scale: 15000 }));
    const b = computeLayout(settings({ area: moved, scale: 15000 }));
    // Same size in Mercator = same size in mm at one zoom up to the cos(lat) change of the zoom.
    const wa = (a.areaMm.maxX - a.areaMm.minX) * 2 ** -a.zoom;
    const wb = (b.areaMm.maxX - b.areaMm.minX) * 2 ** -b.zoom;
    expect(wb).toBeCloseTo(wa, 9);
  });
});
