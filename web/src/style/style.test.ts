// Non-visual checks of the composed style: spec validity, layer id rules, and that every
// source-layer / attribute / enumerated value used in expressions exists in tiles/SCHEMA.md.
// A typo in any of these would not fail at runtime, it would silently render nothing.
import { describe, expect, test } from "bun:test";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { buildStyle, defaultVisibility, GROUPS } from "./index";
import { CONTOUR_OPTIONS } from "./sources";
import { pt } from "./units";

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
  routes: ["symbols", "refs", "names", "colours", "network", "count"],
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
    expect(Object.keys(style.sources).sort()).toEqual(["busstops", "contours", "dem", "osm"]);
    expect(style.layers.some((l) => l.id.startsWith("busstops-"))).toBe(true);
    const without = buildStyle({
      pmtilesUrl: "http://localhost/data/test.pmtiles",
      glyphsUrl: "http://localhost/fonts/{fontstack}/{range}.pbf",
      relief: RELIEF,
      visibility: defaultVisibility(),
    });
    expect(Object.keys(without.sources).sort()).toEqual(["contours", "dem", "osm"]);
    expect(without.layers.some((l) => l.id.startsWith("busstops-"))).toBe(false);
    expect(validateStyleMin(without).map((e) => e.message)).toEqual([]);
    // Every layer's source exists in either style.
    for (const s of [style, without]) {
      for (const l of s.layers) if ("source" in l) expect(s.sources[l.source!], l.id).toBeDefined();
    }
  });

  test("the bus stop group has a sidebar toggle and no OSM bus stops remain", () => {
    const g = GROUPS.find((x) => x.id === "busstops");
    expect(g?.label).toBe("Bushaltestellen");
    expect(g?.source).toBe("busstops");
    for (const l of style.layers) {
      if (l.id.startsWith("busstops-")) expect((l as { source: string }).source).toBe("busstops");
      else expect((l as { source?: string }).source).not.toBe("busstops");
    }
    expect(JSON.stringify(style.layers)).not.toContain('bus_stop"]');
  });

  test("the contour group has a toggle and its layers sit between hillshade and water", () => {
    const g = GROUPS.find((x) => x.id === "contours");
    expect(g?.label).toBe("Höhenlinien");
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
