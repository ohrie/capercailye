// Non-visual checks of the composed style: spec validity, layer id rules, and that every
// source-layer / attribute / enumerated value used in expressions exists in tiles/SCHEMA.md.
// A typo in any of these would not fail at runtime, it would silently render nothing.
import { describe, expect, test } from "bun:test";
import {
  createExpression,
  featureFilter,
  latest,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { Feature, FeatureCollection } from "geojson";
import { POI_KINDS as REGISTRY_KINDS } from "../icons/registry";
import { managedLayers, placementRole } from "../placement/layers";
import { buildStyle, defaultVisibility, GROUPS, SECTIONS, UI_ORDER, uiGroups } from "./index";
import { POI_CATEGORIES } from "./poi";
import { NETWORK_GROUPS, routeBandExpressions, routeLayers, routeNetworkFilter } from "./routes";
import { COLORS } from "./palette";
import { GPX_LINE_MM, GPX_MARKER_MM } from "./sizes";
import { CONTOUR_OPTIONS } from "./sources";
import { mm, pt } from "./units";

/** Hand-maintained copy of tiles/SCHEMA.md: attributes per tile layer. */
const SCHEMA: Record<string, string[]> = {
  // Contour lines: generated client-side by maplibre-contour (CONTOUR_OPTIONS), not in tiles/SCHEMA.md.
  contours: ["ele", "level"],
  transport: [
    "kind",
    "link",
    "rail",
    "service",
    "tracktype",
    "sac_scale",
    "trail_visibility",
    "surface",
    "access",
    "foot",
    "bicycle",
    "bridge",
    "tunnel",
    "name",
    "ref",
  ],
  routes: ["symbols", "refs", "names", "colours", "network", "nets", "count"],
  landcover: ["kind", "wetland"],
  protected_area: ["kind", "name", "protect_class"],
  water: ["name", "intermittent"],
  waterway: ["kind", "name", "tunnel", "intermittent"],
  cliff: ["kind", "name"],
  building: ["industrial"],
  place: ["kind", "name", "population"],
  peak: ["kind", "name", "ele"],
  // GTFS bus stops: own PMTiles file (capercailye-busstops.pmtiles), schema fixed by transit/.
  bus_stop: ["name", "sat", "sun", "min"],
  poi: [
    "kind",
    "rank",
    "name",
    "ele",
    "station",
    "shelter_type",
    "religion",
    "drinking_water",
    "access",
    "hiking",
    "area_m2",
    "tower_type",
  ],
};

const POI_KINDS = [
  "railway_station",
  "viewtower",
  "alpine_hut",
  "castle",
  "castle_ruins",
  "wilderness_hut",
  "shelter",
  "viewpoint",
  "railway_halt",
  "waterfall",
  "cave_entrance",
  "ruins",
  "church",
  "chapel",
  "camp_site",
  "hostel",
  "restaurant",
  "cafe",
  "spring",
  "drinking_water",
  "guidepost",
  "parking",
  "monument",
  "picnic_site",
  "bbq",
  "hotel",
  "caravan_site",
  "toilets",
  "fountain",
  "memorial",
  "communication_tower",
  "tower",
  "place_of_worship",
  "wayside_cross",
  "wayside_shrine",
  "rock",
  "stone",
  "sinkhole",
  "mast",
  "wind_turbine",
  "weir",
];

/** Enumerated values per layer and attribute (only attributes with a closed value set). */
const VALUES: Record<string, Record<string, string[]>> = {
  transport: {
    kind: [
      ...["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential"],
      ...["service", "living_street", "pedestrian", "track", "path", "footway", "steps"],
      ...["bridleway", "cycleway", "road"],
      ...["rail", "light_rail", "narrow_gauge", "subway", "funicular", "monorail", "tram"],
      ...["preserved", "disused"],
    ],
    tracktype: ["grade1", "grade2", "grade3", "grade4", "grade5"],
    sac_scale: [
      ...["hiking", "mountain_hiking", "demanding_mountain_hiking", "alpine_hiking"],
      ...["demanding_alpine_hiking", "difficult_alpine_hiking"],
    ],
    trail_visibility: ["excellent", "good", "intermediate", "bad", "horrible", "no"],
    access: ["private", "no"],
    foot: ["designated", "yes", "no"],
    bicycle: ["designated", "yes", "no"],
  },
  routes: { network: ["iwn", "nwn", "rwn", "lwn"] },
  landcover: {
    kind: [
      ...["forest", "residential", "commercial", "industrial", "meadow", "farmland", "orchard"],
      ...["vineyard", "heath", "scrub", "wetland", "bare_rock", "scree", "quarry"],
    ],
  },
  protected_area: { kind: ["national_park", "nature_reserve", "protected_area"] },
  waterway: { kind: ["river", "canal", "stream", "ditch", "drain", "weir"] },
  cliff: { kind: ["cliff"] },
  place: {
    kind: ["city", "town", "village", "hamlet", "isolated_dwelling", "farm", "locality"],
  },
  peak: { kind: ["peak", "saddle"] },
  poi: { kind: POI_KINDS },
};

const RELIEF = {
  dem: "dem-shared://{z}/{x}/{y}",
  contours: "dem-contour://{z}/{x}/{y}?test",
};

const style = buildStyle({
  pmtilesUrl: "http://localhost/data/test.pmtiles",
  busstopsUrl: "http://localhost/data/busstops.pmtiles",
  glyphsUrl: "http://localhost/fonts/{fontstack}/{range}.pbf",
  relief: RELIEF,
  visibility: defaultVisibility(),
});

type Json = unknown;

/** Attribute read by `e` if it is ["get", name] or ["coalesce", ["get", name], …]. */
function readAttr(e: Json): string | undefined {
  if (!Array.isArray(e)) return undefined;
  if (e[0] === "get" && typeof e[1] === "string" && e.length === 2) return e[1];
  if (e[0] === "coalesce") return readAttr(e[1]);
  return undefined;
}

interface Use {
  attrs: Set<string>;
  values: [string, string][];
}

/** Collects attribute names and compared literal values from an expression tree. */
function collect(e: Json, use: Use): void {
  if (!Array.isArray(e)) {
    if (e && typeof e === "object") for (const v of Object.values(e)) collect(v, use);
    return;
  }
  const [op] = e;
  if (op === "literal") return;
  if ((op === "get" || op === "has" || op === "!has") && typeof e[1] === "string") {
    if (e.length === 2) use.attrs.add(e[1]);
  }
  const attr = readAttr(e[1]);
  if (attr) {
    if ((op === "==" || op === "!=") && typeof e[2] === "string") use.values.push([attr, e[2]]);
    if (op === "in" && Array.isArray(e[2]) && e[2][0] === "literal") {
      for (const v of e[2][1] as string[]) use.values.push([attr, v]);
    }
    if (op === "match") {
      for (let i = 2; i < e.length - 1; i += 2) {
        const label = e[i];
        for (const v of Array.isArray(label) ? label : [label]) {
          if (typeof v === "string") use.values.push([attr, v]);
        }
      }
    }
  }
  for (const child of e) collect(child, use);
}

describe("style", () => {
  test("validates against the MapLibre style spec", () => {
    const errors = validateStyleMin(style);
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  test("the bus stop source and group exist only with a bus stop file", () => {
    expect(Object.keys(style.sources).sort()).toEqual([
      "busstops",
      "contours",
      "dem",
      "gpx",
      "osm",
      "waymark-signs",
    ]);
    expect(style.layers.some((l) => l.id.startsWith("busstops-"))).toBe(true);
    const without = buildStyle({
      pmtilesUrl: "http://localhost/data/test.pmtiles",
      glyphsUrl: "http://localhost/fonts/{fontstack}/{range}.pbf",
      relief: RELIEF,
      visibility: defaultVisibility(),
    });
    expect(Object.keys(without.sources).sort()).toEqual([
      "contours",
      "dem",
      "gpx",
      "osm",
      "waymark-signs",
    ]);
    expect(without.layers.some((l) => l.id.startsWith("busstops-"))).toBe(false);
    expect(validateStyleMin(without).map((e) => e.message)).toEqual([]);
    // Every layer's source exists in either style.
    for (const s of [style, without]) {
      for (const l of s.layers) if ("source" in l) expect(s.sources[l.source!], l.id).toBeDefined();
    }
  });

  test("the bus stop group has a sidebar toggle and no OSM bus stops remain", () => {
    const g = GROUPS.find((x) => x.id === "busstops");
    expect(g?.label).toBe("Bus stops");
    expect(g?.source).toBe("busstops");
    for (const l of style.layers) {
      if (l.id.startsWith("busstops-")) expect((l as { source: string }).source).toBe("busstops");
      else expect((l as { source?: string }).source).not.toBe("busstops");
    }
    expect(JSON.stringify(style.layers)).not.toContain('bus_stop"]');
  });

  test("the contour group has a toggle and its layers sit between hillshade and water", () => {
    const g = GROUPS.find((x) => x.id === "contours");
    expect(g?.label).toBe("Contour lines");
    expect(g?.source).toBe("contours");
    const ids = style.layers.map((l) => l.id);
    const contourIds = ids.filter((id) => id.startsWith("contours-"));
    expect(contourIds).toEqual(["contours-line", "contours-index", "contours-label"]);
    for (const l of style.layers.filter((x) => x.id.startsWith("contours-"))) {
      expect((l as { source: string }).source).toBe("contours");
      expect((l as { "source-layer": string })["source-layer"]).toBe("contours");
    }
    expect(ids.indexOf("contours-line")).toBeGreaterThan(ids.indexOf("hillshade-relief"));
    expect(ids.indexOf("contours-label")).toBeLessThan(
      ids.findIndex((id) => id.startsWith("water-")),
    );
  });

  test("contour numbers stay out of the print placement and are legible", () => {
    const label = style.layers.find((l) => l.id === "contours-label");
    expect(label?.metadata).toBeUndefined();
    const size = (label as { layout: { "text-size": number } }).layout["text-size"];
    expect(size).toBeGreaterThanOrEqual(pt(6.5));
  });

  test("contour options: thresholds, overzoom and attribute names match the layers", () => {
    expect(CONTOUR_OPTIONS.thresholds).toEqual({ 11: [50, 250], 12: [20, 100], 13: [10, 50] });
    expect(CONTOUR_OPTIONS.overzoom).toBe(1);
    const json = JSON.stringify(style.layers.filter((l) => l.id.startsWith("contours-")));
    expect(json).toContain(`"source-layer":"${CONTOUR_OPTIONS.contourLayer}"`);
    expect(json).toContain(`["get","${CONTOUR_OPTIONS.levelKey}"]`);
    expect(json).toContain(`["get","${CONTOUR_OPTIONS.elevationKey}"]`);
    expect(CONTOUR_OPTIONS.contourLayer).toBe("contours");
    expect(CONTOUR_OPTIONS.elevationKey).toBe("ele");
    expect(CONTOUR_OPTIONS.levelKey).toBe("level");
  });

  test("layer ids are unique and carry their group prefix", () => {
    const ids = style.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GROUPS) {
      for (const layer of g.layers()) expect(layer.id.startsWith(`${g.id}-`)).toBe(true);
    }
  });

  test("no group's prefix captures another group's layers", () => {
    for (const g of GROUPS) {
      for (const other of GROUPS) {
        if (other === g) continue;
        for (const layer of other.layers()) {
          expect(layer.id.startsWith(`${g.id}-`)).toBe(false);
        }
      }
    }
  });

  test("toggle references point at labelled groups", () => {
    for (const g of GROUPS) {
      if (!g.toggledBy) continue;
      const owner = GROUPS.find((o) => o.id === g.toggledBy);
      expect(owner?.label).toBeDefined();
    }
  });

  test("source-layers, attributes and values exist in the tile schema", () => {
    const problems: string[] = [];
    for (const layer of style.layers) {
      if (!("source-layer" in layer)) continue;
      const sl = layer["source-layer"];
      if (!sl || !(sl in SCHEMA)) {
        problems.push(`${layer.id}: unknown source-layer ${sl}`);
        continue;
      }
      const use: Use = { attrs: new Set(), values: [] };
      collect([layer.filter ?? null, layer.layout ?? null, layer.paint ?? null], use);
      for (const a of use.attrs) {
        if (!SCHEMA[sl]!.includes(a)) problems.push(`${layer.id}: unknown attribute ${sl}.${a}`);
      }
      for (const [a, v] of use.values) {
        const allowed = VALUES[sl]?.[a];
        if (allowed && v !== "" && !allowed.includes(v)) {
          problems.push(`${layer.id}: unknown value ${sl}.${a}=${v}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("all text fonts are bundled", () => {
    const bundled = ["Noto Sans Regular", "Noto Sans Italic", "Noto Sans Medium"];
    const fonts = new Set<string>();
    /** Font names are plain string arrays or ["literal", [...]] inside a text-font value. */
    const fontNames = (v: Json): void => {
      if (!Array.isArray(v)) return;
      if (v.every((x) => typeof x === "string") && v[0] !== "literal" && v[0] !== "get") {
        for (const f of v as string[]) fonts.add(f);
      } else if (v[0] === "literal" && Array.isArray(v[1])) {
        for (const f of v[1] as string[]) fonts.add(f);
      } else {
        for (const c of v) fontNames(c);
      }
    };
    const walk = (e: Json): void => {
      if (Array.isArray(e)) for (const c of e) walk(c);
      else if (e && typeof e === "object") {
        for (const [k, v] of Object.entries(e)) {
          if (k === "text-font") fontNames(v);
          else walk(v);
        }
      }
    };
    for (const layer of style.layers) walk(layer.layout ?? {});
    expect(fonts.size).toBeGreaterThan(0);
    expect([...fonts].filter((f) => !bundled.includes(f))).toEqual([]);
  });
});

describe("M6 switches", () => {
  const layersOf = (id: string) => style.layers.filter((l) => l.id.startsWith(`${id}-`));
  const poiFilters = style.layers
    .filter((l) => "source-layer" in l && l["source-layer"] === "poi")
    .map((l) => ({
      id: l.id,
      f: featureFilter((l as { filter?: unknown }).filter as never, l.id),
    }));
  const passing = (props: Record<string, unknown>) =>
    poiFilters
      .filter((x) => x.f.filter({ zoom: 13 } as never, { type: 1, properties: props } as never))
      .map((x) => x.id);

  test("every POI kind lands in exactly one layer (category, viewpoints or poi-main/minor)", () => {
    for (const k of REGISTRY_KINDS) {
      // Parking needs hiking=yes to be shown at all, viewpoints a name; every other kind is
      // unconditional.
      for (const props of [
        { kind: k, name: "x", hiking: true },
        ...(k === "viewpoint" ? [] : [{ kind: k, hiking: true }]),
      ]) {
        expect(passing(props), JSON.stringify(props)).toHaveLength(1);
      }
    }
    // Hidden car parks and unnamed viewpoints are the only ones in no layer.
    expect(passing({ kind: "parking", name: "x" })).toEqual([]);
    expect(passing({ kind: "viewpoint", hiking: true })).toEqual([]);
  });

  test("category kinds are disjoint and their layers belong to their own group", () => {
    const seen = new Set<string>();
    for (const cat of POI_CATEGORIES) {
      for (const k of cat.kinds) {
        expect(seen.has(k), k).toBe(false);
        seen.add(k);
        expect(passing({ kind: k, name: "x", hiking: true })[0]!.startsWith(`${cat.id}-`)).toBe(
          true,
        );
      }
      expect(GROUPS.find((g) => g.id === cat.id)?.label).toBe(cat.label);
      expect(layersOf(cat.id).length).toBeGreaterThan(0);
    }
    // The block sits directly after "poi".
    const ids = GROUPS.map((g) => g.id);
    expect(
      ids.slice(ids.indexOf("poi") + 1, ids.indexOf("poi") + 1 + POI_CATEGORIES.length),
    ).toEqual(POI_CATEGORIES.map((c) => c.id));
    expect(GROUPS.find((g) => g.id === "poi")?.label).toBe("More symbols");
  });

  test("small kinds of a category keep their minor layer, guideposts split by name", () => {
    expect(passing({ kind: "fountain", name: "x" })).toEqual(["drinking-minor"]);
    expect(passing({ kind: "drinking_water" })).toEqual(["drinking-main"]);
    expect(passing({ kind: "memorial" })).toEqual(["heritage-minor"]);
    expect(passing({ kind: "guidepost", name: "Hadeck" })).toEqual(["guideposts-main"]);
    expect(passing({ kind: "guidepost" })).toEqual(["guideposts-minor"]);
    expect(passing({ kind: "parking", hiking: true })).toEqual(["parking-main"]);
    expect(passing({ kind: "parking", area_m2: 4000, access: "customers" })).toEqual([]);
    expect(passing({ kind: "wayside_cross" })).toEqual(["poi-minor"]);
    expect(passing({ kind: "church" })).toEqual(["poi-main"]);
  });

  test("category layers take part in the placement like poi-main did", () => {
    for (const cat of POI_CATEGORIES) {
      for (const l of layersOf(cat.id)) expect(placementRole(l), l.id).toBe("displace");
    }
    const ids = new Set(managedLayers(style.layers).map((m) => m.id));
    expect(ids.has("guideposts-main")).toBe(true);
    expect(ids.has("heritage-minor")).toBe(true);
  });

  describe("band by the network switches (attribute nets)", () => {
    const iwn = { [NETWORK_GROUPS.iwn]: false };
    const noRwn = { [NETWORK_GROUPS.rwn]: false };
    const noLokal = { [NETWORK_GROUPS.lwn]: false };
    const none = {
      [NETWORK_GROUPS.iwn]: false,
      [NETWORK_GROUPS.nwn]: false,
      [NETWORK_GROUPS.rwn]: false,
      [NETWORK_GROUPS.lwn]: false,
    };
    const onlyLokal = {
      [NETWORK_GROUPS.iwn]: false,
      [NETWORK_GROUPS.nwn]: false,
      [NETWORK_GROUPS.rwn]: false,
    };
    const feature = (nets?: string) => ({
      type: 2,
      properties: nets === undefined ? {} : { nets },
    });
    const pass = (vis: Record<string, boolean>, nets?: string) => {
      const f = featureFilter(routeNetworkFilter(vis) as never, "net");
      return f.filter({ zoom: 13 } as never, feature(nets) as never);
    };
    const major = (vis: Record<string, boolean>, nets: string) => {
      const sortKey = routeBandExpressions(vis).sortKey;
      if (typeof sortKey === "number") return false;
      const expr = createExpression(
        sortKey as never,
        (latest as never)["layout_line"]["line-sort-key"],
      );
      if (expr.result !== "success") throw new Error(JSON.stringify(expr.value));
      return expr.value.evaluate({ zoom: 13 } as never, feature(nets) as never) === 1;
    };

    test("all four on: no filter at all", () => {
      expect(routeNetworkFilter({})).toBeNull();
      expect(routeNetworkFilter(defaultVisibility())).toBeNull();
      expect(routeBandExpressions({}).filter).toBeNull();
    });

    test("a segment has a band if at least one of its routes lies in a switched-on network", () => {
      // rwn|lwn: rwn off + lwn on -> visible; rwn on + lwn off -> visible; both off -> invisible.
      expect(pass(noRwn, "rwn|lwn")).toBe(true);
      expect(pass(noLokal, "rwn|lwn")).toBe(true);
      expect(pass({ ...noRwn, ...noLokal }, "rwn|lwn")).toBe(false);
      // Only lwn: gone with lwn off, present with only lwn on.
      expect(pass(noLokal, "lwn")).toBe(false);
      expect(pass(onlyLokal, "lwn")).toBe(true);
      expect(pass(onlyLokal, "iwn|nwn|rwn")).toBe(false);
      expect(pass(onlyLokal, "iwn|lwn")).toBe(true);
      expect(pass(iwn, "iwn")).toBe(false);
      expect(pass(iwn, "iwn|rwn")).toBe(true);
      // The search is exact: no partial matches across the pipes.
      expect(pass(onlyLokal, "lwnx")).toBe(false);
    });

    test("nothing on: nothing; a segment without nets counts as nothing", () => {
      for (const nets of ["iwn", "nwn", "rwn", "lwn", "rwn|lwn", undefined]) {
        expect(pass(none, nets)).toBe(false);
      }
      expect(pass(noRwn, undefined)).toBe(false);
    });

    test("width, opacity and sort key follow the highest VISIBLE network", () => {
      // rwn on: rwn|lwn is major; rwn off: the same segment is only local (lwn).
      expect(major({}, "rwn|lwn")).toBe(true);
      expect(major(noRwn, "rwn|lwn")).toBe(false);
      expect(major(noLokal, "rwn|lwn")).toBe(true);
      expect(major(noLokal, "lwn")).toBe(false);
      expect(major(onlyLokal, "rwn|lwn")).toBe(false);
      expect(major(iwn, "iwn|nwn")).toBe(true);
      // No major network on: constants, no expression.
      const local = routeBandExpressions(onlyLokal);
      expect(local.sortKey).toBe(0);
      expect(local.opacity).toBe(0.58);
      expect(JSON.stringify(local.width)).not.toContain("case");
      expect(JSON.stringify(routeBandExpressions({}).width)).toContain("case");
    });

    test("the style (export) carries the same expressions as the live map", () => {
      const vis = { ...defaultVisibility(), ...noRwn };
      const band = routeBandExpressions(vis);
      const layer = routeLayers(vis)[0] as unknown as {
        filter: unknown;
        layout: Record<string, unknown>;
        paint: Record<string, unknown>;
      };
      expect(layer.filter).toEqual(band.filter);
      expect(layer.layout["line-sort-key"]).toEqual(band.sortKey);
      expect(layer.paint["line-width"]).toEqual(band.width);
      expect(layer.paint["line-opacity"]).toEqual(band.opacity);
      for (const v of [{}, noRwn, onlyLokal, none]) {
        const style = buildStyle({
          pmtilesUrl: "http://localhost/data/test.pmtiles",
          glyphsUrl: "http://localhost/fonts/{fontstack}/{range}.pbf",
          relief: RELIEF,
          visibility: { ...defaultVisibility(), ...v },
        });
        expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
      }
    });
  });

  test("the network switches reach routes-band of the built style", () => {
    const build = (visibility: Record<string, boolean>) =>
      buildStyle({
        pmtilesUrl: "http://localhost/data/test.pmtiles",
        glyphsUrl: "http://localhost/fonts/{fontstack}/{range}.pbf",
        relief: RELIEF,
        visibility: { ...defaultVisibility(), ...visibility },
      });
    const filterOf = (s: typeof style, id: string) =>
      (s.layers.find((l) => l.id === id) as { filter?: unknown }).filter;
    expect(filterOf(build({}), "routes-band")).toBeUndefined();
    const off = build({ [NETWORK_GROUPS.iwn]: false });
    // The filter lists the networks that are on.
    const filter = JSON.stringify(filterOf(off, "routes-band"));
    expect(filter).toContain("|nwn|");
    expect(filter).not.toContain("|iwn|");
    // The waymark signs follow the same switches per route (waymarks/routes.ts), not by a layer filter.
    expect(off.layers.find((l) => l.id === "waymarks-signs")).toBeDefined();
    expect(validateStyleMin(off).map((e) => e.message)).toEqual([]);
  });

  test("sub-switches point at existing, labelled parents; every labelled group has a section", () => {
    for (const g of GROUPS) {
      if (g.parent) {
        const parent = GROUPS.find((p) => p.id === g.parent);
        expect(parent?.label, g.id).toBeDefined();
        expect(parent?.parent).toBeUndefined();
        expect(parent?.section).toBe(g.section);
      }
      if (g.label) {
        expect(g.section, g.id).toBeDefined();
        expect(UI_ORDER.includes(g.id), g.id).toBe(true);
      }
    }
    expect(
      Object.values(NETWORK_GROUPS).every(
        (id) => GROUPS.find((g) => g.id === id)?.parent === "routes",
      ),
    ).toBe(true);
    expect(GROUPS.find((g) => g.id === "guidepostnames")?.parent).toBe("guideposts");
    // Every group of UI_ORDER exists, once; the sections cover all labelled groups.
    expect(new Set(UI_ORDER).size).toBe(UI_ORDER.length);
    const shown = SECTIONS.flatMap((s) => uiGroups(s.id).map((g) => g.id));
    expect(shown.sort()).toEqual(
      GROUPS.filter((g) => g.label)
        .map((g) => g.id)
        .sort(),
    );
  });

  test("waymarks have no switch of their own: they follow the route toggle", () => {
    const g = GROUPS.find((x) => x.id === "waymarks")!;
    expect(g.label).toBeUndefined();
    expect(g.toggledBy).toBe("routes");
    expect(GROUPS.find((x) => x.id === "routes")?.label).toBe("Hiking routes");
  });
});

describe("gpx layers", () => {
  const track: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { _kind: "line" },
        geometry: {
          type: "LineString",
          coordinates: [
            [7.7, 49.1],
            [7.71, 49.11],
          ],
        },
      } as Feature,
    ],
  };

  test("the source exists without a track, and with one when given", () => {
    expect(style.sources.gpx).toEqual({
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const withTrack = buildStyle({
      pmtilesUrl: "http://localhost/data/test.pmtiles",
      glyphsUrl: "http://localhost/fonts/{fontstack}/{range}.pbf",
      relief: RELIEF,
      visibility: defaultVisibility(),
      gpx: track,
    });
    expect((withTrack.sources.gpx as { data: unknown }).data).toBe(track);
    expect(validateStyleMin(withTrack).map((e) => e.message)).toEqual([]);
  });

  test("magenta line in paper mm, between transport and names, start and end fixed", () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf("gpx-line")).toBeGreaterThan(
      ids.map((id) => id.startsWith("transport-")).lastIndexOf(true),
    );
    expect(ids.indexOf("gpx-line")).toBeLessThan(ids.findIndex((id) => id.startsWith("names-")));
    const line = style.layers.find((l) => l.id === "gpx-line") as {
      paint: Record<string, unknown>;
    };
    expect(line.paint["line-color"]).toBe(COLORS.gpx);
    expect(COLORS.gpx).toBe("#d4007f");
    expect(GPX_LINE_MM).toBe(0.7);
    expect(JSON.stringify(line.paint["line-width"])).toContain(String(mm(GPX_LINE_MM)));
    expect(line.paint["line-opacity"]).toBe(0.8);
    for (const id of ["gpx-start", "gpx-end"]) {
      const l = style.layers.find((x) => x.id === id)!;
      expect(placementRole(l)).toBe("fixed");
      expect(l.type).toBe("circle");
      const paint = (l as unknown as { paint: Record<string, number> }).paint;
      // Outer diameter incl. rim = GPX_MARKER_MM.
      expect((paint["circle-radius"]! + paint["circle-stroke-width"]!) * 2).toBeCloseTo(
        mm(GPX_MARKER_MM),
        9,
      );
    }
    expect(placementRole(style.layers.find((l) => l.id === "gpx-line")!)).toBeUndefined();
    const group = GROUPS.find((g) => g.id === "gpx")!;
    expect(group.label).toBeUndefined();
  });
});
