import { describe, expect, test } from "bun:test";
import {
  createExpression,
  latest,
  type SymbolLayerSpecification,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { svgForImageId } from "../icons/runtime";
import { WAYMARK_IMAGE_PREFIX } from "../osmc";
import { managedLayers, withPlacementLayers } from "../placement/layers";
import { zoomForScale } from "../print/scale";
import { WAYMARK_SPACING_MM } from "../waymarks/plan";
import { signsForRoutes } from "../waymarks/signs";
import { buildStyle, defaultVisibility, GROUPS, UI_ORDER } from "./index";
import { WAYMARK_PADDING_MM, waymarkLayers } from "./routes";
import { SMALL_SCALE_FACTOR } from "./sizes";
import { WAYMARK_SOURCE } from "./sources";
import { mm, PRINT_MIN_ZOOM } from "./units";

const RELIEF = { dem: "dem-shared://{z}/{x}/{y}", contours: "dem-contour://{z}/{x}/{y}?test" };

const base = (extra: Partial<Parameters<typeof buildStyle>[0]> = {}) =>
  buildStyle({
    pmtilesUrl: "https://example.invalid/x.pmtiles",
    busstopsUrl: "https://example.invalid/busstops.pmtiles",
    glyphsUrl: "https://example.invalid/{fontstack}/{range}.pbf",
    relief: RELIEF,
    visibility: defaultVisibility(),
    ...extra,
  });

const [layer] = waymarkLayers() as SymbolLayerSpecification[];
const layout = layer!.layout as Record<string, unknown>;

type Props = Record<string, unknown>;

function evalLayout(key: string, zoom: number, properties: Props = {}): unknown {
  const spec = (latest as unknown as { layout_symbol: Record<string, unknown> }).layout_symbol[key];
  const expr = createExpression(layout[key], spec as never);
  if (expr.result !== "success") throw new Error(JSON.stringify(expr.value));
  return expr.value.evaluate({ zoom } as never, { type: 1, properties } as never);
}

const SCALE_ZOOM = (scale: number) => zoomForScale(scale, 48.5);

describe("waymarks layer", () => {
  test("one layer in the waymarks group, no switch of its own (follows routes), on top", () => {
    const group = GROUPS.find((g) => g.id === "waymarks")!;
    expect(group.toggledBy).toBe("routes");
    expect(group.label).toBeUndefined();
    expect(group.parent).toBeUndefined();
    expect(group.defaultVisible).toBe(true);
    expect(UI_ORDER).not.toContain("waymarks");
    expect(GROUPS.at(-1)!.id).toBe("waymarks");
    const style = base();
    expect(style.layers.at(-1)!.id).toBe("waymarks-signs");
    expect(style.layers.filter((l) => l.id.startsWith("waymarks-"))).toHaveLength(1);
    const visibilityOf = (v: Record<string, boolean>) =>
      (
        base({ visibility: v }).layers.find((l) => l.id === "waymarks-signs")!.layout as {
          visibility: string;
        }
      ).visibility;
    expect(visibilityOf(defaultVisibility())).toBe("visible");
    expect(visibilityOf({ ...defaultVisibility(), routes: false })).toBe("none");
    // The `waymarks` group has no switch of its own: only `routes` and the network switches count.
    expect(visibilityOf({ ...defaultVisibility(), waymarks: false })).toBe("visible");
  });

  test("no sub-switch for local signs, no label for the signs; the network switches are sub-switches of routes", () => {
    expect(GROUPS.filter((g) => g.id.startsWith("local"))).toEqual([]);
    expect(UI_ORDER.filter((id) => id.startsWith("local"))).toEqual([]);
    for (const net of ["net-iwn", "net-nwn", "net-rwn", "net-lwn"]) {
      expect(GROUPS.find((g) => g.id === net)?.parent).toBe("routes");
    }
  });

  test("a point layer on the waymark-signs source: one image per placed sign, upright", () => {
    expect(layer!.source).toBe(WAYMARK_SOURCE);
    expect(layer!["source-layer"]).toBeUndefined();
    expect(layout["symbol-placement"]).toBe("point");
    expect(layout["icon-rotation-alignment"]).toBe("viewport");
    expect(layout["icon-pitch-alignment"]).toBe("viewport");
    expect(layout["text-field"]).toBeUndefined();
    expect(WAYMARK_SPACING_MM).toBe(60);
    const style = base();
    expect(style.sources[WAYMARK_SOURCE]).toMatchObject({ type: "geojson" });
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  test("the style takes the computed signs as source data", () => {
    const data = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: { img: "waymark:red::red_bar" },
          geometry: { type: "Point" as const, coordinates: [9, 48] },
        },
      ],
    };
    const style = base({ waymarks: data });
    expect((style.sources[WAYMARK_SOURCE] as { data: unknown }).data).toEqual(data);
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

  test("collision: signs never overlap by construction, labels avoid them, no placement role", () => {
    expect(layout["icon-allow-overlap"]).toBe(true);
    expect(layout["icon-ignore-placement"]).toBe(false);
    expect(WAYMARK_PADDING_MM).toBe(0.5);
    expect(layout["icon-padding"]).toBeCloseTo(mm(WAYMARK_PADDING_MM), 9);
    expect(managedLayers([layer!])).toEqual([]);
    expect(layout["symbol-sort-key"]).toBeUndefined();
  });

  test("the image id of a point is a single-route waymark id the provider can draw", () => {
    const samples = [
      { id: "1", network: "rwn", osmc: "red:white:red_bar" },
      { id: "2", network: "lwn", ref: "5", colour: "blue" },
      { id: "3", network: "", name: "Donau Felsen Läufe: Wilde Täler" },
    ];
    for (const route of samples) {
      const [sign] = signsForRoutes([route], 1);
      expect(sign).toBeDefined();
      const props = { img: sign!.imageId };
      expect(evalLayout("icon-image", 13, props)).toBe(sign!.imageId);
      expect(sign!.imageId.startsWith(`${WAYMARK_IMAGE_PREFIX}:`)).toBe(true);
      expect(svgForImageId(sign!.imageId)).toBeDefined();
    }
  });
});

describe("waymarks and the print placement", () => {
  for (const active of [false, true]) {
    test(`the signs stay the topmost layer above all placement clones (active = ${active})`, () => {
      const { style } = withPlacementLayers(base(), active);
      const ids = style.layers.map((l) => l.id);
      const wm = ids.indexOf("waymarks-signs");
      expect(wm).toBe(ids.length - 1);
      const clones = ids.filter((id) => id.startsWith("placement-"));
      expect(clones.length).toBeGreaterThan(0);
      for (const c of clones) expect(ids.indexOf(c)).toBeLessThan(wm);
    });
  }

  test('no layer carries the removed role "obstacle"', () => {
    const roles = managedLayers(base().layers).map((m) => m.role as string);
    expect(roles).not.toContain("obstacle");
  });
});
