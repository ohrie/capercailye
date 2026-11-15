import { describe, expect, test } from "bun:test";
import { mmToCssPx, mmToDevicePx, printableArea } from "./paper";
import {
  formatDistance,
  formatScale,
  metersPerCssPx,
  scaleBarLength,
  scaleForZoom,
  zoomForScale,
} from "./scale";

describe("zoomForScale", () => {
  test("1:25 000 at 48.5° N is about z12.94 (SPEC.md 4.3)", () => {
    expect(zoomForScale(25000, 48.5)).toBeCloseTo(12.94, 2);
  });

  test("halving the scale number adds one zoom level", () => {
    expect(zoomForScale(12500, 48) - zoomForScale(25000, 48)).toBeCloseTo(1, 10);
  });

  test("round-trips with scaleForZoom", () => {
    for (const s of [15000, 25000, 50000]) {
      expect(scaleForZoom(zoomForScale(s, 48.1836), 48.1836)).toBeCloseTo(s, 6);
    }
  });

  test("one CSS px at print zoom equals 0.2646 mm on paper", () => {
    const lat = 48.1836;
    const z = zoomForScale(25000, lat);
    const groundPerPx = metersPerCssPx(z, lat);
    expect((groundPerPx / 25000) * 1000).toBeCloseTo(25.4 / 96, 10);
  });
});

describe("scale bar and formatting", () => {
  test("nice lengths", () => {
    expect(scaleBarLength(25000, 45)).toEqual({ meters: 1000, mm: 40 });
    expect(scaleBarLength(50000, 45)).toEqual({ meters: 2000, mm: 40 });
    expect(scaleBarLength(15000, 45).meters).toBe(500);
  });

  test("labels", () => {
    expect(formatScale(25000, "de")).toBe("1:25 000");
    expect(formatScale(15000, "de")).toBe("1:15 000");
    expect(formatDistance(500, "de")).toBe("500 m");
    expect(formatDistance(2500, "de")).toBe("2,5 km");
    expect(formatScale(25000, "en")).toBe("1:25,000");
    expect(formatScale(1000, "en")).toBe("1:1,000");
    expect(formatDistance(500, "en")).toBe("500 m");
    expect(formatDistance(2500, "en")).toBe("2.5 km");
  });
});

describe("paper", () => {
  test("A4 printable area with 8 mm margins", () => {
    expect(printableArea("portrait")).toEqual({ width: 194, height: 281 });
    expect(printableArea("landscape")).toEqual({ width: 281, height: 194 });
  });

  test("unit conversions", () => {
    expect(mmToCssPx(25.4)).toBeCloseTo(96, 10);
    expect(mmToDevicePx(25.4, 300)).toBeCloseTo(300, 10);
  });
});
