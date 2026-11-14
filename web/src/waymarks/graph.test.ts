import { describe, expect, test } from "bun:test";
import { buildEdges, type Piece } from "./graph";

const piece = (keys: string[], ...coords: [number, number][]): Piece => ({ keys, coords });
const keysOf = (e: { parts: { keys: string[] }[] }) => e.parts.map((p) => p.keys.join(","));

describe("buildEdges", () => {
  test("fork (Y): three edges meeting in one node, fork id only on the fork side", () => {
    const out = buildEdges([
      piece(["A", "B"], [0, 0], [1000, 0]),
      piece(["A"], [1000, 0], [2000, 500]),
      piece(["B"], [1000, 0], [2000, -500]),
    ]);
    expect(out).toHaveLength(3);
    for (const e of out) {
      const ends = [e.coords[0]!, e.coords.at(-1)!];
      expect(ends.some((p) => p[0] === 1000 && p[1] === 0)).toBe(true);
      expect(e.ring).toBe(false);
      // Normalised direction: the smaller end first; the fork is at (1000, 0).
      const forkAtStart = e.coords[0]![0] === 1000;
      expect(forkAtStart ? e.start : e.end).toBe("1000,0");
      expect(forkAtStart ? e.end : e.start).toBeNull();
    }
  });

  test("pieces across a tile border form one edge", () => {
    const out = buildEdges([
      piece(["A"], [0, 0], [4096, 100]),
      piece(["A"], [4097, 101], [8000, 200]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.coords[0]).toEqual([0, 0]);
    expect(out[0]!.coords.at(-1)).toEqual([8000, 200]);
    expect(out[0]!.coords).toHaveLength(3);
    expect(out[0]!.parts).toHaveLength(1);
  });

  test("T junction without shared vertex splits the through route", () => {
    const out = buildEdges([piece(["A"], [0, 0], [2000, 0]), piece(["B"], [1000, 1], [1000, 800])]);
    expect(out).toHaveLength(3);
    const a = out.filter((e) => keysOf(e)[0] === "A");
    expect(a).toHaveLength(2);
    for (const e of a) {
      const mid = [e.coords[0]!, e.coords.at(-1)!].find((p) => p[0] === 1000)!;
      expect(mid).toBeDefined();
      expect(Math.abs(mid[0] - 1000)).toBeLessThan(1);
    }
    expect(out.filter((e) => keysOf(e)[0] === "B")).toHaveLength(1);
  });

  test("route change without branch is no fork: one edge with two parts", () => {
    const out = buildEdges([
      piece(["a", "b"], [0, 0], [1000, 0]),
      piece(["a"], [1000, 0], [2000, 0]),
    ]);
    expect(out).toHaveLength(1);
    const e = out[0]!;
    expect(keysOf(e)).toEqual(["a,b", "a"]);
    expect(e.parts.map((p) => p.end)).toEqual([1, 2]);
    expect(e.start).toBeNull();
    expect(e.end).toBeNull();
  });

  test("false fork through the same sign: one edge, three parts, no node", () => {
    const out = buildEdges([
      piece(["a"], [0, 0], [1000, 0]),
      piece(["a"], [1000, 0], [2000, 0]),
      piece(["a", "b"], [2000, 0], [3000, 0]),
      piece(["a"], [3000, 0], [4000, 0]),
    ]);
    expect(out).toHaveLength(1);
    const e = out[0]!;
    expect(keysOf(e)).toEqual(["a", "a,b", "a"]);
    expect(e.parts.map((p) => p.end)).toEqual([2, 3, 4]);
    expect(e.start).toBeNull();
    expect(e.end).toBeNull();
  });

  test("a loop of four pieces is one ring starting at its smallest node", () => {
    const out = buildEdges([
      piece(["A"], [0, 0], [1000, 0]),
      piece(["A"], [1000, 1000], [1000, 0]),
      piece(["A"], [1000, 1000], [0, 1000]),
      piece(["A"], [0, 0], [0, 1000]),
    ]);
    expect(out).toHaveLength(1);
    const e = out[0]!;
    expect(e.ring).toBe(true);
    expect(e.coords[0]).toEqual([0, 0]);
    expect(e.coords.at(-1)).toEqual([0, 0]);
    expect(e.coords).toHaveLength(5);
    expect(e.parts).toHaveLength(1);
    expect(e.start).toBeNull();
    expect(e.end).toBeNull();
  });

  test("ring with a changing sign set starts at the smallest change node", () => {
    const out = buildEdges([
      piece(["a"], [0, 0], [1000, 0]),
      piece(["a"], [1000, 0], [1000, 1000]),
      piece(["a", "b"], [1000, 1000], [0, 1000]),
      piece(["a", "b"], [0, 1000], [0, 0]),
    ]);
    expect(out).toHaveLength(1);
    const e = out[0]!;
    expect(e.ring).toBe(true);
    // Change nodes: (1000, 1000) and (0, 0); the smaller one is (0, 0).
    expect(e.coords[0]).toEqual([0, 0]);
    expect(e.coords.at(-1)).toEqual([0, 0]);
    expect(e.parts).toHaveLength(2);
    expect(keysOf(e).sort()).toEqual(["a", "a,b"]);
  });

  test("shared edge with three routes: five edges, keys sorted", () => {
    const out = buildEdges([
      piece(["C", "A", "B"], [1000, 0], [2000, 0]),
      piece(["A"], [0, 300], [1000, 0]),
      piece(["C", "B"], [0, -300], [1000, 0]),
      piece(["B", "A"], [2000, 0], [3000, 300]),
      piece(["C"], [2000, 0], [3000, -300]),
    ]);
    expect(out).toHaveLength(5);
    const mid = out.find((e) => e.parts[0]!.keys.length === 3)!;
    expect(mid.parts[0]!.keys).toEqual(["A", "B", "C"]);
    expect(mid.start).not.toBeNull();
    expect(mid.end).not.toBeNull();
  });

  test("stub on a straight edge is dropped, a longer branch makes a fork", () => {
    const base = piece(["a"], [0, 0], [2000, 0]);
    const short = buildEdges([base, piece(["a"], [1000, 0], [1000, 6])]);
    expect(short).toHaveLength(1);
    expect(short[0]!.coords[0]).toEqual([0, 0]);
    expect(short[0]!.coords.at(-1)).toEqual([2000, 0]);
    expect(short[0]!.start).toBeNull();
    expect(short[0]!.end).toBeNull();
    const long = buildEdges([base, piece(["a"], [1000, 0], [1000, 40])]);
    expect(long).toHaveLength(3);
  });

  test("lollipop: a loop on a fork starts and ends at the same node, no ring", () => {
    const out = buildEdges([
      piece(["a"], [0, 0], [1000, 0]),
      piece(["a"], [1000, 0], [1500, 300], [1500, -300], [1000, 0]),
      piece(["a"], [1000, 0], [1000, 800]),
    ]);
    expect(out).toHaveLength(3);
    const loop = out.find((e) => e.start !== null && e.start === e.end)!;
    expect(loop).toBeDefined();
    expect(loop.ring).toBe(false);
    expect(loop.start).toBe("1000,0");
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
    const reference = JSON.stringify(buildEdges(pieces));
    const permuted = [
      pieces[4]!,
      pieces[1]!,
      pieces[6]!,
      pieces[0]!,
      pieces[3]!,
      pieces[2]!,
      pieces[5]!,
    ].map((p, i) => (i % 2 === 0 ? { ...p, coords: [...p.coords].reverse() } : p));
    expect(JSON.stringify(buildEdges(permuted))).toBe(reference);
    expect(JSON.parse(reference).length).toBeGreaterThan(4);
  });

  test("direction flip keeps parts, ends and node ids consistent", () => {
    const pieces = [
      piece(["a", "b"], [0, 0], [1000, 0]),
      piece(["a"], [1000, 0], [2000, 0]),
      piece(["a"], [2000, 0], [3000, 400]),
      piece(["a"], [2000, 0], [3000, -400]),
    ];
    const flipped = pieces.map((p) => ({ ...p, coords: [...p.coords].reverse() }));
    expect(JSON.stringify(buildEdges(flipped))).toBe(JSON.stringify(buildEdges(pieces)));
    const e = buildEdges(pieces).find((x) => x.parts.length === 2)!;
    expect(e.start).toBeNull();
    expect(e.end).toBe("2000,0");
    expect(e.parts.map((p) => p.end)).toEqual([1, 2]);
  });

  test("degenerate input is ignored", () => {
    expect(buildEdges([])).toEqual([]);
    expect(buildEdges([piece([], [0, 0], [10, 10]), piece(["A"], [5, 5])])).toEqual([]);
  });
});
