import { describe, expect, test } from "bun:test";
import { parsePhoton, photonUrl } from "./search";

describe("photonUrl", () => {
  test("carries only q, lang, limit and the rounded centre", () => {
    const url = new URL(photonUrl("Dahn", { lng: 7.776543, lat: 49.150498 }));
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api");
    expect([...url.searchParams.keys()]).toEqual(["q", "lang", "limit", "lat", "lon"]);
    expect(url.searchParams.get("q")).toBe("Dahn");
    expect(url.searchParams.get("lang")).toBe("de");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(url.searchParams.get("lat")).toBe("49.150");
    expect(url.searchParams.get("lon")).toBe("7.777");
  });

  test("umlauts and spaces are percent-encoded and decode back", () => {
    const raw = photonUrl("Müllenbach Bärenbrunnen", { lng: -0.0004, lat: 49.1 });
    expect(raw).toContain("q=M%C3%BCllenbach+B%C3%A4renbrunnen");
    expect(new URL(raw).searchParams.get("q")).toBe("Müllenbach Bärenbrunnen");
    expect(new URL(raw).searchParams.get("lon")).toBe("-0.000");
  });
});

const FIXTURE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.7742, 49.1505] },
      properties: {
        name: "Dahn",
        osm_key: "place",
        osm_value: "town",
        county: "Südwestpfalz",
        state: "Rheinland-Pfalz",
        // Photon: [minLon, maxLat, maxLon, minLat]
        extent: [7.74, 49.18, 7.84, 49.12],
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.7861, 49.1302] },
      properties: {
        name: "Hermersbergerhof Gipfel",
        osm_key: "natural",
        osm_value: "peak",
        city: "Dahn",
        state: "Rheinland-Pfalz",
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.77, 49.15] },
      properties: { street: "Hauptstraße", housenumber: "12", osm_key: "building", city: "Dahn" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.0, 49.0] },
      properties: { osm_key: "building", city: "Nirgendwo" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.1, 49.1] },
      properties: { name: "Etwas", osm_key: "unbekannt", osm_value: "xyz", extent: [1, 2, 3] },
    },
    { type: "Feature", geometry: null, properties: { name: "Ohne Ort" } },
  ],
};

describe("parsePhoton", () => {
  const results = parsePhoton(FIXTURE);

  test("a place with an extent gets bounds in west/south/east/north order", () => {
    const dahn = results[0]!;
    expect(dahn.label).toBe("Dahn");
    expect(dahn.center).toEqual([7.7742, 49.1505]);
    expect(dahn.bounds).toEqual([7.74, 49.12, 7.84, 49.18]);
    expect(dahn.detail).toBe("Südwestpfalz, Rheinland-Pfalz · Stadt");
  });

  test("a peak without an extent has no bounds, its place is shown before the kind", () => {
    const peak = results[1]!;
    expect(peak.label).toBe("Hermersbergerhof Gipfel");
    expect(peak.bounds).toBeUndefined();
    expect(peak.detail).toBe("Dahn, Rheinland-Pfalz · Gipfel");
  });

  test("a hit without name is shown as street and house number, or left out", () => {
    expect(results[2]!.label).toBe("Hauptstraße 12");
    expect(results.map((r) => r.label)).not.toContain("Nirgendwo");
    // Unknown kind: omitted; a malformed extent is ignored; a hit without geometry is skipped.
    const other = results.find((r) => r.label === "Etwas")!;
    expect(other.detail).toBe("");
    expect(other.bounds).toBeUndefined();
    expect(results).toHaveLength(4);
  });

  test("garbage in, empty list out", () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({})).toEqual([]);
    expect(parsePhoton({ features: "x" })).toEqual([]);
  });
});
