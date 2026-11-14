import { describe, expect, test } from "bun:test";
import {
  networkGroup,
  routesFromProperties,
  routesOn,
  routeVisible,
  type RouteInfo,
} from "./routes";
import { signsForRoutes } from "./signs";
import { SMALL_SCALE_FACTOR } from "../style/sizes";

describe("routesFromProperties", () => {
  test("aligns slots, empty slots become undefined", () => {
    const routes = routesFromProperties({
      ids: "1|2|3",
      networks: "rwn||LWN",
      symbols: "red:white:red_bar||",
      refs: "|X|12",
      colours: "||red",
      names: "A||C",
    });
    expect(routes).toEqual([
      { id: "1", network: "rwn", osmc: "red:white:red_bar", name: "A" },
      { id: "2", network: "", ref: "X" },
      { id: "3", network: "lwn", ref: "12", colour: "red", name: "C" },
    ]);
  });

  test("no ids, no routes", () => {
    expect(routesFromProperties({ symbols: "a" })).toEqual([]);
  });
});

describe("routeVisible", () => {
  const r = (network: string): RouteInfo => ({ id: "1", network });
  test("by default every route shows its sign, local and without network included", () => {
    for (const n of ["iwn", "nwn", "rwn", "lwn", "", "local", "xyz"]) {
      expect(routeVisible(r(n), {})).toBe(true);
    }
  });
  test('"Wanderrouten" off: no route shows a sign, whatever the network switches say', () => {
    for (const n of ["iwn", "rwn", "lwn", ""]) {
      expect(routeVisible(r(n), { routes: false })).toBe(false);
      expect(routeVisible(r(n), { routes: false, "net-lwn": true, "net-rwn": true })).toBe(false);
    }
    expect(routesOn({})).toBe(true);
    expect(routesOn({ routes: false })).toBe(false);
  });
  test("net-rwn off: rwn routes drop out, lwn stays", () => {
    const v = { "net-rwn": false };
    expect(routeVisible(r("rwn"), v)).toBe(false);
    expect(routeVisible(r("lwn"), v)).toBe(true);
    expect(routeVisible(r(""), v)).toBe(true);
    expect(routeVisible(r("iwn"), v)).toBe(true);
  });
  test("net-lwn off: lwn, empty and unknown networks drop out", () => {
    const v = { "net-lwn": false };
    for (const n of ["lwn", "", "local", "xyz"]) expect(routeVisible(r(n), v)).toBe(false);
    for (const n of ["iwn", "nwn", "rwn"]) expect(routeVisible(r(n), v)).toBe(true);
  });
  test("networkGroup: everything but iwn/nwn/rwn is net-lwn (as the profile attribute nets)", () => {
    expect(networkGroup("iwn")).toBe("net-iwn");
    expect(networkGroup("nwn")).toBe("net-nwn");
    expect(networkGroup("rwn")).toBe("net-rwn");
    for (const n of ["lwn", "", "local", "xyz"]) expect(networkGroup(n)).toBe("net-lwn");
  });
});

describe("signsForRoutes", () => {
  const base = (over: Partial<RouteInfo>): RouteInfo => ({ id: "1", network: "rwn", ...over });

  test("equal osmc symbols give one sign", () => {
    const signs = signsForRoutes(
      [
        base({ id: "1", osmc: "red:white:red_bar" }),
        base({ id: "2", osmc: "red:white:red_bar", name: "other" }),
        base({ id: "3", osmc: "blue:white:blue_dot" }),
      ],
      1,
    );
    expect(signs).toHaveLength(2);
    expect(signs[0]!.rank).toBe(2);
  });

  test("route without osmc falls back to ref + colour", () => {
    const [s] = signsForRoutes([base({ ref: "12", colour: "red" })], 1);
    expect(s!.key.startsWith("r:12:")).toBe(true);
    expect(s!.imageId).toContain("12");
  });

  test("a route without anything to show is dropped", () => {
    expect(signsForRoutes([base({})], 1)).toEqual([]);
  });

  test("the size factor scales the box", () => {
    const [a] = signsForRoutes([base({ osmc: "red:white:red_bar" })], 1);
    const [b] = signsForRoutes([base({ osmc: "red:white:red_bar" })], SMALL_SCALE_FACTOR);
    expect(b!.widthMm).toBeCloseTo(a!.widthMm * SMALL_SCALE_FACTOR, 9);
    expect(b!.heightMm).toBeCloseTo(a!.heightMm * SMALL_SCALE_FACTOR, 9);
    expect(a!.heightMm).toBeGreaterThan(3);
  });
});
