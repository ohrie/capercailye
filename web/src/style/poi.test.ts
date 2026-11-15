import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateStyleMin, type StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { POI_ICONS, POI_KINDS } from "../icons/registry";
import { busstopLayers, MINOR_KINDS, NAMED_KINDS, PRIORITY, poiLayers } from "./poi";
import { OSM_SOURCE } from "./sources";

const SCHEMA = readFileSync(new URL("../../../tiles/SCHEMA.md", import.meta.url), "utf8");
const POI_SECTION = SCHEMA.slice(SCHEMA.indexOf("## `poi`"), SCHEMA.indexOf("### Densities"));

/** Attributes of the poi layer: common ones plus the "extra attrs" column (outside parentheses). */
function schemaPoiAttributes(): Set<string> {
  const attrs = new Set(["kind", "rank", "name", "ele"]);
  for (const line of POI_SECTION.split("\n")) {
    const cells = line.split(" | ");
    if (!line.startsWith("| `") || cells.length < 4) continue;
    let extra = cells[3]!;
    while (/\([^()]*\)/.test(extra)) extra = extra.replace(/\([^()]*\)/g, "");
    for (const m of extra.matchAll(/`([a-z_0-9]+)`/g)) attrs.add(m[1]!);
  }
  return attrs;
}

/** Collects ["get", x] / ["has", x] attribute names and all string literals of an expression. */
function walk(value: unknown, attrs: Set<string>, strings: Set<string>): void {
  if (Array.isArray(value)) {
    if ((value[0] === "get" || value[0] === "has") && typeof value[1] === "string") {
      attrs.add(value[1]);
    }
    for (const v of value) walk(v, attrs, strings);
  } else if (typeof value === "string") {
    strings.add(value);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) walk(v, attrs, strings);
  }
}

describe("poiLayers", () => {
  const layers = poiLayers();

  test("validates as a style", () => {
    const style = {
      version: 8,
      glyphs: "https://example.invalid/{fontstack}/{range}.pbf",
      sources: { [OSM_SOURCE]: { type: "vector", url: "pmtiles://example.invalid/x.pmtiles" } },
      layers,
    } as StyleSpecification;
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  test("ids, source layer and collision settings", () => {
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.length).toBeLessThanOrEqual(4);
    for (const l of layers) {
      expect(l.id.startsWith("poi-")).toBe(true);
      expect(l.type).toBe("symbol");
      if (l.type !== "symbol") continue;
      expect(l["source-layer"]).toBe("poi");
      expect(l.layout?.["icon-allow-overlap"] ?? false).toBe(false);
      expect(l.layout?.["symbol-sort-key"]).toBeDefined();
      if (l.layout?.["text-field"]) expect(l.layout["text-optional"]).toBe(true);
    }
  });

  test("filters and layout only use attributes from tiles/SCHEMA.md", () => {
    const allowed = schemaPoiAttributes();
    expect(allowed.has("area_m2")).toBe(true);
    expect(allowed.has("hiking")).toBe(true);
    for (const l of layers) {
      const attrs = new Set<string>();
      walk([(l as { filter?: unknown }).filter, l.layout], attrs, new Set());
      for (const a of attrs) expect(allowed.has(a), `${l.id}: ${a}`).toBe(true);
    }
  });

  test("OSM bus stops are gone from tiles, schema and style", () => {
    expect(SCHEMA).not.toMatch(/^\| `bus_stop` \|/m);
    expect((POI_KINDS as readonly string[]).includes("bus_stop")).toBe(false);
    expect(POI_ICONS.bus_stop).toBeUndefined();
    expect(Object.keys(PRIORITY)).not.toContain("bus_stop");
    expect(MINOR_KINDS as string[]).not.toContain("bus_stop");
  });

  test("kind lists only contain schema kinds", () => {
    const kinds = new Set<string>(POI_KINDS);
    for (const k of [...NAMED_KINDS, ...MINOR_KINDS, ...Object.keys(PRIORITY)]) {
      expect(kinds.has(k), k).toBe(true);
    }
  });

  test("text fonts exist in public/fonts", () => {
    const fonts = new Set<string>();
    for (const l of layers) {
      const f = (l.layout as Record<string, unknown> | undefined)?.["text-font"];
      if (Array.isArray(f)) for (const name of f) fonts.add(name as string);
    }
    for (const name of fonts) {
      const glyphs = new URL(`../../public/app/fonts/${name}/0-255.pbf`, import.meta.url);
      expect(Bun.file(glyphs).size, name).toBeGreaterThan(0);
    }
  });

  test("every image id the layers can produce is registered", () => {
    const strings = new Set<string>();
    for (const l of layers) walk(l.layout, new Set(), strings);
    for (const s of strings) {
      if (s.startsWith("poi:") && s.length > 4) expect(POI_ICONS[s.slice(4)], s).toBeDefined();
    }
    // ["concat", "poi:", ["get", "kind"]] covers every kind.
    for (const k of POI_KINDS) expect(POI_ICONS[k], k).toBeDefined();
  });
});

describe("busstopLayers", () => {
  const layers = busstopLayers();

  test("validates as a style with its own source", () => {
    const style = {
      version: 8,
      glyphs: "https://example.invalid/{fontstack}/{range}.pbf",
      sources: { busstops: { type: "vector", url: "pmtiles://example.invalid/b.pmtiles" } },
      layers,
    } as StyleSpecification;
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  test("one displaced symbol layer on the bus_stop source layer, without names", () => {
    expect(layers).toHaveLength(1);
    const l = layers[0]!;
    expect(l.id).toBe("busstops-main");
    if (l.type !== "symbol") throw new Error("symbol layer expected");
    expect(l.source).toBe("busstops");
    expect(l["source-layer"]).toBe("bus_stop");
    expect(l.metadata).toEqual({ "capercailye:placement": "displace" });
    expect(l.layout?.["icon-image"]).toBe("poi:busstop");
    expect(l.layout?.["icon-allow-overlap"]).toBe(false);
    expect(l.layout?.["text-field"]).toBeUndefined();
    const attrs = new Set<string>();
    walk([l.filter, l.layout], attrs, new Set());
    expect([...attrs].every((a) => ["name", "sat", "sun", "min"].includes(a))).toBe(true);
  });

  test("the icon exists and is a plain symbol of print size", () => {
    expect(POI_ICONS.busstop).toBeDefined();
    expect(POI_ICONS.busstop!.style).toBe("plain");
  });
});
