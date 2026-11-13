import { describe, expect, test } from "bun:test";
import {
  type Box,
  PLACE_DEFAULTS,
  type PlaceItem,
  type Placement,
  placedBoxes,
  placeSymbols,
} from "./displace";

const square = (half: number): Box => ({ minX: -half, minY: -half, maxX: half, maxY: half });

function item(id: string, x: number, y: number, priority = 10, half = 1.7): PlaceItem {
  return { id, x, y, box: square(half), priority };
}

function absolute(items: PlaceItem[], placements: Placement[]) {
  return placedBoxes(items, placements);
}

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return (
    a.minX < b.maxX + gap - 1e-9 &&
    b.minX < a.maxX + gap - 1e-9 &&
    a.minY < b.maxY + gap - 1e-9 &&
    b.minY < a.maxY + gap - 1e-9
  );
}

const byId = (ps: Placement[]) => new Map(ps.map((p) => [p.id, p]));

describe("placeSymbols", () => {
  test("isolated symbols stay at their true location, without leader", () => {
    const items = [item("a", 0, 0), item("b", 10, 0), item("c", 0, 10)];
    const out = placeSymbols(items);
    expect(out).toHaveLength(3);
    for (const p of out) {
      expect(p.dx).toBe(0);
      expect(p.dy).toBe(0);
      expect(p.leader).toBeUndefined();
      expect(p.overlapping).toBe(false);
    }
  });

  test("the more important symbol stays, the less important one gives way", () => {
    const items = [item("minor", 1, 0, 50), item("major", 0, 0, 10)];
    const p = byId(placeSymbols(items));
    expect(p.get("major")).toMatchObject({ dx: 0, dy: 0 });
    const minor = p.get("minor")!;
    // Pushed away from the blocker (to the right), by no more than needed + one step.
    expect(minor.dx).toBeGreaterThan(0);
    expect(Math.hypot(minor.dx, minor.dy)).toBeLessThanOrEqual(
      3.4 - 1 + PLACE_DEFAULTS.gapMm + PLACE_DEFAULTS.stepMm + 1e-9,
    );
    const [a, b] = absolute(items, placeSymbols(items));
    expect(overlaps(a!, b!, PLACE_DEFAULTS.gapMm)).toBe(false);
  });

  test("no symbol is ever dropped, and no shift exceeds the limit", () => {
    // 40 boxes on one spot: far beyond what fits into a 4 mm radius.
    const items = Array.from({ length: 40 }, (_, i) => item(`p${i}`, (i % 3) * 0.1, 0, 30));
    const out = placeSymbols(items);
    expect(out).toHaveLength(40);
    expect(new Set(out.map((p) => p.id)).size).toBe(40);
    for (const p of out) {
      expect(Math.hypot(p.dx, p.dy)).toBeLessThanOrEqual(PLACE_DEFAULTS.maxShiftMm + 1e-5);
    }
    expect(out.some((p) => p.overlapping)).toBe(true);
  });

  test("a small cluster is resolved without overlaps", () => {
    const items = [
      item("a", 0, 0, 10),
      item("b", 0.5, 0.2, 20),
      item("c", -0.4, 0.3, 30),
      item("d", 0.2, -0.5, 40),
      item("e", 0, 0, 50, 0.9),
    ];
    const out = placeSymbols(items);
    expect(out.every((p) => !p.overlapping)).toBe(true);
    const boxes = absolute(items, out);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]!, boxes[j]!), `${i}/${j}`).toBe(false);
      }
    }
  });

  test("deterministic: independent of input order", () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      item(`k${i}`, Math.sin(i) * 3, Math.cos(i * 1.7) * 3, 10 + (i % 4) * 10),
    );
    const sorted = (ps: Placement[]) => [...ps].sort((a, b) => a.id.localeCompare(b.id));
    const a = sorted(placeSymbols(items));
    const b = sorted(placeSymbols([...items].reverse()));
    const c = sorted(placeSymbols([...items.slice(10), ...items.slice(0, 10)]));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  test("equal priority: ties are broken by id", () => {
    const p = byId(placeSymbols([item("b", 0.3, 0), item("a", 0, 0)]));
    expect(p.get("a")).toMatchObject({ dx: 0, dy: 0 });
    expect(Math.hypot(p.get("b")!.dx, p.get("b")!.dy)).toBeGreaterThan(0);
  });

  test("leader from the true location to the box once the box has left it", () => {
    const items = [item("big", 0, 0, 10, 2), item("small", 0, 0, 20, 0.5)];
    const small = byId(placeSymbols(items)).get("small")!;
    expect(small.leader).toBeDefined();
    const box = absolute(items, placeSymbols(items))[1]!;
    const { x, y } = small.leader!;
    // On the box boundary, at least leaderGap away from the true location.
    expect(x).toBeGreaterThanOrEqual(box.minX - 1e-9);
    expect(x).toBeLessThanOrEqual(box.maxX + 1e-9);
    expect(y).toBeGreaterThanOrEqual(box.minY - 1e-9);
    expect(y).toBeLessThanOrEqual(box.maxY + 1e-9);
    expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(PLACE_DEFAULTS.leaderGapMm);
  });

  test("small shifts that keep the true location under the symbol get no leader", () => {
    const items = [item("a", 0, 0, 10), item("b", 3, 0, 20)];
    const b = byId(placeSymbols(items)).get("b")!;
    expect(b.dx).toBeGreaterThan(0);
    expect(b.leader).toBeUndefined();
  });

  test("fixed items never move and are placed first", () => {
    const peak: PlaceItem = { ...item("peak", 0, 0, 99, 0.5), fixed: true };
    const other: PlaceItem = { ...item("peak2", 0.2, 0, 99, 0.5), fixed: true };
    const icon = item("icon", 0, 0, 1);
    const p = byId(placeSymbols([icon, peak, other]));
    expect(p.get("peak")).toMatchObject({ dx: 0, dy: 0 });
    expect(p.get("peak2")).toMatchObject({ dx: 0, dy: 0 });
    expect(Math.hypot(p.get("icon")!.dx, p.get("icon")!.dy)).toBeGreaterThan(0);
  });

  test("obstacles from a previous pass are avoided", () => {
    const out = placeSymbols([item("a", 0, 0)], {
      obstacles: [{ minX: -1, minY: -1, maxX: 1, maxY: 1 }],
    });
    expect(Math.hypot(out[0]!.dx, out[0]!.dy)).toBeGreaterThan(2.5);
    expect(out[0]!.overlapping).toBe(false);
  });

  test("options: a smaller limit is respected", () => {
    const items = [item("a", 0, 0, 1), item("b", 0, 0, 2)];
    const out = placeSymbols(items, { maxShiftMm: 1 });
    const b = byId(out).get("b")!;
    expect(Math.hypot(b.dx, b.dy)).toBeLessThanOrEqual(1 + 1e-5);
    expect(b.overlapping).toBe(true);
  });
});
