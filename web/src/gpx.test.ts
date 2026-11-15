import { describe, expect, test } from "bun:test";
import type { Feature, FeatureCollection } from "geojson";
import { areaForTrack, normalizeTrack, trackLengthKm, type Position } from "./gpx";

const line = (coordinates: number[][], name?: string): Feature => ({
  type: "Feature",
  properties: name ? { name } : {},
  geometry: { type: "LineString", coordinates },
});
const fc = (...features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });

const kinds = (data: FeatureCollection, kind: string) =>
  data.features.filter((f) => f.properties?._kind === kind);

describe("normalizeTrack", () => {
  test("a single track: start = first point, end = last point, elevation dropped", () => {
    const r = normalizeTrack(
      fc(
        line(
          [
            [7.7, 49.1, 300],
            [7.71, 49.11, 310],
            [7.72, 49.1, 305],
          ],
          "Rundweg",
        ),
      ),
    );
    if (!("track" in r)) throw new Error(r.error);
    expect(r.track.name).toBe("Rundweg");
    expect(r.track.bounds).toEqual([7.7, 49.1, 7.72, 49.11]);
    const [ln] = kinds(r.track.data, "line");
    expect(ln!.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [7.7, 49.1],
        [7.71, 49.11],
        [7.72, 49.1],
      ],
    });
    expect(kinds(r.track.data, "start")[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [7.7, 49.1],
    });
    expect(kinds(r.track.data, "end")[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [7.72, 49.1],
    });
    expect(kinds(r.track.data, "start")[0]!.id).not.toBe(kinds(r.track.data, "end")[0]!.id);
  });

  test("a MultiLineString and several tracks: start of the first, end of the last", () => {
    const multi: Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [1, 50],
            [1.1, 50.1],
          ],
          [
            [1.2, 50.2],
            [1.3, 50.3],
          ],
        ],
      },
    };
    const a = normalizeTrack(fc(multi));
    if (!("track" in a)) throw new Error(a.error);
    expect(kinds(a.track.data, "start")[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [1, 50],
    });
    expect(kinds(a.track.data, "end")[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [1.3, 50.3],
    });
    expect(a.track.name).toBe("GPX track");

    const b = normalizeTrack(
      fc(
        line([
          [1, 50],
          [1.1, 50.1],
        ]),
        line([
          [2, 51],
          [2.2, 51.2],
        ]),
      ),
      "Datei",
    );
    if (!("track" in b)) throw new Error(b.error);
    expect(b.track.name).toBe("Datei");
    expect(kinds(b.track.data, "line")).toHaveLength(2);
    expect(kinds(b.track.data, "start")[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [1, 50],
    });
    expect(kinds(b.track.data, "end")[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [2.2, 51.2],
    });
    expect(b.track.bounds).toEqual([1, 50, 2.2, 51.2]);
  });

  test("waypoints are ignored; only waypoints (or nothing) is an error", () => {
    const wpt: Feature = {
      type: "Feature",
      properties: { name: "Gipfel" },
      geometry: { type: "Point", coordinates: [7, 49] },
    };
    expect(normalizeTrack(fc(wpt))).toEqual({ error: "No track in the file" });
    expect(normalizeTrack(fc())).toEqual({ error: "No track in the file" });
    // A line with a single point is no track either.
    expect(normalizeTrack(fc(line([[7, 49]])))).toEqual({ error: "No track in the file" });
    const mixed = normalizeTrack(
      fc(
        wpt,
        line([
          [7, 49],
          [7.1, 49.1],
        ]),
      ),
    );
    if (!("track" in mixed)) throw new Error(mixed.error);
    expect(mixed.track.data.features).toHaveLength(3);
  });
});

describe("trackLengthKm", () => {
  test("one degree of latitude is about 111.2 km", () => {
    expect(
      trackLengthKm([
        [
          [7, 49],
          [7, 50],
        ],
      ]),
    ).toBeCloseTo(111.19, 1);
  });

  test("a diagonal stretch matches a flat-earth estimate within 1 %", () => {
    // Flat-earth estimate for 0.035 deg north and 0.0568 deg east at 49.17 N (about 5.7 km).
    const a: Position = [7.7742, 49.1505];
    const b: Position = [7.831, 49.1855];
    const expected = Math.hypot(
      0.035 * 111.195,
      0.0568 * 111.195 * Math.cos((49.168 * Math.PI) / 180),
    );
    const km = trackLengthKm([[a, b]]);
    expect(Math.abs(km - expected) / expected).toBeLessThan(0.01);
    expect(trackLengthKm([[a, b]])).toBeCloseTo(trackLengthKm([[b, a]]), 9);
  });

  test("segments add up, no gap is measured between them", () => {
    const seg: Position[] = [
      [7, 49],
      [7, 49.01],
    ];
    const one = trackLengthKm([seg]);
    expect(
      trackLengthKm([
        seg,
        [
          [8, 50],
          [8, 50.01],
        ],
      ]),
    ).toBeCloseTo(2 * one, 2);
  });
});

describe("areaForTrack", () => {
  const mPerDegLat = 111_195;

  test("10 % per side for a large track", () => {
    const a = areaForTrack([7.7, 49.1, 7.8, 49.2]);
    expect(a.west).toBeCloseTo(7.69, 9);
    expect(a.east).toBeCloseTo(7.81, 9);
    expect(a.south).toBeCloseTo(49.09, 9);
    expect(a.north).toBeCloseTo(49.21, 9);
  });

  test("at least 300 m on each side for tiny or degenerate tracks", () => {
    const a = areaForTrack([7.7, 49.1, 7.7, 49.1]);
    expect(((a.north - a.south) * mPerDegLat) / 2).toBeGreaterThanOrEqual(299);
    const mPerDegLon = mPerDegLat * Math.cos((49.1 * Math.PI) / 180);
    expect(((a.east - a.west) * mPerDegLon) / 2).toBeGreaterThanOrEqual(299);
    // 1 km wide: 10 % = 100 m < 300 m.
    const b = areaForTrack([7.7, 49.1, 7.7 + 1000 / mPerDegLon, 49.1 + 1000 / mPerDegLat]);
    expect(((b.north - b.south) * mPerDegLat - 1000) / 2).toBeCloseTo(300, 0);
  });
});
