import { describe, expect, test } from "bun:test";
import {
  PLAN_DEFAULTS,
  planWaymarks,
  planWithStats,
  WAYMARK_SPACING_MM,
  type PlacedSign,
  type PlanEdge,
} from "./plan";
import type { SignSpec } from "./signs";

const sign = (key: string, w = 3.4, h = 3.4, rank = 2): SignSpec => ({
  key,
  imageId: `img-${key}`,
  widthMm: w,
  heightMm: h,
  rank,
});

/** Edge with one part. */
const edge = (
  id: string,
  signs: SignSpec[],
  start: string | null,
  end: string | null,
  ...coords: [number, number][]
): PlanEdge => ({
  id,
  coords,
  parts: [{ end: coords.length - 1, signs }],
  ring: false,
  start,
  end,
});

/** Edge with several parts: [end vertex index, signs]. */
const multi = (
  id: string,
  parts: [number, SignSpec[]][],
  start: string | null,
  end: string | null,
  ...coords: [number, number][]
): PlanEdge => ({
  id,
  coords,
  parts: parts.map(([e, signs]) => ({ end: e, signs })),
  ring: false,
  start,
  end,
});

type Box = PlacedSign["box"];
function overlaps(a: Box, b: Box, gap: number): boolean {
  return (
    a.minX < b.maxX + gap - 1e-9 &&
    b.minX < a.maxX + gap - 1e-9 &&
    a.minY < b.maxY + gap - 1e-9 &&
    b.minY < a.maxY + gap - 1e-9
  );
}

function noOverlap(placed: PlacedSign[]): void {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      expect(overlaps(placed[i]!.box, placed[j]!.box, PLAN_DEFAULTS.clearanceMm)).toBe(false);
    }
  }
}

/** Sorted arc lengths of a sign on an edge. */
const ts = (placed: PlacedSign[], edgeId: string, key: string): number[] =>
  placed
    .filter((p) => p.edgeId === edgeId && p.key === key)
    .map((p) => p.t)
    .sort((a, b) => a - b);

/** Distances of consecutive occurrences. */
const diffs = (v: number[]): number[] => v.slice(1).map((x, i) => x - v[i]!);

/** Distances of consecutive occurrences of a sign along a straight route (x), over all edges. */
const gaps = (placed: PlacedSign[], key: string): number[] =>
  diffs(
    placed
      .filter((p) => p.key === key)
      .map((p) => p.x)
      .sort((a, b) => a - b),
  );

const mandatoryOf = (placed: PlacedSign[], edgeId: string) =>
  placed.filter((p) => p.edgeId === edgeId && p.mandatory);

describe("planWaymarks", () => {
  test("exports the 6 cm spacing", () => {
    expect(WAYMARK_SPACING_MM).toBe(60);
    expect(PLAN_DEFAULTS.spacingMm).toBe(60);
  });

  test("straight 300 mm, one sign, dead ends: one mandatory in the middle, spread to both ends", () => {
    const placed = planWaymarks([edge("s", [sign("a")], null, null, [0, 0], [300, 0])]);
    const m = mandatoryOf(placed, "s");
    expect(m).toHaveLength(1);
    expect(m[0]!.t).toBeCloseTo(150, 6);
    for (const g of gaps(placed, "a")) {
      expect(g).toBeGreaterThanOrEqual(25);
      expect(g).toBeLessThanOrEqual(60);
    }
    const t = ts(placed, "s", "a");
    expect(t[0]!).toBeLessThanOrEqual(32);
    expect(t.at(-1)!).toBeGreaterThanOrEqual(268);
    for (const v of t) {
      expect(v).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(v).toBeLessThanOrEqual(298 + 1e-9);
    }
    noOverlap(placed);
  });

  test("shared edge with three routes: signs take turns, no block, no sign in the fork gap", () => {
    const [a, b, c] = [sign("a"), sign("b"), sign("c")];
    const placed = planWaymarks([edge("s", [a, b, c], "N1", "N2", [0, 0], [160, 0])]);
    const m = mandatoryOf(placed, "s");
    expect(m.map((p) => [p.key, p.t])).toEqual([
      ["a", 32],
      ["b", 80],
      ["c", 128],
    ]);
    for (const k of ["a", "b", "c"]) {
      for (const g of diffs(ts(placed, "s", k))) expect(g).toBeGreaterThanOrEqual(25 - 1e-9);
      for (const g of gaps(placed, k)) expect(g).toBeLessThanOrEqual(60 + 1e-9);
    }
    for (const p of placed) {
      expect(p.t).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(p.t).toBeLessThanOrEqual(152 + 1e-9);
    }
    const seq = placed.map((p) => p.key);
    for (let i = 2; i < seq.length; i++) {
      expect(seq[i] === seq[i - 1] && seq[i] === seq[i - 2]).toBe(false);
    }
    noOverlap(placed);
  });

  test("route end without fork does not pile up signs", () => {
    const [a, b] = [sign("a"), sign("b")];
    const placed = planWaymarks([
      multi(
        "s",
        [
          [1, [a, b]],
          [2, [a]],
        ],
        null,
        null,
        [0, 0],
        [150, 0],
        [300, 0],
      ),
    ]);
    expect(placed.filter((p) => Math.abs(p.x - 150) <= 10).length).toBeLessThanOrEqual(2);
    for (const g of gaps(placed, "a")) {
      expect(g).toBeGreaterThanOrEqual(25);
      expect(g).toBeLessThanOrEqual(60);
    }
    for (const p of placed.filter((q) => q.key === "b")) expect(p.t).toBeLessThanOrEqual(148);
    noOverlap(placed);
  });

  test("two forks close together: nothing on the short edge or near the forks", () => {
    const A = sign("A");
    const placed = planWaymarks([
      edge("e1", [A], null, "F1", [0, 0], [100, 0]),
      edge("e2", [A], "F1", "F2", [100, 0], [110, 0]),
      edge("e3", [A], "F2", null, [110, 0], [300, 0]),
      edge("b", [sign("B")], "F1", null, [100, 0], [100, 80]),
      edge("c", [sign("C")], "F2", null, [110, 0], [110, -80]),
    ]);
    const as = placed.filter((p) => p.key === "A");
    expect(as.some((p) => p.edgeId === "e2")).toBe(false);
    for (const p of as) {
      expect(Math.abs(p.x - 100)).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(Math.abs(p.x - 110)).toBeGreaterThanOrEqual(8 - 1e-9);
    }
    for (const g of gaps(placed, "A")) {
      expect(g).toBeGreaterThanOrEqual(25 - 1e-9);
      expect(g).toBeLessThanOrEqual(68 + 1e-9);
    }
    expect(mandatoryOf(placed, "b")).toHaveLength(1);
    expect(mandatoryOf(placed, "c")).toHaveLength(1);
    noOverlap(placed);
  });

  test("a route over three edges keeps its spacing across the forks", () => {
    const A = sign("A");
    const placed = planWaymarks([
      edge("e1", [A], null, "F1", [0, 0], [100, 0]),
      edge("e2", [A], "F1", "F2", [100, 0], [140, 0]),
      edge("e3", [A], "F2", null, [140, 0], [300, 0]),
      edge("b", [sign("B")], "F1", null, [100, 0], [100, -80]),
      edge("c", [sign("C")], "F2", null, [140, 0], [140, 80]),
    ]);
    const m = ["e1", "e2", "e3"].map((id) => mandatoryOf(placed, id).filter((p) => p.key === "A"));
    for (const list of m) expect(list).toHaveLength(1);
    expect(m[0]![0]!.x).toBeCloseTo(47, 6);
    expect(m[1]![0]!.x).toBeCloseTo(120, 6);
    expect(m[2]![0]!.x).toBeCloseTo(223, 6);
    for (const g of gaps(placed, "A")) {
      expect(g).toBeGreaterThanOrEqual(25 - 1e-9);
      expect(g).toBeLessThanOrEqual(60 + 1e-9);
    }
    for (const p of placed.filter((q) => q.key === "A")) {
      expect(Math.abs(p.x - 100)).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(Math.abs(p.x - 140)).toBeGreaterThanOrEqual(8 - 1e-9);
    }
    noOverlap(placed);
  });

  test("edge below the minimum length gets no sign, the branches show it", () => {
    const a = sign("a");
    const r = 80 / Math.SQRT2;
    const input = [
      edge("short", [a], "L", "R", [0, 0], [20, 0]),
      edge("l1", [a], "L", null, [0, 0], [-r, r]),
      edge("l2", [a], "L", null, [0, 0], [-r, -r]),
      edge("r1", [a], "R", null, [20, 0], [20 + r, r]),
      edge("r2", [a], "R", null, [20, 0], [20 + r, -r]),
    ];
    const stats = planWithStats(input);
    expect(stats.signs.some((p) => p.edgeId === "short")).toBe(false);
    for (const id of ["l1", "l2", "r1", "r2"]) expect(mandatoryOf(stats.signs, id)).toHaveLength(1);
    expect(stats.short).toBeGreaterThan(0);
    noOverlap(stats.signs);
  });

  test("fork at 120 degrees: every branch shows its signs on the free stretch", () => {
    const A = sign("A");
    const B = sign("B");
    const dir = (deg: number): [number, number] => [
      100 * Math.cos((deg * Math.PI) / 180),
      100 * Math.sin((deg * Math.PI) / 180),
    ];
    const placed = planWaymarks([
      edge("trunk", [A, B], "F", null, [0, 0], dir(90)),
      edge("a", [A], "F", null, [0, 0], dir(210)),
      edge("b", [B], "F", null, [0, 0], dir(330)),
    ]);
    const has = (id: string, key: string) =>
      placed.some((p) => p.edgeId === id && p.key === key && p.mandatory);
    expect(has("a", "A")).toBe(true);
    expect(has("b", "B")).toBe(true);
    expect(has("trunk", "A")).toBe(true);
    expect(has("trunk", "B")).toBe(true);
    for (const p of placed) expect(p.t).toBeGreaterThanOrEqual(8 - 1e-9);
    noOverlap(placed);
  });

  test("ring: spacing 25 to 60 mm including across the start node", () => {
    const n = 8;
    const r = 150 / (2 * n * Math.sin(Math.PI / n));
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      pts.push([r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
    }
    const ring: PlanEdge = {
      id: "ring",
      coords: pts,
      parts: [{ end: n, signs: [sign("a")] }],
      ring: true,
      start: null,
      end: null,
    };
    const placed = planWaymarks([ring]);
    expect(mandatoryOf(placed, "ring")).toHaveLength(1);
    const t = ts(placed, "ring", "a");
    for (const g of [...diffs(t), t[0]! + 150 - t.at(-1)!]) {
      expect(g).toBeGreaterThanOrEqual(25 - 1e-6);
      expect(g).toBeLessThanOrEqual(60 + 1e-6);
    }
    noOverlap(placed);
  });

  test("ring with parts: b only in its half, a keeps its spacing across the start", () => {
    const n = 8;
    const r = 150 / (2 * n * Math.sin(Math.PI / n));
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      pts.push([r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
    }
    const ring: PlanEdge = {
      id: "ring",
      coords: pts,
      parts: [
        { end: 4, signs: [sign("a"), sign("b")] },
        { end: 8, signs: [sign("a")] },
      ],
      ring: true,
      start: null,
      end: null,
    };
    const placed = planWaymarks([ring]);
    const tb = ts(placed, "ring", "b");
    expect(tb.length).toBeGreaterThan(0);
    for (const t of tb) expect(t).toBeLessThanOrEqual(75 + 1e-6);
    const ta = ts(placed, "ring", "a");
    for (const g of [...diffs(ta), ta[0]! + 150 - ta.at(-1)!]) {
      expect(g).toBeGreaterThanOrEqual(25 - 1e-6);
      expect(g).toBeLessThanOrEqual(60 + 1e-6);
    }
    noOverlap(placed);
  });

  test("zigzag: spacing along the arc at most 60 mm, no overlap", () => {
    const pts: [number, number][] = [[0, 0]];
    for (let i = 0; i < 40; i++) {
      const a = ((i % 2 === 0 ? 60 : -60) * Math.PI) / 180;
      const [x, y] = pts.at(-1)!;
      pts.push([x + 10 * Math.cos(a), y + 10 * Math.sin(a)]);
    }
    const placed = planWaymarks([edge("z", [sign("a"), sign("b")], null, null, ...pts)]);
    for (const k of ["a", "b"]) {
      const v = ts(placed, "z", k);
      expect(v.length).toBeGreaterThan(2);
      for (const g of diffs(v)) expect(g).toBeLessThanOrEqual(60 + 1e-6);
    }
    noOverlap(placed);
  });

  test("collision: the higher network keeps its place, the lower one gives way", () => {
    const placed = planWaymarks([
      edge("lwn", [sign("l", 3.4, 3.4, 3)], null, null, [0, 2], [100, 2]),
      edge("rwn", [sign("r", 3.4, 3.4, 2)], null, null, [0, 0], [100, 0]),
    ]);
    const r = mandatoryOf(placed, "rwn");
    const l = mandatoryOf(placed, "lwn");
    expect(r).toHaveLength(1);
    expect(r[0]!.t).toBeCloseTo(50, 9);
    expect(l).toHaveLength(1);
    const shift = Math.abs(l[0]!.t - 50);
    expect(shift).toBeGreaterThanOrEqual(3.8 - 1e-9);
    expect(shift).toBeLessThanOrEqual(10 + 1e-9);
    noOverlap(placed);
  });

  test("collision: a mandatory sign beats a repeat of a higher network", () => {
    const rwn = edge("rwn", [sign("r", 3.4, 3.4, 2)], null, null, [0, 0], [300, 0]);
    const alone = planWaymarks([rwn]);
    const X = alone.filter((p) => !p.mandatory).sort((a, b) => a.t - b.t)[0]!.t;
    const lwn = edge("lwn", [sign("l", 3.4, 3.4, 3)], null, null, [X, -20], [X, 20]);
    const placed = planWaymarks([rwn, lwn]);
    const l = mandatoryOf(placed, "lwn");
    expect(l).toHaveLength(1);
    expect(l[0]!.t).toBeCloseTo(20, 9);
    expect(l[0]!.x).toBeCloseTo(X, 9);
    expect(placed.some((p) => p.edgeId === "rwn" && !p.mandatory && Math.abs(p.t - X) < 1e-9)).toBe(
      false,
    );
    for (const p of placed.filter(
      (q) => q.edgeId === "rwn" && !q.mandatory && Math.abs(q.t - X) <= 10,
    )) {
      expect(Math.abs(p.t - X)).toBeGreaterThan(0);
    }
    expect(mandatoryOf(placed, "rwn")).toHaveLength(1);
    noOverlap(placed);
  });

  test("deterministic: input order, edge direction", () => {
    const [a, b] = [sign("a"), sign("b", 3.4, 3.4, 3)];
    const input = [
      edge("s1", [a, b], "F", null, [0, 0], [100, 0]),
      edge("s2", [a], "F", null, [0, 0], [50, 50]),
      edge("s3", [b], "F", null, [0, 0], [0, 80]),
      multi(
        "s4",
        [
          [1, [a, b]],
          [2, [a]],
        ],
        null,
        "G",
        [0, 200],
        [150, 200],
        [300, 200],
      ),
      edge("s5", [b], "G", null, [300, 200], [300, 280]),
    ];
    const norm = (p: PlacedSign[]) =>
      p
        .map((q) => `${q.key}@${q.x.toFixed(6)},${q.y.toFixed(6)}`)
        .sort()
        .join("|");
    const ref = JSON.stringify(planWaymarks(input));
    const permuted = [input[2]!, input[4]!, input[0]!, input[3]!, input[1]!];
    expect(JSON.stringify(planWaymarks(permuted))).toBe(ref);
    // s4 handed over the other way round: parts mirrored, start/end swapped.
    const flipped: PlanEdge = {
      id: "s4",
      coords: [
        [300, 200],
        [150, 200],
        [0, 200],
      ],
      parts: [
        { end: 1, signs: [a] },
        { end: 2, signs: [a, b] },
      ],
      ring: false,
      start: "G",
      end: null,
    };
    const other = planWaymarks([input[0]!, input[1]!, input[2]!, flipped, input[4]!]);
    expect(norm(other)).toBe(norm(planWaymarks(input)));
  });

  test("wide signs: the room test follows the half extent along the line", () => {
    const wide = [sign("a", 8, 3.4), sign("b", 8, 3.4), sign("c", 8, 3.4)];
    // Zone [8, 17] on a 25 mm edge between two forks.
    const horizontal = planWithStats([edge("h", wide, "F1", "F2", [0, 0], [25, 0])]);
    const vertical = planWithStats([edge("v", wide, "F1", "F2", [0, 0], [0, 25])]);
    expect(horizontal.mandatory.wanted).toBe(2);
    expect(vertical.mandatory.wanted).toBe(3);
    expect(horizontal.short).toBe(1);
    expect(vertical.short).toBe(0);
    noOverlap(horizontal.signs);
    noOverlap(vertical.signs);
  });
});
