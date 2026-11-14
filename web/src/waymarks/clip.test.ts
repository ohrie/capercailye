import { describe, expect, test } from "bun:test";
import { clipLineToTile, TILE_EXTENT } from "./clip";

describe("clipLineToTile", () => {
  test("a line completely inside stays as it is", () => {
    const line: [number, number][] = [
      [10, 10],
      [500, 800],
      [4000, 4000],
    ];
    expect(clipLineToTile(line)).toEqual([line]);
  });

  test("a line across the border ends exactly on it", () => {
    const parts = clipLineToTile([
      [4000, 100],
      [4196, 100],
    ]);
    expect(parts).toEqual([
      [
        [4000, 100],
        [TILE_EXTENT, 100],
      ],
    ]);
    const diagonal = clipLineToTile([
      [4000, 4000],
      [4300, 4100],
      [4400, 5000],
    ]);
    expect(diagonal).toHaveLength(1);
    const end = diagonal[0]!.at(-1)!;
    expect(end[0]).toBe(TILE_EXTENT);
    expect(end[1]).toBeCloseTo(4000 + (96 / 300) * 100, 6);
  });

  test("a line that leaves and re-enters gives two parts", () => {
    const parts = clipLineToTile([
      [100, 100],
      [-100, 200],
      [-100, 400],
      [100, 500],
      [300, 500],
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0]![0]).toEqual([100, 100]);
    expect(parts[0]!.at(-1)![0]).toBe(0);
    expect(parts[1]![0]![0]).toBe(0);
    expect(parts[1]!.at(-1)).toEqual([300, 500]);
  });

  test("a line completely outside gives nothing", () => {
    expect(
      clipLineToTile([
        [-50, -50],
        [-10, 5000],
      ]),
    ).toEqual([]);
    expect(
      clipLineToTile([
        [5000, 0],
        [6000, 100],
      ]),
    ).toEqual([]);
  });

  test("points on the border count as inside, duplicates are removed", () => {
    const parts = clipLineToTile([
      [0, 0],
      [0, 0],
      [4096, 0],
      [4096, 4096],
    ]);
    expect(parts).toEqual([
      [
        [0, 0],
        [4096, 0],
        [4096, 4096],
      ],
    ]);
  });
});
