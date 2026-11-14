import { describe, expect, test } from "bun:test";
import { jsPDF } from "jspdf";
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

  test("the credits line of the sheet margin fits beside the print hint, portrait and landscape", () => {
    const hint = "Drucken mit 100 % (nicht „An Seite anpassen“)";
    const relief = [
      { name: "Relief: Mapterhorn, LGL, www.lgl-bw.de", license: "dl-de/by-2-0" },
      { name: "Relief: Mapterhorn, ©GeoBasis-DE / LVermGeoRP", license: "dl-de/by-2-0" },
    ];
    for (const orientation of ["portrait", "landscape"] as const) {
      for (const r of relief) {
        const line = buildCredits({ relief: r }).line;
        expect(line).not.toContain("Stand");
        const doc = new jsPDF({ unit: "mm", format: "a4", orientation });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(CREDIT_PT);
        const room = printableArea(orientation).width - 6 - doc.getTextWidth(hint) - 4;
        const size = creditFontSize(doc.getTextWidth(line), room);
        expect(size, `${orientation} ${r.name}`).toBeGreaterThanOrEqual(CREDIT_MIN_PT);
        // At that size the line ends before the hint starts.
        expect(
          (doc.getTextWidth(line) * size) / CREDIT_PT,
          `${orientation} ${r.name}`,
        ).toBeLessThanOrEqual(room + 1e-9);
      }
    }
  });
});
