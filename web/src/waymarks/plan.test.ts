import { describe, expect, test } from "bun:test";
import { PLAN_DEFAULTS, planWaymarks, type PlacedSign, type PlanStretch } from "./plan";
import type { SignSpec } from "./signs";

const sign = (key: string, w = 3.4, h = 3.4, rank = 2): SignSpec => ({
  key,
  imageId: `img-${key}`,
  widthMm: w,
  heightMm: h,
  rank,
});

const line = (id: string, signs: SignSpec[], ...coords: [number, number][]): PlanStretch => ({
  id,
  coords,
  signs,
  ring: false,
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

/** Largest distance between consecutive occurrences of a sign on a stretch (arc length). */
function maxGap(placed: PlacedSign[], stretchId: string, key: string): number {
  const ts = placed
    .filter((p) => p.stretchId === stretchId && p.key === key)
    .map((p) => p.t)
    .sort((a, b) => a - b);
  if (ts.length === 0) return Infinity;
  let gap = 0;
  for (let i = 1; i < ts.length; i++) gap = Math.max(gap, ts[i]! - ts[i - 1]!);
  return gap;
}

describe("planWaymarks", () => {
  test("straight line, one sign: near both ends, spacing at most 60 mm", () => {
    const placed = planWaymarks([line("s", [sign("a")], [0, 0], [300, 0])]);
    const ts = placed.map((p) => p.t);
    expect(ts[0]).toBeCloseTo(1.5 + 1.7, 6);
    expect(ts.at(-1)).toBeCloseTo(300 - 3.2, 6);
    expect(maxGap(placed, "s", "a")).toBeLessThanOrEqual(60);
    expect(placed.filter((p) => p.end)).toHaveLength(2);
    noOverlap(placed);
  });

  test("shared stretch with three signs: end blocks and round-robin inside", () => {
    const signs = [sign("a"), sign("b"), sign("c")];
    const placed = planWaymarks([line("s", signs, [0, 0], [200, 0])]);
    const start = placed.filter((p) => p.end && p.t < 100);
    const end = placed.filter((p) => p.end && p.t > 100);
    expect(start.map((p) => p.key)).toEqual(["a", "b", "c"]);
    expect(end.map((p) => p.key)).toEqual(["c", "b", "a"]);
    const inner = placed.filter((p) => !p.end);
    expect(inner.length).toBeGreaterThan(0);
    inner.forEach((p, i) => expect(p.key).toBe(["a", "b", "c"][i % 3]!));
    for (const k of ["a", "b", "c"]) expect(maxGap(placed, "s", k)).toBeLessThanOrEqual(60);
    noOverlap(placed);
  });

  test("fork at 120 degrees: every branch shows its signs near the fork", () => {
    const A = sign("A");
    const B = sign("B");
    const dir = (deg: number): [number, number] => [
      100 * Math.cos((deg * Math.PI) / 180),
      100 * Math.sin((deg * Math.PI) / 180),
    ];
    const placed = planWaymarks([
      line("trunk", [A, B], [0, 0], dir(90)),
      line("a", [A], [0, 0], dir(210)),
      line("b", [B], [0, 0], dir(330)),
    ]);
    const near = (id: string, key: string) =>
      placed.some((p) => p.stretchId === id && p.key === key && p.t <= 10);
    expect(near("a", "A")).toBe(true);
    expect(near("b", "B")).toBe(true);
    expect(near("trunk", "A")).toBe(true);
    expect(near("trunk", "B")).toBe(true);
    noOverlap(placed);
  });

  test("short stretch between two forks gets no signs, long branches keep their blocks", () => {
    const two = [sign("a"), sign("b")];
    const placed = planWaymarks([
      line("short", two, [0, 0], [3, 0]),
      line("l1", two, [0, 0], [-56, 56]),
      line("l2", two, [0, 0], [-56, -56]),
      line("r1", two, [3, 0], [59, 56]),
      line("r2", two, [3, 0], [59, -56]),
    ]);
    expect(placed.filter((p) => p.stretchId === "short")).toHaveLength(0);
    for (const id of ["l1", "l2", "r1", "r2"]) {
      expect(placed.filter((p) => p.stretchId === id && p.end).length).toBeGreaterThanOrEqual(2);
    }
    noOverlap(placed);
  });

  test("short stretch that takes one sign at most as many as fit", () => {
    const placed = planWaymarks([line("s", [sign("a"), sign("b")], [0, 0], [6.5, 0])]);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.key).toBe("a");
    expect(placed[0]!.t).toBeCloseTo(3.25, 6);
  });

  test("ring: spacing at most 60 mm including across the start node", () => {
    const n = 8;
    const r = 150 / (2 * n * Math.sin(Math.PI / n));
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      pts.push([r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
    }
    const ring: PlanStretch = { id: "ring", coords: pts, signs: [sign("a")], ring: true };
    const placed = planWaymarks([ring]);
    const length = 150;
    const ts = placed.map((p) => p.t).sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeLessThanOrEqual(60);
    expect(ts[0]! + length - ts.at(-1)!).toBeLessThanOrEqual(60);
    noOverlap(placed);
  });

  test("zigzag: spacing along the arc at most 60 mm, no overlap", () => {
    const pts: [number, number][] = [[0, 0]];
    for (let i = 0; i < 40; i++) {
      const a = ((i % 2 === 0 ? 60 : -60) * Math.PI) / 180;
      const [x, y] = pts.at(-1)!;
      pts.push([x + 10 * Math.cos(a), y + 10 * Math.sin(a)]);
    }
    const placed = planWaymarks([line("z", [sign("a"), sign("b")], ...pts)]);
    for (const k of ["a", "b"]) expect(maxGap(placed, "z", k)).toBeLessThanOrEqual(60);
    noOverlap(placed);
  });

  test("precedence: the higher network keeps its place", () => {
    const placed = planWaymarks([
      line("lwn", [sign("l", 3.4, 3.4, 3)], [0, 2], [100, 2]),
      line("rwn", [sign("r", 3.4, 3.4, 2)], [0, 0], [100, 0]),
    ]);
    const r = placed.filter((p) => p.stretchId === "rwn" && p.end);
    expect(r).toHaveLength(2);
    expect(r[0]!.t).toBeCloseTo(3.2, 9);
    expect(r[1]!.t).toBeCloseTo(100 - 3.2, 9);
    noOverlap(placed);
  });

  test("deterministic regardless of input order", () => {
    const stretches = [
      line("s1", [sign("a"), sign("b")], [0, 0], [100, 0]),
      line("s2", [sign("a")], [0, 0], [50, 50]),
      line("s3", [sign("b", 3.4, 3.4, 3)], [0, 0], [0, 80]),
    ];
    const ref = JSON.stringify(planWaymarks(stretches));
    expect(JSON.stringify(planWaymarks([stretches[2]!, stretches[0]!, stretches[1]!]))).toBe(ref);
  });

  test("wide sign: block spacing follows the half extent along the line", () => {
    const wide = [sign("a", 8, 3.4), sign("b", 8, 3.4)];
    const horizontal = planWaymarks([line("h", wide, [0, 0], [100, 0])]).filter(
      (p) => p.end && p.t < 50,
    );
    expect(horizontal).toHaveLength(2);
    expect(horizontal[1]!.t - horizontal[0]!.t).toBeCloseTo(4 + PLAN_DEFAULTS.gapMm + 4, 6);
    const vertical = planWaymarks([line("v", wide, [0, 0], [0, 100])]).filter(
      (p) => p.end && p.t < 50,
    );
    expect(vertical).toHaveLength(2);
    expect(vertical[1]!.t - vertical[0]!.t).toBeCloseTo(1.7 + PLAN_DEFAULTS.gapMm + 1.7, 6);
  });
});
