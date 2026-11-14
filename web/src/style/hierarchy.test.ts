import { describe, expect, test } from "bun:test";
import { createExpression, featureFilter, latest } from "@maplibre/maplibre-gl-style-spec";
import { POI_KINDS } from "../icons/registry";
import { managedLayers, withPlacementLayers } from "../placement/layers";
import {
  BUSSTOP_PRIORITY,
  FALLBACK_PRIORITY,
  KIND_RANKS,
  RANKS,
  TIERS,
  tierOf,
  UNNAMED_GUIDEPOST_PRIORITY,
  WAYMARK_TIER,
} from "./hierarchy";
import { buildStyle, defaultVisibility, GROUPS } from "./index";
import {
  MINOR_KINDS,
  POI_CATEGORIES,
  poiCategoryLayers,
  poiLayers,
  PRIORITY,
  poiNameField,
  viewpointLayers,
} from "./poi";

const CATEGORY = (id: string) => POI_CATEGORIES.find((c) => c.id === id)!;

const style = (visibility = defaultVisibility()) =>
  buildStyle({
    pmtilesUrl: "https://example.invalid/x.pmtiles",
    busstopsUrl: "https://example.invalid/busstops.pmtiles",
    glyphsUrl: "https://example.invalid/{fontstack}/{range}.pbf",
    relief: { dem: "dem-shared://{z}/{x}/{y}", contours: "dem-contour://{z}/{x}/{y}?test" },
    visibility,
  });

function evaluate(layout: unknown, key: string, properties: Record<string, unknown>): unknown {
  const spec = (latest as unknown as { layout_symbol: Record<string, unknown> }).layout_symbol[key];
  const expr = createExpression(layout, spec as never);
  if (expr.result !== "success") throw new Error(JSON.stringify(expr.value));
  return expr.value.evaluate({ zoom: 13 } as never, { type: 1, properties } as never);
}

describe("importance hierarchy", () => {
  test("tiers in the agreed order, with the agreed contents", () => {
    expect(TIERS.map((t) => t.tier)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(TIERS[0]!.tier).toBe(WAYMARK_TIER);
    const keys = (tier: number) => Object.keys(TIERS[tier]!.ranks).sort();
    expect(keys(1)).toEqual(
      [
        "alpine_hut",
        "busstop",
        "railway_halt",
        "railway_station",
        "shelter",
        "wilderness_hut",
      ].sort(),
    );
    expect(keys(2)).toEqual(["drinking_water", "spring"]);
    expect(keys(3)).toEqual(
      [
        "castle",
        "castle_ruins",
        "cave_entrance",
        "ruins",
        "viewpoint",
        "viewtower",
        "waterfall",
      ].sort(),
    );
    expect(keys(4)).toEqual(["cafe", "restaurant"]);
    expect(keys(5)).toEqual(["bbq", "guidepost", "parking", "picnic_site", "toilets"]);
    expect(keys(6)).toEqual(["camp_site", "caravan_site", "hostel", "hotel"]);
    expect(keys(7)).toEqual(["chapel", "church", "monument", "place_of_worship"]);
    expect(keys(8)).toEqual(
      [
        "communication_tower",
        "fountain",
        "mast",
        "memorial",
        "rock",
        "sinkhole",
        "stone",
        "tower",
        "wayside_cross",
        "wayside_shrine",
        "weir",
        "wind_turbine",
      ].sort(),
    );
  });

  test("every PoiKind (and the bus stop) has exactly one tier", () => {
    const seen = new Map<string, number>();
    for (const t of TIERS) {
      for (const k of Object.keys(t.ranks)) {
        expect(seen.has(k), `${k} in two tiers`).toBe(false);
        seen.set(k, t.tier);
      }
    }
    for (const k of POI_KINDS) expect(seen.has(k), k).toBe(true);
    expect([...seen.keys()].filter((k) => !(POI_KINDS as readonly string[]).includes(k))).toEqual([
      "busstop",
    ]);
  });

  test("a rank lies in the tens of its tier; tiers never overlap", () => {
    for (const t of TIERS) {
      for (const [k, rank] of Object.entries(t.ranks)) expect(tierOf(rank!), k).toBe(t.tier);
    }
    // More important tier = lower numbers: every rank of a tier is below all of the next.
    for (let i = 1; i < TIERS.length - 1; i++) {
      const a = Math.max(...Object.values(TIERS[i]!.ranks));
      const b = Math.min(...Object.values(TIERS[i + 1]!.ranks));
      expect(a, `tier ${i}`).toBeLessThan(b);
    }
  });

  test("order from the user's list: station over bus stop over restaurant", () => {
    expect(RANKS.railway_station).toBeLessThan(RANKS.busstop);
    expect(RANKS.railway_halt).toBeLessThan(RANKS.busstop);
    expect(RANKS.busstop).toBeLessThan(RANKS.restaurant);
    expect(RANKS.alpine_hut).toBeLessThan(RANKS.drinking_water);
    expect(RANKS.spring).toBeLessThan(RANKS.viewtower);
    expect(RANKS.viewpoint).toBeLessThan(RANKS.restaurant);
    expect(RANKS.cafe).toBeLessThan(RANKS.parking);
    expect(RANKS.toilets).toBeLessThan(RANKS.camp_site);
    expect(RANKS.hotel).toBeLessThan(RANKS.church);
    expect(RANKS.monument).toBeLessThan(RANKS.tower);
    expect(UNNAMED_GUIDEPOST_PRIORITY).toBeGreaterThan(Math.max(...Object.values(RANKS)));
  });

  test("poi.ts derives its priorities from the hierarchy", () => {
    expect(PRIORITY).toBe(KIND_RANKS);
    for (const k of POI_KINDS) expect(PRIORITY[k], k).toBe(RANKS[k]);
    expect(BUSSTOP_PRIORITY).toBe(RANKS.busstop);
    expect(Object.keys(PRIORITY)).not.toContain("busstop");
    // The layers' sort key evaluates to the rank (named before unnamed by +0.5 only).
    const main = poiLayers().find((l) => l.id === "poi-main")!;
    const key = (props: Record<string, unknown>) =>
      evaluate(
        (main.layout as Record<string, unknown>)["symbol-sort-key"],
        "symbol-sort-key",
        props,
      );
    for (const k of ["castle", "restaurant", "church"] as const) {
      expect(key({ kind: k, name: "x" })).toBe(RANKS[k]);
    }
    expect(key({ kind: "unknown_kind" })).toBe(FALLBACK_PRIORITY + 0.5);
    const minor = poiCategoryLayers(CATEGORY("guideposts")).find(
      (l) => l.id === "guideposts-minor",
    )!;
    expect(
      evaluate((minor.layout as Record<string, unknown>)["symbol-sort-key"], "symbol-sort-key", {
        kind: "guidepost",
      }),
    ).toBe(UNNAMED_GUIDEPOST_PRIORITY);
  });

  test("draw order across layers and sources: the merged icon layer sorts by the hierarchy", () => {
    const { style: out } = withPlacementLayers(style(), true);
    const icons = out.layers.find((l) => l.id === "placement-icons")!;
    const sortKey = (layer: string, props: Record<string, unknown>) =>
      evaluate((icons.layout as Record<string, unknown>)["symbol-sort-key"], "symbol-sort-key", {
        _layer: layer,
        ...props,
      }) as number;
    // Higher value = drawn later = on top.
    const station = sortKey("poi-main", { kind: "railway_station", name: "Bf" });
    const halt = sortKey("poi-main", { kind: "railway_halt", name: "Hp" });
    const stop = sortKey("busstops-main", { name: "Markt" });
    const hut = sortKey("food-main", { kind: "alpine_hut", name: "Hütte" });
    const view = sortKey("viewpoints-main", { kind: "viewpoint", name: "Blick" });
    const restaurant = sortKey("food-main", { kind: "restaurant", name: "Gasthaus" });
    const church = sortKey("poi-main", { kind: "church" });
    const cross = sortKey("poi-minor", { kind: "wayside_cross" });
    const flagUnnamed = sortKey("guideposts-minor", { kind: "guidepost" });
    const order = [station, halt, stop, hut, view, restaurant, church, cross, flagUnnamed];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!).toBeGreaterThan(order[i]!);
    // Image, anchor and offset follow the source layer.
    const prop = (layer: string, key: string, props: Record<string, unknown>) =>
      evaluate((icons.layout as Record<string, unknown>)[key], key, { _layer: layer, ...props });
    const imageOf = (v: unknown) => (typeof v === "string" ? v : (v as { name: string }).name);
    expect(imageOf(prop("busstops-main", "icon-image", {}))).toBe("poi:busstop");
    expect(imageOf(prop("heritage-main", "icon-image", { kind: "castle" }))).toBe("poi:castle");
    expect(imageOf(prop("guideposts-minor", "icon-image", { kind: "guidepost" }))).toBe(
      "poi:guidepost_small",
    );
    expect(prop("busstops-main", "icon-anchor", {})).toBe("center");
    expect(prop("guideposts-main", "icon-anchor", { kind: "guidepost" })).toBe("bottom-left");
  });

  test("waymarks (tier 0) stay above everything", () => {
    const ids = withPlacementLayers(style(), true).style.layers.map((l) => l.id);
    expect(ids.at(-1)).toBe("waymarks-signs");
    expect(ids.indexOf("placement-icons")).toBeLessThan(ids.indexOf("waymarks-signs"));
  });
});

describe("switches: viewpoints and guidepost names", () => {
  test("viewpoints are on and guidepost names off by default, each with its own sidebar toggle", () => {
    const vp = GROUPS.find((g) => g.id === "viewpoints")!;
    const gn = GROUPS.find((g) => g.id === "guidepostnames")!;
    expect(vp.label).toBe("Aussichtspunkte");
    expect(vp.defaultVisible).toBe(true);
    expect(gn.label).toBe("Wegweisernamen");
    expect(gn.defaultVisible).toBe(false);
    expect(defaultVisibility().viewpoints).toBe(true);
    expect(defaultVisibility().guidepostnames).toBe(false);
    expect(defaultVisibility().busstops).toBe(true);
  });

  test("viewpoints have their own layer; view towers stay with the pictograms", () => {
    const filterOf = (l: object) => featureFilter((l as { filter?: unknown }).filter as never, "f");
    const main = filterOf(poiLayers().find((l) => l.id === "poi-main")!);
    const vp = viewpointLayers();
    expect(vp.map((l) => l.id)).toEqual(["viewpoints-main"]);
    const vpf = filterOf(vp[0]!);
    const pass = (f: ReturnType<typeof featureFilter>, kind: string) =>
      f.filter({ zoom: 13 } as never, { type: 1, properties: { kind, name: "x" } } as never);
    expect(pass(main, "viewpoint")).toBe(false);
    expect(pass(main, "viewtower")).toBe(true);
    expect(pass(vpf, "viewpoint")).toBe(true);
    // Only named viewpoints (defensive against old tiles).
    expect(
      vpf.filter({ zoom: 13 } as never, { type: 1, properties: { kind: "viewpoint" } } as never),
    ).toBe(false);
    expect(pass(vpf, "viewtower")).toBe(false);
    expect(MINOR_KINDS as string[]).not.toContain("viewpoint");
  });

  test("hidden viewpoints take no part in the placement, shown ones do", () => {
    const visibility = (on: boolean) => ({ ...defaultVisibility(), viewpoints: on });
    for (const on of [false, true]) {
      const m = managedLayers(style(visibility(on)).layers).find(
        (x) => x.id === "viewpoints-main",
      )!;
      // The export placement reads this visibility (placeForExport).
      expect((m.spec.layout as { visibility: string }).visibility).toBe(on ? "visible" : "none");
      const printStyle = withPlacementLayers(style(visibility(on)), true).style;
      const vis = (id: string) =>
        (printStyle.layers.find((l) => l.id === id)!.layout as { visibility: string }).visibility;
      expect(vis("placement-viewpoints-main-source")).toBe(on ? "visible" : "none");
      expect(vis("placement-viewpoints-main-name")).toBe(on ? "visible" : "none");
    }
  });

  test("guidepost names: flags always, names only with the switch", () => {
    const name = (on: boolean, kind: string, props: Record<string, unknown> = {}) =>
      evaluate(poiNameField(on), "text-field", { kind, name: "Hardtstein", ...props });
    const text = (v: unknown) =>
      typeof v === "string" ? v : String((v as { toString(): string }).toString());
    expect(text(name(false, "guidepost"))).toBe("");
    expect(text(name(true, "guidepost"))).toBe("Hardtstein");
    expect(text(name(false, "restaurant"))).toBe("Hardtstein");
    // The switch reaches the built style (export) and the print clone (print view).
    const field = (visibility: Record<string, boolean>, id: string, active: boolean) =>
      (
        withPlacementLayers(
          style({ ...defaultVisibility(), ...visibility }),
          active,
        ).style.layers.find((l) => l.id === id)!.layout as Record<string, unknown>
      )["text-field"];
    for (const id of ["guideposts-main", "placement-guideposts-main-name"]) {
      expect(field({}, id, true)).toEqual(poiNameField(false));
      expect(field({ guidepostnames: true }, id, true)).toEqual(poiNameField(true));
    }
    // The guidepost icon is independent of the switch.
    const icon = (v: Record<string, boolean>) =>
      JSON.stringify(
        (
          withPlacementLayers(style({ ...defaultVisibility(), ...v }), true).style.layers.find(
            (l) => l.id === "guideposts-main",
          ) as { filter?: unknown }
        ).filter,
      );
    expect(icon({})).toBe(icon({ guidepostnames: true }));
  });
});
