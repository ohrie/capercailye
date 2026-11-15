import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { PbfWriter } from "pbf";
import type { PMTiles } from "pmtiles";
import { inRect, lngLatToMm } from "../placement/geo";
import { computeWaymarks, waymarkKey } from "./index";
import {
  clearTileCache,
  decodeTile,
  loadRegionData,
  MAX_WAYMARK_TILES,
  regionTiles,
  registerArchive,
} from "./tiles";

// Minimal vector tile encoder (MVT 2.1) for the test: layers with line/point features.
interface TestFeature {
  id?: number;
  type: 1 | 2;
  /** Tile coordinates; lines as one polyline. */
  coords: [number, number][];
  props: Record<string, string | boolean | number>;
}

function encodeTile(layers: Record<string, TestFeature[]>, extent = 4096): Uint8Array {
  const tile = new PbfWriter();
  for (const [name, features] of Object.entries(layers)) {
    tile.writeMessage(
      3,
      (_: unknown, pbf) => {
        pbf.writeVarintField(15, 2);
        pbf.writeStringField(1, name);
        const keys: string[] = [];
        const values: (string | boolean | number)[] = [];
        for (const f of features) {
          pbf.writeMessage(
            2,
            (_f: unknown, fp) => {
              if (f.id !== undefined) fp.writeVarintField(1, f.id);
              const tags: number[] = [];
              for (const [k, v] of Object.entries(f.props)) {
                let ki = keys.indexOf(k);
                if (ki < 0) ki = keys.push(k) - 1;
                let vi = values.findIndex((x) => x === v);
                if (vi < 0) vi = values.push(v) - 1;
                tags.push(ki, vi);
              }
              fp.writePackedVarint(2, tags);
              fp.writeVarintField(3, f.type);
              const g: number[] = [];
              let cx = 0;
              let cy = 0;
              const zig = (n: number) => (n << 1) ^ (n >> 31);
              f.coords.forEach(([x, y], i) => {
                if (i === 0) g.push((1 << 3) | 1);
                else if (i === 1 && f.type === 2) g.push(((f.coords.length - 1) << 3) | 2);
                g.push(zig(x - cx), zig(y - cy));
                cx = x;
                cy = y;
              });
              fp.writePackedVarint(4, g);
            },
            null,
          );
        }
        keys.forEach((k) => pbf.writeStringField(3, k));
        for (const v of values) {
          pbf.writeMessage(
            4,
            (_v: unknown, vp) => {
              if (typeof v === "string") vp.writeStringField(1, v);
              else if (typeof v === "boolean") vp.writeBooleanField(7, v);
              else vp.writeVarintField(5, v);
            },
            null,
          );
        }
        pbf.writeVarintField(5, extent);
      },
      null,
    );
  }
  return tile.finish();
}

const route = (extra: Record<string, string> = {}) => ({
  ids: "1|2",
  networks: "rwn|lwn",
  symbols: "red:white:red_bar|",
  refs: "|",
  names: "|",
  colours: "|",
  network: "rwn",
  ...extra,
});

describe("decodeTile", () => {
  test("clips routes to the tile, converts to global units, reads the urban points of all thinning groups", () => {
    const bytes = encodeTile({
      routes: [
        {
          type: 2,
          coords: [
            [-100, 100],
            [4200, 100],
          ],
          props: route(),
        },
      ],
      poi: [
        {
          id: 7,
          type: 1,
          coords: [[10, 20]],
          props: { kind: "restaurant", urban: true, weight: 3, tags: 5 },
        },
        { id: 8, type: 1, coords: [[10, 20]], props: { kind: "restaurant", weight: 3 } },
        { id: 9, type: 1, coords: [[10, 20]], props: { kind: "bench", urban: true } },
        { id: 10, type: 1, coords: [[30, 40]], props: { kind: "toilets", urban: true, weight: 2 } },
        { id: 11, type: 1, coords: [[50, 60]], props: { kind: "hotel", urban: true, tags: 4 } },
        { id: 12, type: 1, coords: [[50, 60]], props: { kind: "toilets", weight: 1 } },
      ],
    });
    const t = decodeTile(bytes, 2, 3);
    expect(t.pieces).toHaveLength(1);
    expect(t.pieces[0]!.coords).toEqual([
      [2 * 4096, 3 * 4096 + 100],
      [3 * 4096, 3 * 4096 + 100],
    ]);
    expect(t.pieces[0]!.routes.map((r) => [r.id, r.network, r.osmc])).toEqual([
      ["1", "rwn", "red:white:red_bar"],
      ["2", "lwn", undefined],
    ]);
    expect(t.urban).toEqual([
      { id: "7", group: "gastro", gx: 2 * 4096 + 10, gy: 3 * 4096 + 20, weight: 3, tags: 5 },
      { id: "10", group: "toilets", gx: 2 * 4096 + 30, gy: 3 * 4096 + 40, weight: 2, tags: 0 },
      { id: "11", group: "hotel", gx: 2 * 4096 + 50, gy: 3 * 4096 + 60, weight: 0, tags: 4 },
    ]);
  });

  test("a tile with a different extent is scaled to 4096", () => {
    const bytes = encodeTile(
      {
        routes: [
          {
            type: 2,
            coords: [
              [0, 512],
              [1024, 512],
            ],
            props: route(),
          },
        ],
      },
      1024,
    );
    expect(decodeTile(bytes, 0, 0).pieces[0]!.coords).toEqual([
      [0, 2048],
      [4096, 2048],
    ]);
  });
});

// A fake archive: every tile of the test region holds one horizontal line across it.
const URL = "test://waymarks.pmtiles";
const zoom = 12.95;
const [cx, cy] = lngLatToMm(8.7, 48.9, zoom);
const region = { minX: cx - 90, minY: cy - 130, maxX: cx + 90, maxY: cy + 130 };
let requested = 0;

function install(): void {
  registerArchive(URL, {
    getZxy: async (_z: number, x: number, y: number) => {
      requested++;
      const data = encodeTile({
        routes: [
          {
            type: 2,
            coords: [
              [-50, 2048],
              [4146, 2048],
            ],
            props: route(),
          },
        ],
        // 4 x 4 urban cafés per tile (about 64 mm apart), ids from the tile index.
        poi: Array.from({ length: 16 }, (_, k) => ({
          id: (x * 10000 + y) * 100 + k,
          type: 1 as const,
          coords: [[256 + (k % 4) * 1024, 256 + Math.floor(k / 4) * 1024]] as [number, number][],
          props: { kind: "cafe", urban: true, weight: 1, tags: 1 },
        })),
      });
      return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    },
  } as unknown as PMTiles);
}

afterEach(() => clearTileCache());

describe("loadRegionData", () => {
  test("reads the tiles of the region plus margin and filters routes by the switches", async () => {
    install();
    requested = 0;
    const tiles = regionTiles(region, zoom);
    expect(tiles.length).toBeGreaterThan(1);
    const all = await loadRegionData(URL, region, zoom, {});
    expect(requested).toBe(tiles.length);
    expect(all!.pieces.length).toBe(tiles.length);
    // By default every route shows its sign, the lwn route (id 2) included.
    expect([...all!.routes.keys()].sort()).toEqual(["1", "2"]);
    const noLokal = await loadRegionData(URL, region, zoom, { "net-lwn": false });
    expect([...noLokal!.routes.keys()]).toEqual(["1"]);
    expect(noLokal!.pieces.every((p) => p.routes.join() === "1")).toBe(true);
    const noRwn = await loadRegionData(URL, region, zoom, { "net-rwn": false });
    expect([...noRwn!.routes.keys()]).toEqual(["2"]);
    const none = await loadRegionData(URL, region, zoom, {
      "net-rwn": false,
      "net-lwn": false,
    });
    expect(none!.pieces).toHaveLength(0);
    // Decoded tiles are cached independently of the switches.
    expect(requested).toBe(tiles.length);
    // 16 urban points per tile.
    expect(all!.urban).toHaveLength(16 * tiles.length);
  });

  test('"Wanderrouten" off: no pieces and routes, but the urban points are still delivered', async () => {
    install();
    const tiles = regionTiles(region, zoom);
    const off = await loadRegionData(URL, region, zoom, { routes: false });
    expect(off!.pieces).toHaveLength(0);
    expect(off!.routes.size).toBe(0);
    expect(off!.urban).toHaveLength(16 * tiles.length);
    expect(off!.urban[0]!.group).toBe("gastro");
  });

  test("too many tiles: undefined", async () => {
    install();
    const huge = { minX: cx, minY: cy, maxX: cx + 40_000, maxY: cy + 40_000 };
    expect(regionTiles(huge, zoom).length).toBeGreaterThan(MAX_WAYMARK_TILES);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadRegionData(URL, huge, zoom, {})).toBeUndefined();
    warn.mockRestore();
  });
});

describe("computeWaymarks", () => {
  test("signs along the line, boxes inside the region, same result for the same key", async () => {
    install();
    const req = { pmtilesUrl: URL, region, zoom, visibility: {} };
    const a = await computeWaymarks(req);
    expect(a.data.features.length).toBeGreaterThan(2);
    expect(a.boxes).toHaveLength(a.data.features.length);
    for (const b of a.boxes) {
      expect(b.maxX).toBeGreaterThan(region.minX);
      expect(b.minX).toBeLessThan(region.maxX);
    }
    for (const f of a.data.features)
      expect(f.properties!["img"]).toBe("waymark:red:white:red_bar\u001f\u001f\u001f");
    // Cafés of different tiles are far apart (> 8 mm): all inside the margin region stay.
    expect(a.urban!.ids.size).toBeGreaterThan(1);
    expect(inRect(a.urban!.region, cx, cy)).toBe(true);
    expect(a.dropped).toBe(0);
    expect(await computeWaymarks({ ...req })).toBe(a);
    expect(a.key).toBe(waymarkKey(req));
  });

  test('"Wanderrouten" off: no signs, but the urban decision exists; below the print band: empty', async () => {
    install();
    const req = { pmtilesUrl: URL, region, zoom, visibility: {} };
    const off = await computeWaymarks({ ...req, visibility: { routes: false } });
    expect(off.data.features).toEqual([]);
    expect(off.boxes).toEqual([]);
    expect(off.urban!.ids.size).toBeGreaterThan(1);
    const low = await computeWaymarks({ ...req, zoom: 11 });
    expect(low.boxes).toEqual([]);
    expect(low.urban).toBeUndefined();
  });

  test("the key changes with the routes switch and every network switch, not with others", () => {
    const req = { pmtilesUrl: URL, region, zoom, visibility: {} };
    const keys = new Set([
      waymarkKey(req),
      waymarkKey({ ...req, visibility: { routes: false } }),
      waymarkKey({ ...req, visibility: { "net-iwn": false } }),
      waymarkKey({ ...req, visibility: { "net-nwn": false } }),
      waymarkKey({ ...req, visibility: { "net-rwn": false } }),
      waymarkKey({ ...req, visibility: { "net-lwn": false } }),
    ]);
    expect(keys.size).toBe(6);
    // Unrelated switches (also `waymarks`, which has no switch of its own) do not.
    expect(waymarkKey({ ...req, visibility: { hillshade: false } })).toBe(waymarkKey(req));
    expect(waymarkKey({ ...req, visibility: { waymarks: false } })).toBe(waymarkKey(req));
  });
});
