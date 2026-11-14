import { describe, expect, test } from "bun:test";
import { areaOutside, dragRect, interactionFor } from "./mode";

describe("interactionFor", () => {
  const all = {
    dragPan: true,
    scrollZoom: true,
    doubleClickZoom: true,
    boxZoom: true,
    touchZoomRotate: true,
  };
  test("explore and sheets: everything on without print view", () => {
    expect(interactionFor("explore", false)).toEqual(all);
    expect(interactionFor("sheets", false)).toEqual(all);
  });
  test("print view locks the zoom handlers but keeps dragging", () => {
    for (const mode of ["explore", "sheets"] as const) {
      expect(interactionFor(mode, true)).toEqual({
        dragPan: true,
        scrollZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        touchZoomRotate: false,
      });
    }
  });
  test("draw: no dragging and no gestures that fight it, wheel zoom stays", () => {
    expect(interactionFor("draw", false)).toEqual({
      dragPan: false,
      scrollZoom: true,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoomRotate: false,
    });
    expect(interactionFor("draw", true)).toEqual({
      dragPan: false,
      scrollZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoomRotate: false,
    });
  });
});

describe("dragRect", () => {
  test("normalised in all four drag directions", () => {
    expect(dragRect([10, 20], [110, 90], 12)).toEqual([10, 20, 110, 90]);
    expect(dragRect([110, 20], [10, 90], 12)).toEqual([10, 20, 110, 90]);
    expect(dragRect([10, 90], [110, 20], 12)).toEqual([10, 20, 110, 90]);
    expect(dragRect([110, 90], [10, 20], 12)).toEqual([10, 20, 110, 90]);
  });
  test("a side under the minimum is a click", () => {
    expect(dragRect([10, 10], [10, 10], 12)).toBeNull();
    expect(dragRect([10, 10], [21, 100], 12)).toBeNull();
    expect(dragRect([10, 10], [100, 21], 12)).toBeNull();
    expect(dragRect([10, 10], [22, 22], 12)).toEqual([10, 10, 22, 22]);
  });
});

describe("areaOutside", () => {
  const view = { west: 7, south: 49, east: 8, north: 50 };
  test("inside, partly overlapping, completely outside", () => {
    expect(areaOutside({ west: 7.2, south: 49.2, east: 7.4, north: 49.4 }, view)).toBe(false);
    expect(areaOutside({ west: 7.8, south: 49.8, east: 8.4, north: 50.4 }, view)).toBe(false);
    expect(areaOutside({ west: 8.1, south: 49.2, east: 8.4, north: 49.4 }, view)).toBe(true);
    expect(areaOutside({ west: 7.2, south: 50.1, east: 7.4, north: 50.4 }, view)).toBe(true);
    expect(areaOutside({ west: 6, south: 49.2, east: 6.9, north: 49.4 }, view)).toBe(true);
    expect(areaOutside({ west: 7.2, south: 48, east: 7.4, north: 48.9 }, view)).toBe(true);
  });
  test("an area around the view overlaps", () => {
    expect(areaOutside({ west: 6, south: 48, east: 9, north: 51 }, view)).toBe(false);
  });
});
