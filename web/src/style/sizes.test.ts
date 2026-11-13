import { describe, expect, test } from "bun:test";
import { createExpression, latest } from "@maplibre/maplibre-gl-style-spec";
import { POI_ICONS } from "../icons/registry";
import { osmcToSvg, waymarkSvg } from "../osmc";
import { zoomForScale } from "../print/scale";
import { busstopLayers, poiLayers } from "./poi";
import { waymarkLayers } from "./routes";
import * as sizes from "./sizes";
import { mm } from "./units";

const values = new Set(
  Object.entries(sizes)
    .filter(([k, v]) => k.endsWith("_MM") && typeof v === "number")
    .map(([, v]) => v as number),
);

function iconSizeAt(layout: unknown, zoom: number): unknown {
  const spec = (latest as unknown as { layout_symbol: Record<string, unknown> }).layout_symbol[
    "icon-size"
  ];
  const expr = createExpression(layout, spec as never);
  if (expr.result !== "success") throw new Error(JSON.stringify(expr.value));
  return expr.value.evaluate({ zoom } as never, { type: 1, properties: {} } as never);
}

describe("symbol sizes (style/sizes.ts)", () => {
  test("a waymark sign is as high as a boxed pictogram; the gap is proportional", () => {
    expect(sizes.WAYMARK_MM).toBe(sizes.ICON_MM);
    expect(sizes.ICON_MM).toBe(3.4);
    expect(sizes.ICON_SMALL_MM).toBe(3.0);
    expect(sizes.WAYMARK_GAP_MM).toBeLessThan(0.5);
    expect(osmcToSvg("red:white:red_bar")!.height).toBeCloseTo(mm(sizes.WAYMARK_MM), 6);
    expect(waymarkSvg([{ ref: "7" }])!.height).toBeCloseTo(mm(sizes.WAYMARK_MM), 6);
  });

  test("every icon size of the registry is a constant of sizes.ts", () => {
    for (const [name, def] of Object.entries(POI_ICONS)) {
      expect(values.has(def.sizeMm), `${name}: ${def.sizeMm}`).toBe(true);
    }
  });

  test("one scale rule for pictograms, bus stops and waymarks", () => {
    const sizeOf = (l: { layout?: unknown }) => (l.layout as Record<string, unknown>)["icon-size"];
    const layers = [...poiLayers(), ...busstopLayers(), ...waymarkLayers()];
    for (const l of layers) expect(sizeOf(l), l.id).toEqual(sizes.iconSizeByScale);
    for (const lat of [47.5, 49.1, 50.5]) {
      expect(iconSizeAt(sizes.iconSizeByScale, zoomForScale(50000, lat))).toBe(
        sizes.SMALL_SCALE_FACTOR,
      );
      for (const scale of [25000, 15000, 10000]) {
        expect(iconSizeAt(sizes.iconSizeByScale, zoomForScale(scale, lat))).toBe(1);
      }
    }
  });
});
