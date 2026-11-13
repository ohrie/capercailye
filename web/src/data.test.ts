import { afterEach, describe, expect, test } from "bun:test";
import { pmtilesExists } from "./data";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const respond = (body: BodyInit | null, status = 200) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("pmtilesExists", () => {
  test("true for a PMTiles archive (magic bytes)", async () => {
    globalThis.fetch = respond("PMTiles\x03rest of the header", 206);
    expect(await pmtilesExists("http://x/b.pmtiles")).toBe(true);
  });

  test("false for a missing file, a SPA fallback page and network errors", async () => {
    globalThis.fetch = respond("Nicht gefunden", 404);
    expect(await pmtilesExists("http://x/b.pmtiles")).toBe(false);
    globalThis.fetch = respond("<!doctype html><title>app</title>", 200);
    expect(await pmtilesExists("http://x/b.pmtiles")).toBe(false);
    globalThis.fetch = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await pmtilesExists("http://x/b.pmtiles")).toBe(false);
  });
});
