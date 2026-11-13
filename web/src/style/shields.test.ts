import { describe, expect, test } from "bun:test";
import { buildStyle, defaultVisibility, GROUPS } from "./index";
import { nameLayers } from "./labels";
import { shieldLayers, shieldSvg, parseShields, withoutShieldRefs } from "./shields";
import { svgForImageId } from "../icons/runtime";
import { COLORS } from "./palette";
import { mm } from "./units";

// Evaluates the filter subset used by hasShieldRef on a plain ref string.
function matches(filter: unknown, props: Record<string, unknown>): boolean {
  const ev = (e: unknown): unknown => {
    if (!Array.isArray(e)) return e;
    const [op, ...a] = e as [string, ...unknown[]];
    switch (op) {
      case "all":
        return a.every((x) => ev(x));
      case "any":
        return a.some((x) => ev(x));
      case "!":
        return !ev(a[0]);
      case "has":
        return a[0] !== undefined && (a[0] as string) in props;
      case "get":
        return props[a[0] as string];
      case "to-string":
        return String(ev(a[0]));
      case "coalesce":
        return a.map((x) => ev(x)).find((v) => v !== undefined && v !== null);
      case "slice":
        return (ev(a[0]) as string).slice(ev(a[1]) as number, ev(a[2]) as number);
      case "index-of":
        return (ev(a[1]) as string).indexOf(ev(a[0]) as string);
      case ">=":
        return (ev(a[0]) as number) >= (ev(a[1]) as number);
      case "==":
        return ev(a[0]) === ev(a[1]);
      case "in":
        return (ev(a[1]) as unknown[]).includes(ev(a[0]));
      case "literal":
        return a[0];
      default:
        throw new Error(`unsupported op ${op}`);
    }
  };
  return ev(filter) === true;
}

describe("shields", () => {
  const layer = shieldLayers()[0]!;
  const filter = "filter" in layer ? layer.filter : undefined;

  test("layer exists in its own group, follows the label toggle, sits above names", () => {
    expect(layer.id).toBe("shields-road");
    const i = GROUPS.findIndex((g) => g.id === "shields");
    expect(GROUPS[i]?.toggledBy).toBe("labels");
    expect(i).toBeGreaterThan(GROUPS.findIndex((g) => g.id === "names"));
    const style = buildStyle({ pmtilesUrl: "x", glyphsUrl: "y", visibility: defaultVisibility() });
    expect(style.layers.some((l) => l.id === "shields-road")).toBe(true);
  });

  test("layer is an upright symbol along the line", () => {
    expect(layer.type).toBe("symbol");
    const layout = (layer as { layout: Record<string, unknown> }).layout;
    expect(layout["symbol-placement"]).toBe("line");
    expect(layout["icon-rotation-alignment"]).toBe("viewport");
  });

  test("filter selects A and B refs only", () => {
    const hit = (kind: string, ref?: string) =>
      matches(filter, ref === undefined ? { kind } : { kind, ref });
    expect(hit("motorway", "A 8")).toBe(true);
    expect(hit("trunk", "B 10")).toBe(true);
    expect(hit("primary", "B 32")).toBe(true);
    expect(hit("motorway", "A 8;B 10")).toBe(true);
    expect(hit("primary", "L 415;B 10")).toBe(true);
    expect(hit("secondary", "L 415")).toBe(false);
    expect(hit("tertiary", "K 8206")).toBe(false);
    expect(hit("primary", "KA 3")).toBe(false);
    expect(hit("motorway")).toBe(false);
    expect(matches(filter, { kind: "path", ref: "B 3" })).toBe(false);
    expect(matches(filter, { kind: "primary", rail: true, ref: "B 3" })).toBe(false);
  });

  test("plain number layer drops exactly the A/B refs", () => {
    const patched = withoutShieldRefs(nameLayers()).find((l) => l.id === "names-road-ref")!;
    const f = (patched as { filter: unknown }).filter;
    expect(matches(f, { kind: "secondary", ref: "L 415" })).toBe(true);
    expect(matches(f, { kind: "tertiary", ref: "K 8206" })).toBe(true);
    expect(matches(f, { kind: "motorway", ref: "A 81" })).toBe(false);
    expect(matches(f, { kind: "primary", ref: "B 32" })).toBe(false);
  });

  test("parses refs: Autobahn first, duplicates dropped, others ignored", () => {
    expect(parseShields("A 8")).toEqual([{ kind: "motorway", number: "8" }]);
    expect(parseShields("B 10;A 8;E 52;L 1")).toEqual([
      { kind: "motorway", number: "8" },
      { kind: "federal", number: "10" },
    ]);
    expect(parseShields("A 8;A 8")).toHaveLength(1);
    expect(parseShields("B 27a")[0]?.number).toBe("27a");
    expect(parseShields("L 415")).toEqual([]);
  });

  test("SVG: colours, paper size and registered provider", () => {
    const a = shieldSvg("A 81")!;
    expect(a.svg).toContain(COLORS.shieldMotorway);
    expect(a.svg).toContain(`fill="${COLORS.shieldMotorwayText}"`);
    expect(a.svg).toContain(">81</text>");
    expect(a.height).toBeCloseTo(mm(3.8), 5);
    const b = shieldSvg("B 32")!;
    expect(b.svg).toContain(COLORS.shieldFederal);
    expect(b.svg).toContain(`fill="${COLORS.shieldFederalText}"`);
    expect(b.svg).not.toContain(COLORS.shieldMotorway);
    const both = shieldSvg("A 8;B 10")!;
    expect(both.width).toBeGreaterThan(shieldSvg("A 8")!.width);
    expect(shieldSvg("L 415")).toBeUndefined();
    expect(svgForImageId("shield:A 8")).toBeDefined();
    expect(svgForImageId("shield:L 415")).toBeUndefined();
  });
});
