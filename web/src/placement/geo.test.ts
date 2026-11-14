import { describe, expect, test } from "bun:test";
import { growRect, lngLatToMm, mmToLngLat, tileRangeForRect, tileUnitsToMm } from "./geo";

describe("tile units", () => {
  test("tile units of z12 agree with lng/lat -> mm at any map zoom", () => {
    const lng = 8.7;
    const lat = 48.9;
    const n = 2 ** 12;
    const fx = (lng + 180) / 360;
    const s = Math.sin((lat * Math.PI) / 180);
    const fy = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    for (const zoom of [11.95, 12.95, 14]) {
      const [x, y] = tileUnitsToMm(fx * n * 4096, fy * n * 4096, zoom);
      const [ex, ey] = lngLatToMm(lng, lat, zoom);
      expect(x).toBeCloseTo(ex, 6);
      expect(y).toBeCloseTo(ey, 6);
    }
  });

  test("the tile range covers the rectangle and is clamped to the world", () => {
    const zoom = 12.95;
    const [x, y] = lngLatToMm(8.7, 48.9, zoom);
    const r = { minX: x - 100, minY: y - 100, maxX: x + 100, maxY: y + 100 };
    const t = tileRangeForRect(r, zoom);
    // Every corner lies inside the tile range (in tile units).
    for (const [cx, cy] of [
      [r.minX, r.minY],
      [r.maxX, r.maxY],
    ] as const) {
      const [lng] = mmToLngLat(cx, cy, zoom);
      const n = 2 ** 12;
      const tx = Math.floor(((lng + 180) / 360) * n);
      expect(tx).toBeGreaterThanOrEqual(t.minX);
      expect(tx).toBeLessThanOrEqual(t.maxX);
    }
    expect(tileRangeForRect({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }, 12)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 4095,
      maxY: 4095,
    });
  });

  test("growRect", () => {
    expect(growRect({ minX: 0, minY: 1, maxX: 2, maxY: 3 }, 1)).toEqual({
      minX: -1,
      minY: 0,
      maxX: 3,
      maxY: 4,
    });
  });
});
