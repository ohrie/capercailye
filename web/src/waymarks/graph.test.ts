import { describe, expect, test } from "bun:test";
import { buildStretches, type Piece } from "./graph";

const piece = (routes: string[], ...coords: [number, number][]): Piece => ({ routes, coords });

describe("buildStretches", () => {
  test("fork (Y): three stretches meeting in one node", () => {
    const out = buildStretches([
      piece(["A", "B"], [0, 0], [1000, 0]),
      piece(["A"], [1000, 0], [2000, 500]),
      piece(["B"], [1000, 0], [2000, -500]),
    ]);
    expect(out).toHaveLength(3);
    for (const s of out) {
      const ends = [s.coords[0]!, s.coords.at(-1)!];
      expect(ends.some((p) => p[0] === 1000 && p[1] === 0)).toBe(true);
      expect(s.ring).toBe(false);
    }
  });

  test("pieces across a tile border form one stretch", () => {
    const out = buildStretches([
      piece(["A"], [0, 0], [4096, 100]),
      piece(["A"], [4097, 101], [8000, 200]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.coords[0]).toEqual([0, 0]);
    expect(out[0]!.coords.at(-1)).toEqual([8000, 200]);
    expect(out[0]!.coords).toHaveLength(3);
  });

  test("T junction without shared vertex splits the through route", () => {
    const out = buildStretches([
      piece(["A"], [0, 0], [2000, 0]),
      piece(["B"], [1000, 1], [1000, 800]),
    ]);
    expect(out).toHaveLength(3);
    const a = out.filter((s) => s.routes[0] === "A");
    expect(a).toHaveLength(2);
    for (const s of a) {
      const mid = [s.coords[0]!, s.coords.at(-1)!].find((p) => p[0] === 1000)!;
      expect(mid).toBeDefined();
      expect(Math.abs(mid[0] - 1000)).toBeLessThan(1);
    }
    expect(out.filter((s) => s.routes[0] === "B")).toHaveLength(1);
  });

  test("route change without branch splits into two stretches", () => {
    const out = buildStretches([
      piece(["A", "B"], [0, 0], [1000, 0]),
      piece(["A"], [1000, 0], [2000, 0]),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.routes.join(",")).sort()).toEqual(["A", "A,B"]);
  });

  test("a loop of four pieces is one ring starting at its smallest node", () => {
    const out = buildStretches([
      piece(["A"], [0, 0], [1000, 0]),
      piece(["A"], [1000, 1000], [1000, 0]),
      piece(["A"], [1000, 1000], [0, 1000]),
      piece(["A"], [0, 0], [0, 1000]),
    ]);
    expect(out).toHaveLength(1);
    const s = out[0]!;
    expect(s.ring).toBe(true);
    expect(s.coords[0]).toEqual([0, 0]);
    expect(s.coords.at(-1)).toEqual([0, 0]);
    expect(s.coords).toHaveLength(5);
  });

  test("shared stretch with three routes: five stretches, routes keep their order", () => {
    const out = buildStretches([
      piece(["A", "B", "C"], [1000, 0], [2000, 0]),
      piece(["A"], [0, 300], [1000, 0]),
      piece(["B", "C"], [0, -300], [1000, 0]),
      piece(["A", "B"], [2000, 0], [3000, 300]),
      piece(["C"], [2000, 0], [3000, -300]),
    ]);
    expect(out).toHaveLength(5);
    const mid = out.find((s) => s.routes.length === 3)!;
    expect(mid.routes).toEqual(["A", "B", "C"]);
  });

  test("result does not depend on input order or piece direction", () => {
    const pieces = [
      piece(["A", "B"], [0, 0], [500, 20], [1000, 0]),
      piece(["A"], [1000, 0], [2000, 500]),
      piece(["B"], [1000, 0], [2000, -500]),
      piece(["A"], [2000, 500], [4096, 500]),
      piece(["A"], [4098, 501], [6000, 600]),
      piece(["C"], [3000, 500], [3000, 900]),
      piece(["D"], [100, 100], [100, 400], [400, 400], [100, 100]),
    ];
    const reference = JSON.stringify(buildStretches(pieces));
    const permuted = [
      pieces[4]!,
      pieces[1]!,
      pieces[6]!,
      pieces[0]!,
      pieces[3]!,
      pieces[2]!,
      pieces[5]!,
    ].map((p, i) => (i % 2 === 0 ? { ...p, coords: [...p.coords].reverse() } : p));
    expect(JSON.stringify(buildStretches(permuted))).toBe(reference);
    expect(JSON.parse(reference).length).toBeGreaterThan(4);
  });

  test("degenerate input is ignored", () => {
    expect(buildStretches([])).toEqual([]);
    expect(buildStretches([piece([], [0, 0], [10, 10]), piece(["A"], [5, 5])])).toEqual([]);
  });
});
