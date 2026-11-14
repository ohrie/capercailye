import { describe, expect, test } from "bun:test";
import type { RouteInfo } from "./routes";
import { waymarkPlan, waymarksFromData } from "./index";
import type { RegionData, RoutePiece } from "./tiles";

const ZOOM = 12.94;
const REGION = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

const route = (id: string): RouteInfo => ({
  id,
  network: "rwn",
  osmc: "red:white:red_bar",
});

const data = (pieces: RoutePiece[]): RegionData => ({
  pieces,
  routes: new Map([
    ["r1", route("r1")],
    ["r2", route("r2")],
  ]),
  urban: [],
});

const points = (pieces: RoutePiece[]): string => {
  const r = waymarksFromData(data(pieces), REGION, ZOOM);
  return JSON.stringify(r.data.features.map((f) => f.geometry.coordinates));
};

describe("waymarksFromData", () => {
  const whole: [number, number][] = [
    [0, 100],
    [1000, 160],
    [2000, 100],
    [3000, 160],
    [4000, 100],
  ];

  test("routes with the same sign are one: a change of relation makes no fork and no pile-up", () => {
    const a = points([{ coords: whole, routes: ["r1"] }]);
    const b = points([
      {
        coords: [
          [0, 100],
          [1000, 160],
          [2000, 100],
        ],
        routes: ["r1"],
      },
      {
        coords: [
          [2000, 100],
          [3000, 160],
          [4000, 100],
        ],
        routes: ["r2"],
      },
    ]);
    const c = points([
      {
        coords: [
          [0, 100],
          [1000, 160],
          [2000, 100],
        ],
        routes: ["r1", "r2"],
      },
      {
        coords: [
          [2000, 100],
          [3000, 160],
          [4000, 100],
        ],
        routes: ["r1"],
      },
    ]);
    expect(JSON.parse(a).length).toBeGreaterThan(2);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test("statistics: every wanted sign is placed or counted as dropped", () => {
    const pieces = [{ coords: whole, routes: ["r1"] }];
    const stats = waymarkPlan(data(pieces), ZOOM);
    const r = waymarksFromData(data(pieces), REGION, ZOOM);
    expect(r.placed).toBe(stats.signs.length);
    expect(r.dropped).toBe(stats.mandatory.wanted + stats.repeats.wanted - stats.signs.length);
    expect(stats.mandatory.wanted).toBe(1);
  });
});
