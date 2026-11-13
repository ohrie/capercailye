import { describe, expect, test } from "bun:test";
import type { Map as MapLibreMap } from "maplibre-gl";
import { waymarkLayers } from "../style/routes";
import { MM_PER_PX } from "../style/units";
import { placeCandidates, type Candidate } from "./collect";
import { lngLatToMm } from "./geo";
import { managedLayers } from "./layers";
import { iconPaddingPx, renderedObstacles } from "./rendered";

const ZOOM = 13;
const ORIGIN: [number, number] = [9.2, 48.4];
const waymarks = managedLayers(waymarkLayers());

/** Minimal stand-in for the MapLibre internals rendered.ts reads. */
function fakeMap(boxes: { bucket: number; box: [number, number, number, number] }[]) {
  const tiles: Record<string, { buckets: Record<string, { bucketInstanceId: number }> }> = {
    a: {
      buckets: { "waymarks-line": { bucketInstanceId: 7 }, "poi-main": { bucketInstanceId: 8 } },
    },
  };
  return {
    unproject: () => ({ lng: ORIGIN[0], lat: ORIGIN[1] }),
    style: {
      placement: {
        collisionIndex: {
          grid: {
            boxKeys: boxes.map((b) => ({ bucketInstanceId: b.bucket })),
            bboxes: boxes.flatMap((b) => b.box),
          },
        },
      },
      tileManagers: {
        osm: { getRenderableIds: () => ["a"], getTileByID: (id: string) => tiles[id] },
      },
    },
  } as unknown as MapLibreMap;
}

describe("renderedObstacles", () => {
  test("reads the placed waymark boxes in paper mm, without padding and grid offset", () => {
    const pad = iconPaddingPx(waymarks[0]!);
    expect(pad).toBeGreaterThan(0);
    const map = fakeMap([
      { bucket: 7, box: [100 - pad, 100 - pad, 140 + pad, 118 + pad] },
      { bucket: 8, box: [0, 0, 10, 10] }, // a pictogram: not an obstacle
    ]);
    const out = renderedObstacles(map, waymarks, ZOOM);
    expect(out).toHaveLength(1);
    const [ox, oy] = lngLatToMm(ORIGIN[0], ORIGIN[1], ZOOM);
    expect(out[0]!.minX).toBeCloseTo(ox, 6);
    expect(out[0]!.minY).toBeCloseTo(oy, 6);
    expect(out[0]!.maxX - out[0]!.minX).toBeCloseTo(40 * MM_PER_PX, 6);
    expect(out[0]!.maxY - out[0]!.minY).toBeCloseTo(18 * MM_PER_PX, 6);
  });

  test("missing internals give no obstacles instead of an error", () => {
    expect(renderedObstacles({} as MapLibreMap, waymarks, ZOOM)).toEqual([]);
    expect(renderedObstacles(fakeMap([]), [], ZOOM)).toEqual([]);
  });

  test("pictograms outside the sheet still avoid the obstacles (second pass)", () => {
    const item = (id: string, x: number): Candidate =>
      ({
        item: { id, x, y: 0, box: { minX: -1, minY: -1, maxX: 1, maxY: 1 }, priority: 0 },
      }) as Candidate;
    const obstacle = { minX: 49, minY: -1, maxX: 51, maxY: 1 };
    const placements = placeCandidates([item("in", 0), item("out", 50)], {
      zoom: ZOOM,
      region: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
      outside: true,
      options: { obstacles: [obstacle] },
    });
    const out = placements.find((p) => p.id === "out")!;
    expect(Math.hypot(out.dx, out.dy)).toBeGreaterThan(1.9);
  });
});
