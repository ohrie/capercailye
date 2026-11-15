import { describe, expect, test } from "bun:test";
import { jsPDF } from "jspdf";
import { BUSSTOPS_CREDIT, RELIEF_CREDITS } from "../config";
import { buildCredits } from "../credits";
import { printableArea } from "./paper";
import { CREDIT_MIN_PT, CREDIT_PT, creditFontSize } from "./pdf";

describe("creditFontSize", () => {
  test("pure rule: full size if it fits, else shrunk to fit, never below the minimum", () => {
    expect(creditFontSize(100, 120)).toBe(CREDIT_PT);
    expect(creditFontSize(100, 100)).toBe(CREDIT_PT);
    expect(creditFontSize(110, 100)).toBeCloseTo((CREDIT_PT * 100) / 110, 10);
    expect(creditFontSize(1000, 100)).toBe(CREDIT_MIN_PT);
  });
});

describe("credits line of the sheet margin", () => {
  const host = "capercailye.chilla.dev";

  test("fits the strip width without going below the minimum size, portrait and landscape", () => {
    for (const orientation of ["portrait", "landscape"] as const) {
      for (const busstopsAvailable of [true, false]) {
        for (const [area, relief] of Object.entries(RELIEF_CREDITS)) {
          const line = buildCredits({ host, busstopsAvailable, relief }).line;
          const label = `${orientation} bus=${busstopsAvailable} ${area}`;
          expect(line, label).not.toContain("Stand");
          const doc = new jsPDF({ unit: "mm", format: "a4", orientation });
          doc.setFont("helvetica", "normal");
          doc.setFontSize(CREDIT_PT);
          const room = printableArea(orientation).width - 6;
          const size = creditFontSize(doc.getTextWidth(line), room);
          expect(size, label).toBeGreaterThanOrEqual(CREDIT_MIN_PT);
          // Readable: the production line (all of Germany) loses at most about a point.
          if (area === "de") expect(size, label).toBeGreaterThanOrEqual(5);
          // At that size the line ends inside the strip.
          expect((doc.getTextWidth(line) * size) / CREDIT_PT, label).toBeLessThanOrEqual(
            room + 1e-9,
          );
        }
      }
    }
  });

  test("has the OSM copyright URL, modification notes, licences and the sources pointer", () => {
    const text = buildCredits({ host }).line;
    expect(text).toContain("openstreetmap.org/copyright");
    expect(text).toContain("ODbL");
    expect(text).toContain(`Lizenzen: ${host}/quellen`);
    expect(text).toContain("bearbeitet");
    expect(text).toContain("ausgewertet");
    expect(text).toContain(BUSSTOPS_CREDIT.license!);
    expect(text).not.toContain("Stand");
  });
});
