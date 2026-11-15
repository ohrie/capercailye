import { describe, expect, test } from "bun:test";
import { OSM_CREDIT, RELIEF_CREDIT, RELIEF_CREDITS } from "./config";
import {
  buildCredits,
  creditHtml,
  creditPrint,
  creditText,
  formatStand,
  gtfsStand,
  osmStand,
  partText,
} from "./credits";

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

  test("creditHtml links the name and escapes everything", () => {
    expect(creditHtml(OSM_CREDIT, "12.11.2026")).toBe(
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">' +
        "© OpenStreetMap-Mitwirkende</a> (ODbL, Stand 12.11.2026)",
    );
    expect(creditHtml({ name: "A & <b>", license: '"x"' })).toBe(
      "A &amp; &lt;b&gt; (&quot;x&quot;)",
    );
  });

  test("the website texts carry the dates; OSM links to its copyright page, the rest to /quellen/", () => {
    const c = buildCredits({ osm: "12.11.2026", gtfs: "07.11.2026" });
    expect(c.osm).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(c.osm).toContain("(ODbL, Stand 12.11.2026)");
    expect(c.busstops).toContain('href="/quellen/"');
    expect(c.busstops).toContain("Fahrplandaten: DELFI e.V. / gtfs.de, ausgewertet</a>");
    expect(c.busstops).toContain("(CC BY 4.0, Stand 07.11.2026)");
    expect(c.relief).toContain('href="/quellen/"');
    expect(c.relief).toContain("bearbeitet</a>");
    if (RELIEF_CREDIT.stand) expect(c.relief).toContain(`Stand ${RELIEF_CREDIT.stand}`);
    const text = c.sidebar.map(partText);
    expect(text[0]).toBe("© OpenStreetMap-Mitwirkende (ODbL, Stand 12.11.2026)");
    expect(text[2]).toBe(
      "Fahrplandaten: DELFI e.V. / gtfs.de, ausgewertet (CC BY 4.0, Stand 07.11.2026)",
    );
    expect(text.at(-1)).toBe("Suche: Photon (komoot)");
    expect(c.sidebar.map((p) => p.href)).toEqual([
      "https://www.openstreetmap.org/copyright",
      "/quellen/",
      "/quellen/",
      undefined,
    ]);
  });

  test("every relief credit says it is modified and links to the sources page", () => {
    for (const [area, credit] of Object.entries(RELIEF_CREDITS)) {
      expect(credit.name, area).toContain("bearbeitet");
      expect(credit.href, area).toBe("/quellen/");
      expect(credit.print, area).toContain("bearbeitet");
    }
    expect(RELIEF_CREDIT.name).toContain("bearbeitet");
  });

  test("the PDF line never has a data date and names OSM URL, modification and sources page", () => {
    const withDates = buildCredits({ osm: "12.11.2026", gtfs: "07.11.2026", host: "example.org" });
    const without = buildCredits({ host: "example.org" });
    expect(withDates.line).toBe(without.line);
    expect(withDates.line).not.toContain("Stand");
    expect(withDates.line).toBe(
      [
        "© OpenStreetMap-Mitwirkende (ODbL), openstreetmap.org/copyright",
        creditPrint(RELIEF_CREDIT),
        "Fahrplandaten: DELFI/gtfs.de, ausgewertet (CC BY 4.0)",
        "Lizenzen: example.org/quellen",
      ].join(" · "),
    );
    expect(withDates.line).toContain("bearbeitet");
  });

  test("without a host the pointer to the sources page is left out", () => {
    expect(buildCredits().line).not.toContain("Lizenzen:");
  });

  test("without dates and without the bus stop file", () => {
    const c = buildCredits({ busstopsAvailable: false, relief: { name: "Relief: X" } });
    expect(c.line).toBe(
      "© OpenStreetMap-Mitwirkende (ODbL), openstreetmap.org/copyright · Relief: X",
    );
    expect(c.sidebar.map(partText)).toEqual([
      "© OpenStreetMap-Mitwirkende (ODbL)",
      "Relief: X",
      "Suche: Photon (komoot)",
    ]);
  });
});
