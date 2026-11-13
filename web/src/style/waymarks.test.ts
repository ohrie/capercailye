import { describe, expect, test } from "bun:test";
import {
  createExpression,
  featureFilter,
  latest,
  type SymbolLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { svgForImageId } from "../icons/runtime";
import { WAYMARK_IMAGE_PREFIX } from "../osmc";
import { evaluateLayer } from "../placement/collect";
import { managedLayers, withPlacementLayers } from "../placement/layers";
import { zoomForScale } from "../print/scale";
import { buildStyle, defaultVisibility, GROUPS } from "./index";
import { WAYMARK_PADDING_MM, WAYMARK_SPACING_MM, waymarkLayers } from "./routes";
import { SMALL_SCALE_FACTOR } from "./sizes";
import { mm, PRINT_MIN_ZOOM } from "./units";

const base = () =>
  buildStyle({
    pmtilesUrl: "https://example.invalid/x.pmtiles",
    busstopsUrl: "https://example.invalid/busstops.pmtiles",
    glyphsUrl: "https://example.invalid/{fontstack}/{range}.pbf",
    relief: { dem: "dem-shared://{z}/{x}/{y}", contours: "dem-contour://{z}/{x}/{y}?test" },
    visibility: defaultVisibility(),
  });

const [layer] = waymarkLayers() as SymbolLayerSpecification[];
const layout = layer!.layout as Record<string, unknown>;

type Props = Record<string, unknown>;
const filter = featureFilter(layer!.filter as never, "waymarks.filter");
const passes = (properties: Props) =>
  filter.filter({ zoom: 13 } as never, { type: 2, properties } as never);

function evalLayout(key: string, zoom: number, properties: Props = {}): unknown {
  const spec = (latest as unknown as { layout_symbol: Record<string, unknown> }).layout_symbol[key];
  const expr = createExpression(layout[key], spec as never);
  if (expr.result !== "success") throw new Error(JSON.stringify(expr.value));
  return expr.value.evaluate({ zoom } as never, { type: 2, properties } as never);
}

const SCALE_ZOOM = (scale: number) => zoomForScale(scale, 48.5);

describe("waymarks layer", () => {
  test("one layer in the waymarks group, with its own toggle, on top of the style", () => {
    const group = GROUPS.find((g) => g.id === "waymarks")!;
    expect(group.toggledBy).toBeUndefined();
    expect(group.label).toBe("Wegzeichen");
    expect(GROUPS.at(-1)!.id).toBe("waymarks");
    const style = base();
    expect(style.layers.at(-1)!.id).toBe("waymarks-line");
    const off = buildStyle({
      pmtilesUrl: "x",
      glyphsUrl: "y",
      relief: { dem: "dem-shared://{z}/{x}/{y}", contours: "dem-contour://{z}/{x}/{y}?test" },
      visibility: { ...defaultVisibility(), waymarks: false },
    });
    const vis = (off.layers.find((l) => l.id === "waymarks-line")!.layout as { visibility: string })
      .visibility;
    expect(vis).toBe("none");
  });

  test("upright symbols along the routes lines, every 6 cm on paper", () => {
    expect(layer!.source).toBe("osm");
    expect(layer!["source-layer"]).toBe("routes");
    expect(layout["symbol-placement"]).toBe("line");
    expect(layout["icon-rotation-alignment"]).toBe("viewport");
    expect(layout["symbol-spacing"]).toBeCloseTo(mm(WAYMARK_SPACING_MM), 9);
    expect(WAYMARK_SPACING_MM).toBe(60);
    // No text: the combined image carries every sign of the segment.
    expect(layout["text-field"]).toBeUndefined();
  });

  test("only from the print band on; smaller at 1:50 000, full size from 1:25 000", () => {
    expect(layer!.minzoom).toBe(PRINT_MIN_ZOOM);
    expect(SCALE_ZOOM(50000)).toBeGreaterThan(PRINT_MIN_ZOOM);
    expect(evalLayout("icon-size", SCALE_ZOOM(50000))).toBe(SMALL_SCALE_FACTOR);
    for (const scale of [25000, 15000, 10000]) {
      expect(evalLayout("icon-size", SCALE_ZOOM(scale))).toBe(1);
    }
    // The step lies between the two scales anywhere in Baden-Württemberg (47.5–49.8° N).
    for (const lat of [47.5, 49.8]) {
      expect(evalLayout("icon-size", zoomForScale(50000, lat))).toBe(SMALL_SCALE_FACTOR);
      expect(evalLayout("icon-size", zoomForScale(25000, lat))).toBe(1);
    }
  });

  test("collision: nothing else removes a waymark, labels avoid it, waymarks do not stack", () => {
    // Placed first (top of the style), so only other waymarks are in the collision index
    // when a waymark is placed: allow-overlap false thins out neighbouring waymarks only.
    expect(layout["icon-allow-overlap"]).toBe(false);
    expect(layout["icon-ignore-placement"]).toBe(false);
    expect(layout["icon-padding"]).toBeCloseTo(mm(WAYMARK_PADDING_MM), 9);
    // More routes and major networks win where two waymarks compete.
    const key = (p: Props) => evalLayout("symbol-sort-key", 13, p) as number;
    expect(key({ count: 3, network: "lwn" })).toBeLessThan(key({ count: 1, network: "lwn" }));
    expect(key({ count: 1, network: "nwn" })).toBeLessThan(key({ count: 3, network: "lwn" }));
    // The print placement reads its boxes (role "obstacle") instead of moving it.
    expect(managedLayers([layer!])[0]!.role).toBe("obstacle");
  });

  test("filter: segments without any sign are not requested", () => {
    expect(passes({ symbols: "", refs: "", names: "", colours: "" })).toBe(false);
    expect(passes({ symbols: "|||", refs: "|||", names: "|||", colours: "red|||" })).toBe(false);
    expect(passes({ symbols: "||", refs: "||", names: "||" })).toBe(false);
    expect(passes({})).toBe(false);
    expect(passes({ symbols: "yellow::yellow_diamond", refs: "", names: "" })).toBe(true);
    expect(passes({ symbols: "|", refs: "|HW 2", names: "|" })).toBe(true);
    expect(passes({ symbols: "", refs: "", names: "Weg der Sinne" })).toBe(true);
  });

  test("every segment that passes the filter gets an image from the waymark provider", () => {
    const samples: Props[] = [
      { symbols: "red:white:red_pointer|green:blue::DZW|", refs: "HW 2||", names: "a|b|c" },
      { symbols: "yellow::yellow_diamond", refs: "", names: "", colours: "" },
      { symbols: "", refs: "", names: "Donau Felsen Läufe: Wilde Täler", colours: "" },
      { symbols: "|", refs: "|5", names: "|", colours: "|blue" },
    ];
    for (const p of samples) {
      expect(passes(p)).toBe(true);
      const id = evalLayout("icon-image", 13, p) as { name: string } | string;
      const name = typeof id === "string" ? id : id.name;
      expect(name.startsWith(`${WAYMARK_IMAGE_PREFIX}:`)).toBe(true);
      expect(svgForImageId(name)).toBeDefined();
    }
  });
});

describe("waymarks and the print placement", () => {
  for (const active of [false, true]) {
    test(`waymarks stay the topmost symbol layer above all placement clones (active = ${active})`, () => {
      const { style } = withPlacementLayers(base(), active);
      const ids = style.layers.map((l) => l.id);
      const wm = ids.indexOf("waymarks-line");
      expect(wm).toBe(ids.length - 1);
      const clones = ids.filter((id) => id.startsWith("placement-"));
      expect(clones.length).toBeGreaterThan(0);
      for (const c of clones) expect(ids.indexOf(c)).toBeLessThan(wm);
      // The icon clones are placed right after the waymarks' group-mates, i.e. below them.
      expect(ids.indexOf("placement-poi-main-icon")).toBeLessThan(wm);
    });
  }

  test("obstacle layers are no candidates of the displacement", () => {
    const [m] = managedLayers([layer!]);
    const f = {
      id: 1,
      properties: { symbols: "red::red_bar" },
      lngLat: [9, 48] as [number, number],
    };
    expect(evaluateLayer(m!, [f], 13)).toEqual([]);
  });
});
