import { describe, expect, test } from "bun:test";
import { BUSSTOPS_CREDIT, OSM_CREDIT, RELIEF_CREDIT } from "./config";
import { buildCredits, creditText, formatStand, gtfsStand, osmStand } from "./credits";

describe("credits", () => {
  test("formatStand takes the UTC date part", () => {
    expect(formatStand("2026-11-12T21:23:05Z")).toBe("12.11.2026");
    expect(formatStand("2026-08-02")).toBe("02.08.2026");
    expect(formatStand("gestern")).toBeUndefined();
  });

  test("osmStand reads the Planetiler key", () => {
    expect(osmStand({ "planetiler:osm:osmosisreplicationtime": "2026-11-12T21:23:05Z" })).toBe(
      "12.11.2026",
    );
    expect(osmStand({ name: "x" })).toBeUndefined();
    expect(osmStand(undefined)).toBeUndefined();
    expect(osmStand({ "planetiler:osm:osmosisreplicationtime": 5 })).toBeUndefined();
  });

  test("gtfsStand reads feed_date from the description", () => {
    expect(gtfsStand({ description: "capercailye bus stops; feed_date=2026-11-07" })).toBe(
      "07.11.2026",
    );
    expect(gtfsStand({ description: "capercailye bus stops" })).toBeUndefined();
    expect(gtfsStand({})).toBeUndefined();
    expect(gtfsStand(null)).toBeUndefined();
  });

  test("pattern: name (licence, Stand date); without a date only the Stand drops out", () => {
    expect(creditText(OSM_CREDIT, "12.11.2026")).toBe(
      "© OpenStreetMap-Mitwirkende (ODbL, Stand 12.11.2026)",
    );
    expect(creditText(OSM_CREDIT)).toBe("© OpenStreetMap-Mitwirkende (ODbL)");
    expect(creditText({ name: "Quelle" })).toBe("Quelle");
  });

  test("the website texts carry the dates", () => {
    const c = buildCredits({ osm: "12.11.2026", gtfs: "07.11.2026" });
    expect(c.osm).toBe("© OpenStreetMap-Mitwirkende (ODbL, Stand 12.11.2026)");
    expect(c.busstops).toBe("Fahrplandaten: DELFI e.V. / gtfs.de (CC BY 4.0, Stand 07.11.2026)");
    if (RELIEF_CREDIT.stand) expect(c.relief).toContain(`Stand ${RELIEF_CREDIT.stand}`);
    expect(c.sidebar).toContain(c.osm);
    expect(c.sidebar).toContain(c.relief);
    expect(c.sidebar).toContain(c.busstops);
    expect(c.sidebar.endsWith("Suche: Photon (komoot)")).toBe(true);
  });

  test("the PDF line never has a data date", () => {
    const withDates = buildCredits({ osm: "12.11.2026", gtfs: "07.11.2026" });
    const without = buildCredits();
    expect(withDates.line).toBe(without.line);
    expect(withDates.line).not.toContain("Stand");
    expect(withDates.line).toBe(
      [
        creditText(OSM_CREDIT),
        creditText({ ...RELIEF_CREDIT, stand: undefined }),
        creditText(BUSSTOPS_CREDIT),
      ].join(" · "),
    );
  });

  test("without dates and without the bus stop file", () => {
    const c = buildCredits({ busstopsAvailable: false, relief: { name: "Relief: X" } });
    expect(c.line).toBe("© OpenStreetMap-Mitwirkende (ODbL) · Relief: X");
    expect(c.sidebar).toBe(`${c.line} · Suche: Photon (komoot)`);
  });
});
