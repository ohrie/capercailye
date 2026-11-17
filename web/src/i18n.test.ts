import { describe, expect, test } from "bun:test";
import { cookieLocale, detectLocale, formatNumber, localeOf } from "./i18n";

describe("localeOf", () => {
  test("takes the primary subtag, case-insensitive", () => {
    expect(localeOf("de")).toBe("de");
    expect(localeOf("de-AT")).toBe("de");
    expect(localeOf("DE_ch")).toBe("de");
    expect(localeOf("en-GB")).toBe("en");
    expect(localeOf(" en ")).toBe("en");
  });

  test("other languages and look-alikes are unsupported", () => {
    expect(localeOf("fr")).toBeUndefined();
    expect(localeOf("deu")).toBeUndefined();
    expect(localeOf("den")).toBeUndefined();
    expect(localeOf("")).toBeUndefined();
    expect(localeOf(null)).toBeUndefined();
    expect(localeOf(undefined)).toBeUndefined();
  });
});

describe("detectLocale: ?lang= first, then navigator.languages, then English", () => {
  test("the first supported browser language wins", () => {
    expect(detectLocale("", ["de-DE", "en-US"])).toBe("de");
    expect(detectLocale("", ["en-US", "de-DE"])).toBe("en");
    expect(detectLocale("", ["fr-FR", "de-DE"])).toBe("de");
    expect(detectLocale("", ["de-AT"])).toBe("de");
  });

  test("no supported language: English", () => {
    expect(detectLocale("", ["fr"])).toBe("en");
    expect(detectLocale("", ["fr-FR", "es", "ja"])).toBe("en");
    expect(detectLocale("", [])).toBe("en");
    expect(detectLocale("")).toBe("en");
  });

  test("?lang= beats the browser, in both directions", () => {
    expect(detectLocale("?lang=en", ["de-DE"])).toBe("en");
    expect(detectLocale("?lang=de", ["en-US"])).toBe("de");
    expect(detectLocale("?lang=de", ["fr"])).toBe("de");
    expect(detectLocale("?foo=1&lang=DE&bar=2", [])).toBe("de");
    expect(detectLocale("lang=de", [])).toBe("de");
  });

  test("an unsupported ?lang= is ignored", () => {
    expect(detectLocale("?lang=fr", ["de-DE"])).toBe("de");
    expect(detectLocale("?lang=", ["de-DE"])).toBe("de");
    expect(detectLocale("?lang=fr", ["fr"])).toBe("en");
  });
});

describe("cookieLocale", () => {
  test("reads the lang cookie among others", () => {
    expect(cookieLocale("lang=de")).toBe("de");
    expect(cookieLocale("a=1; lang=en; b=2")).toBe("en");
    expect(cookieLocale("  lang = de ")).toBe("de");
  });

  test("absent, empty or invalid values are ignored", () => {
    expect(cookieLocale("")).toBeUndefined();
    expect(cookieLocale(null)).toBeUndefined();
    expect(cookieLocale("a=1")).toBeUndefined();
    expect(cookieLocale("lang=fr")).toBeUndefined();
    expect(cookieLocale("lang=de-AT")).toBeUndefined();
    expect(cookieLocale("lang=")).toBeUndefined();
    expect(cookieLocale("xlang=de")).toBeUndefined();
  });
});

describe("detectLocale: the lang cookie sits between ?lang= and the browser", () => {
  test("?lang= beats the cookie", () => {
    expect(detectLocale("?lang=en", ["de-DE"], "lang=de")).toBe("en");
    expect(detectLocale("?lang=de", [], "lang=en")).toBe("de");
  });

  test("the cookie beats the browser languages", () => {
    expect(detectLocale("", ["de-DE"], "lang=en")).toBe("en");
    expect(detectLocale("", ["en-US"], "lang=de")).toBe("de");
    expect(detectLocale("", [], "lang=de")).toBe("de");
  });

  test("an invalid cookie is ignored", () => {
    expect(detectLocale("", ["de-DE"], "lang=fr")).toBe("de");
    expect(detectLocale("", ["en-US"], "lang=")).toBe("en");
    expect(detectLocale("?lang=fr", ["de-DE"], "lang=xx")).toBe("de");
  });
});

describe("formatNumber", () => {
  test("uses the given locale's separators", () => {
    const options = { maximumFractionDigits: 1, minimumFractionDigits: 1 };
    expect(formatNumber(11.84, options, "de")).toBe("11,8");
    expect(formatNumber(11.84, options, "en")).toBe("11.8");
  });
});
