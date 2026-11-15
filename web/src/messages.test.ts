import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type Catalog = Record<string, unknown>;

const dir = join(import.meta.dir, "..", "messages");
const load = (locale: string): Catalog =>
  JSON.parse(readFileSync(join(dir, `${locale}.json`), "utf8")) as Catalog;

const en = load("en");
const de = load("de");

/** Message keys (the file's `$schema` entry is no message). */
const keysOf = (catalog: Catalog): string[] => Object.keys(catalog).filter((k) => k !== "$schema");

/** All text variants of a message: the string itself, or every `match` value of a variant message. */
function variants(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((v: { match?: Record<string, string> }) => Object.values(v.match ?? {}));
  }
  return [];
}

/** Declared inputs of a variant message (`input count`). */
function declaredInputs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v: { declarations?: string[] }) =>
    (v.declarations ?? []).flatMap((d) => (d.startsWith("input ") ? [d.slice(6).trim()] : [])),
  );
}

/** `{name}` placeholders of a message, sorted, with the declared inputs of variant messages. */
function placeholders(value: unknown): string[] {
  const names = new Set<string>(declaredInputs(value));
  for (const text of variants(value)) {
    for (const m of text.matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  }
  return [...names].sort();
}

describe("message catalogs", () => {
  test("en.json and de.json have exactly the same keys", () => {
    expect(keysOf(de).sort()).toEqual(keysOf(en).sort());
    expect(keysOf(en).length).toBeGreaterThan(100);
  });

  test("no empty values", () => {
    for (const [name, catalog] of [
      ["en", en],
      ["de", de],
    ] as const) {
      for (const key of keysOf(catalog)) {
        const texts = variants(catalog[key]);
        expect(texts.length, `${name}.${key} has no text`).toBeGreaterThan(0);
        for (const text of texts) expect(text.trim(), `${name}.${key}`).not.toBe("");
      }
    }
  });

  test("the placeholders of every key are the same in both languages", () => {
    for (const key of keysOf(en)) {
      expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
    }
  });

  test("every variant of a plural message uses the count it declares", () => {
    for (const catalog of [en, de]) {
      for (const key of keysOf(catalog)) {
        const value = catalog[key];
        if (!Array.isArray(value)) continue;
        expect(declaredInputs(value), key).toContain("count");
        for (const text of variants(value)) expect(text, key).toContain("{count}");
      }
    }
  });

  test("keys used in the markup (t(...), data-i18n) exist", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const path = join(d, name);
        if (statSync(path).isDirectory()) {
          if (name !== "paraglide") walk(path);
        } else if (name.endsWith(".astro")) {
          files.push(path);
        }
      }
    };
    walk(join(import.meta.dir));
    expect(files.length).toBeGreaterThan(0);
    const known = new Set(keysOf(en));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const used = [
        ...[...source.matchAll(/\bt\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]!),
        ...[...source.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z0-9_]+)"/g)].map((m) => m[1]!),
        ...[...source.matchAll(/^\s*"((?:landing|legal)_[a-z0-9_]+)",?$/gm)].map((m) => m[1]!),
        ...[...source.matchAll(/\["((?:landing|legal)_[a-z0-9_]+)",/g)].map((m) => m[1]!),
      ];
      for (const key of used) expect(known.has(key), `${file}: ${key}`).toBe(true);
    }
  });
});
