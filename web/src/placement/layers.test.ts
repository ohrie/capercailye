import { describe, expect, test } from "bun:test";
import { type StyleSpecification, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import "../icons";
import { buildStyle, defaultVisibility } from "../style";
import { BUSSTOP_PRIORITY, busstopLayers, PRIORITY, poiLayers } from "../style/poi";
import {
  estimateTextBox,
  evaluateLayer,
  featureKey,
  placementData,
  type SourceFeature,
} from "./collect";
import { placeSymbols } from "./displace";
import { lngLatToMm, mmToLngLat } from "./geo";
import { managedLayers, PLACEMENT_SOURCE, withPlacementLayers } from "./layers";

const base = () =>
  buildStyle({
    pmtilesUrl: "https://example.invalid/x.pmtiles",
    busstopsUrl: "https://example.invalid/busstops.pmtiles",
    glyphsUrl: "https://example.invalid/{fontstack}/{range}.pbf",
    relief: { dem: "dem-shared://{z}/{x}/{y}", contours: "dem-contour://{z}/{x}/{y}?test" },
    visibility: defaultVisibility(),
  });

const vis = (style: StyleSpecification, id: string) =>
  (style.layers.find((l) => l.id === id)?.layout as { visibility?: string } | undefined)
    ?.visibility;

describe("withPlacementLayers", () => {
  for (const active of [false, true]) {
    test(`valid style (active = ${active})`, () => {
      const { style } = withPlacementLayers(base(), active);
      expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
      expect(style.sources[PLACEMENT_SOURCE]).toBeDefined();
    });
  }

  test("pictogram layers are displaced, peak dots and settlement names are fixed", () => {
    const managed = managedLayers(base().layers);
    const roles = Object.fromEntries(managed.map((m) => [m.id, m.role]));
    expect(roles["poi-main"]).toBe("displace");
    expect(roles["poi-minor"]).toBe("displace");
    expect(roles["busstops-main"]).toBe("displace");
    expect(roles["labels-peak-dot"]).toBe("fixed");
    expect(roles["labels-place-town"]).toBe("fixed");
    // Road numbers/names are labels: they may drop out.
    expect(roles["names-road-ref"]).toBeUndefined();
  });

  test("print mode hides the originals and shows the clones, screen mode the reverse", () => {
    const on = withPlacementLayers(base(), true).style;
    const off = withPlacementLayers(base(), false).style;
    expect(vis(on, "poi-main")).toBe("none");
    expect(vis(on, "placement-poi-main-icon")).toBe("visible");
    expect(vis(on, "placement-poi-main-name")).toBe("visible");
    expect(vis(off, "poi-main")).toBe("visible");
    expect(vis(off, "placement-poi-main-icon")).toBe("none");
  });

  test("clones never drop icons; names keep the original label priority", () => {
    const { style } = withPlacementLayers(base(), true);
    const ids = style.layers.map((l) => l.id);
    const icon = style.layers.find((l) => l.id === "placement-poi-main-icon")!;
    expect(icon.layout).toMatchObject({
      "icon-allow-overlap": true,
      "icon-ignore-placement": false,
    });
    expect((icon.layout as Record<string, unknown>)["text-field"]).toBeUndefined();
    const name = style.layers.find((l) => l.id === "placement-poi-main-name")!;
    expect((name.layout as Record<string, unknown>)["icon-image"]).toBeUndefined();
    expect(ids.indexOf("placement-poi-main-name")).toBe(ids.indexOf("poi-main") + 1);
    // Icons are placed (= sit above) after settlement names, before peak names and all others.
    const iconAt = ids.indexOf("placement-poi-main-icon");
    expect(iconAt).toBeLessThan(ids.indexOf("labels-place-hamlet"));
    expect(iconAt).toBeGreaterThan(ids.indexOf("labels-peak"));
    expect(ids.indexOf("placement-poi-main-leader")).toBeLessThan(iconAt);
  });

  test("bus stop clones read the bus stop source's features and get no name layer", () => {
    const { style } = withPlacementLayers(base(), true);
    expect(vis(style, "busstops-main")).toBe("none");
    expect(vis(style, "placement-busstops-main-icon")).toBe("visible");
    const ids = style.layers.map((l) => l.id);
    expect(ids).not.toContain("placement-busstops-main-name");
    // Above the pictograms: a stop is drawn over lower-priority icons it still overlaps.
    expect(ids.indexOf("busstops-main")).toBeGreaterThan(ids.indexOf("poi-main"));
    expect(ids.indexOf("placement-busstops-main-icon")).toBeGreaterThan(
      ids.indexOf("placement-poi-main-icon"),
    );
  });

  test("print mode keeps every source of a displaced layer loading (hidden originals load no tiles)", () => {
    const on = withPlacementLayers(base(), true).style;
    const off = withPlacementLayers(base(), false).style;
    for (const id of ["busstops-main", "poi-main", "poi-minor"]) {
      const orig = on.layers.find((l) => l.id === id) as { source: string; "source-layer": string };
      const keep = on.layers.find((l) => l.id === `placement-${id}-source`) as unknown as {
        type: string;
        source: string;
        "source-layer": string;
        paint: Record<string, number>;
      };
      expect(keep.type).toBe("circle");
      expect(keep.source).toBe(orig.source);
      expect(keep["source-layer"]).toBe(orig["source-layer"]);
      expect(keep.paint["circle-opacity"]).toBe(0);
      expect(vis(on, `placement-${id}-source`)).toBe("visible");
      expect(vis(off, `placement-${id}-source`)).toBe("none");
    }
    // Same toggle as the other clones: off with the group.
    const hidden = buildStyle({
      pmtilesUrl: "https://example.invalid/x.pmtiles",
      busstopsUrl: "https://example.invalid/busstops.pmtiles",
      glyphsUrl: "https://example.invalid/{fontstack}/{range}.pbf",
      relief: { dem: "dem-shared://{z}/{x}/{y}", contours: "dem-contour://{z}/{x}/{y}?test" },
      visibility: { ...defaultVisibility(), busstops: false },
    });
    expect(vis(withPlacementLayers(hidden, true).style, "placement-busstops-main-source")).toBe(
      "none",
    );
    const m = managedLayers(base().layers).find((x) => x.id === "busstops-main")!;
    expect(m.clones).toContain("placement-busstops-main-source");
  });

  test("a style without bus stop file has no bus stop clones", () => {
    const style = buildStyle({
      pmtilesUrl: "https://example.invalid/x.pmtiles",
      glyphsUrl: "https://example.invalid/{fontstack}/{range}.pbf",
      relief: { dem: "dem-shared://{z}/{x}/{y}", contours: "dem-contour://{z}/{x}/{y}?test" },
      visibility: defaultVisibility(),
    });
    const { style: out, managed } = withPlacementLayers(style, true);
    expect(managed.some((m) => m.id === "busstops-main")).toBe(false);
    expect(out.layers.some((l) => l.id.includes("busstops"))).toBe(false);
    expect(validateStyleMin(out).map((e) => e.message)).toEqual([]);
  });

  test("a style without managed layers is returned unchanged", () => {
    const style = { ...base(), layers: base().layers.filter((l) => !managedIds.has(l.id)) };
    expect(withPlacementLayers(style, true).style).toBe(style);
  });
});

const managedIds = new Set(managedLayers(base().layers).map((m) => m.id));

describe("evaluateLayer", () => {
  const [minor, main] = managedLayers(poiLayers());
  const f = (id: number, kind: string, props: Record<string, unknown> = {}): SourceFeature => ({
    id,
    properties: { kind, ...props },
    lngLat: [9.2, 48.18],
  });

  test("filters and minzoom match the style (1:25 000 vs 1:50 000)", () => {
    const feats = [f(1, "castle"), f(2, "wayside_cross"), f(3, "guidepost")];
    expect(evaluateLayer(main!, feats, 12.95).map((c) => c.feature.id)).toEqual([1]);
    expect(evaluateLayer(minor!, feats, 12.95).map((c) => c.feature.id)).toEqual([2, 3]);
    expect(evaluateLayer(minor!, feats, 11.95)).toEqual([]);
  });

  test("icon boxes follow image size, anchor and offset; priority is the sort key", () => {
    const [castle] = evaluateLayer(main!, [f(1, "castle", { name: "Burg" })], 12.95);
    expect(castle!.item.box.maxX - castle!.item.box.minX).toBeCloseTo(3.4, 5);
    expect(castle!.item.box.minX).toBeCloseTo(-1.7, 5);
    expect(castle!.item.priority).toBe(10);
    const [post] = evaluateLayer(main!, [f(2, "guidepost", { name: "Hadeck" })], 12.95);
    // Flag: pole foot on the point, so the box lies above and mostly right of it.
    expect(post!.item.box.maxY).toBeGreaterThan(0);
    expect(post!.item.box.maxY).toBeLessThan(0.5);
    expect(post!.item.box.minX).toBeLessThan(0);
    expect(post!.item.box.maxX).toBeGreaterThan(2);
  });

  test("placement data: displaced points, leaders and anchors on the true location", () => {
    const feats = [f(1, "castle"), f(2, "viewpoint")];
    const cands = evaluateLayer(main!, feats, 13);
    const placements = placeSymbols(cands.map((c) => c.item));
    const data = placementData(cands, placements, 13);
    const roles = data.features.map((x) => x.properties!._role);
    expect(roles.filter((r) => r === "symbol")).toHaveLength(2);
    expect(roles.filter((r) => r === "leader")).toHaveLength(1);
    const anchor = data.features.find((x) => x.properties!._role === "anchor")!;
    expect(anchor.geometry).toEqual({ type: "Point", coordinates: [9.2, 48.18] });
    const sym = data.features.find(
      (x) => x.properties!._role === "symbol" && x.properties!.kind === "viewpoint",
    )!;
    expect(sym.properties!.kind).toBe("viewpoint");
    expect(sym.properties!._layer).toBe("poi-main");
  });
});

describe("bus stops", () => {
  const [stops] = managedLayers(busstopLayers());
  const stop = (name: string, lngLat: [number, number], id?: number): SourceFeature => ({
    id,
    properties: { name, sat: 6, sun: 5, min: 5 },
    lngLat,
  });

  test("priority sits just below railway halts and churches", () => {
    expect(BUSSTOP_PRIORITY).toBeGreaterThan(PRIORITY.railway_halt!);
    expect(BUSSTOP_PRIORITY).toBeGreaterThan(PRIORITY.church!);
    expect(BUSSTOP_PRIORITY).toBeLessThan(PRIORITY.guidepost!);
  });

  test("every stop is a candidate from z11.5, with a 3 mm icon box and the constant priority", () => {
    const feats = [stop("Bahnhof", [8.629, 48.168]), stop("Rathaus", [8.63, 48.169])];
    const cands = evaluateLayer(stops!, feats, 12.95);
    expect(cands).toHaveLength(2);
    for (const c of cands) {
      expect(c.item.box.maxX - c.item.box.minX).toBeCloseTo(3.0, 5);
      expect(c.item.priority).toBe(BUSSTOP_PRIORITY);
      expect(c.layer.id).toBe("busstops-main");
    }
    expect(evaluateLayer(stops!, feats, 11.95)).toHaveLength(2);
    expect(evaluateLayer(stops!, feats, 11.2)).toEqual([]);
  });

  test("stops without feature id are told apart by coordinate and name", () => {
    const a = stop("Bahnhof", [8.629, 48.168]);
    expect(featureKey(a)).toBe(featureKey(stop("Bahnhof", [8.629 + 1e-9, 48.168])));
    expect(featureKey(a)).not.toBe(featureKey(stop("Rathaus", [8.629, 48.168])));
    expect(featureKey(a)).not.toBe(featureKey(stop("Bahnhof", [8.6295, 48.168])));
    expect(featureKey(stop("X", [1, 2], 7))).toBe("7");
  });

  test("dense stops are displaced, never dropped", () => {
    const feats = Array.from({ length: 6 }, (_, i) =>
      stop(`Halt ${i}`, [8.629 + i * 1e-6, 48.168]),
    );
    const cands = evaluateLayer(stops!, feats, 12.95);
    const placements = placeSymbols(cands.map((c) => c.item));
    expect(placements).toHaveLength(6);
    const data = placementData(cands, placements, 12.95);
    expect(data.features.filter((x) => x.properties!._role === "symbol")).toHaveLength(6);
  });
});

describe("helpers", () => {
  test("mm projection round-trips", () => {
    const [x, y] = lngLatToMm(9.2105, 48.1795, 12.95);
    const [lng, lat] = mmToLngLat(x, y, 12.95);
    expect(lng).toBeCloseTo(9.2105, 9);
    expect(lat).toBeCloseTo(48.1795, 9);
    // 1:25 000 at 48.18° N: 1 km on the ground ≈ 40 mm on paper.
    const [x2] = lngLatToMm(
      9.2105 + 1000 / (111320 * Math.cos((48.1795 * Math.PI) / 180)),
      48.1795,
      12.9459,
    );
    expect(x2 - lngLatToMm(9.2105, 48.1795, 12.9459)[0]).toBeCloseTo(40, 0);
  });

  test("text box estimate grows with length and wraps at max width", () => {
    const m = {
      sizePx: 11.3,
      letterSpacingEm: 0,
      maxWidthEm: 8,
      lineHeightEm: 1.2,
      uppercase: false,
    };
    const short = estimateTextBox("Ort", m);
    const long = estimateTextBox("Veringenstadt", m);
    const wrapped = estimateTextBox("Hohenzollern Jugendherberge Sigmaringen", m);
    expect(long.maxX - long.minX).toBeGreaterThan(short.maxX - short.minX);
    expect(wrapped.maxY - wrapped.minY).toBeGreaterThan(long.maxY - long.minY);
    expect(estimateTextBox("", m)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
