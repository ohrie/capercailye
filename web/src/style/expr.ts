// Small expression helpers shared by the style builders.
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

/** Boolean tile attributes are either `true` or absent (tiles/SCHEMA.md). */
export function flag(name: string): ExpressionSpecification {
  return ["==", ["get", name], true];
}

export function not(e: ExpressionSpecification): ExpressionSpecification {
  return ["!", e];
}

export function all(...es: ExpressionSpecification[]): ExpressionSpecification {
  return es.length === 1 ? es[0]! : ["all", ...es];
}

export function any(...es: ExpressionSpecification[]): ExpressionSpecification {
  return es.length === 1 ? es[0]! : ["any", ...es];
}

/** String attribute is one of `values` (false when missing). */
export function attrIn(name: string, ...values: string[]): ExpressionSpecification {
  return ["in", ["coalesce", ["get", name], ""], ["literal", values]];
}

export function kindIn(...kinds: string[]): ExpressionSpecification {
  return attrIn("kind", ...kinds);
}

/**
 * `match` on an attribute from a table of [values, output] pairs; `fallback` when no row fits.
 * Typed loosely because MapLibre's tuple types cannot express variadic match arms.
 */
export function matchAttr(
  name: string,
  rows: [string | string[], unknown][],
  fallback: unknown,
): ExpressionSpecification {
  return [
    "match",
    ["coalesce", ["get", name], ""],
    ...rows.flatMap(([values, out]) => [values, out]),
    fallback,
  ] as unknown as ExpressionSpecification;
}

/** `case` chain from [condition, output] pairs. */
export function cases(
  rows: [ExpressionSpecification, unknown][],
  fallback: unknown,
): ExpressionSpecification {
  return [
    "case",
    ...rows.flatMap(([c, out]) => [c, out]),
    fallback,
  ] as unknown as ExpressionSpecification;
}
