// Language of the app page (/app/). The page is one static HTML file, so the language is chosen
// in the browser, never stored: `?lang=de|en` (for testing and linking), then the first language
// of `navigator.languages` that starts with `de` or `en`, then English.
//
// Messages come from Paraglide (messages/*.json, compiled to src/paraglide/). The choice above is
// a custom Paraglide client strategy (see paraglide.config.mjs); `getLocale()` returns its result.
// The landing page does not use it: it passes its locale to every message call at build time.
import {
  baseLocale,
  defineCustomClientStrategy,
  getLocale,
  type Locale,
} from "./paraglide/runtime.js";

export type { Locale };

/** Locale of a language tag by its primary subtag ("de-AT" -> "de"); undefined if unsupported. */
export function localeOf(tag: string | null | undefined): Locale | undefined {
  const m = /^\s*(de|en)(?:[-_]|\s*$)/i.exec(tag ?? "");
  return m ? (m[1]!.toLowerCase() as Locale) : undefined;
}

/**
 * Locale for a URL query string and a browser language list: the `lang` parameter if it names a
 * supported language, else the first supported entry of the list, else English.
 */
export function detectLocale(search: string, languages: readonly string[] = []): Locale {
  return (
    localeOf(new URLSearchParams(search).get("lang")) ??
    languages.map(localeOf).find((l) => l !== undefined) ??
    baseLocale
  );
}

if (typeof window !== "undefined") {
  defineCustomClientStrategy("custom-appLanguage", {
    getLocale: () =>
      detectLocale(
        window.location.search,
        navigator.languages?.length ? navigator.languages : [navigator.language],
      ),
    // The language is never stored: nothing to do.
    setLocale: () => {},
  });
}

/** The active locale (the app's, in the browser). */
export function currentLocale(): Locale {
  return getLocale();
}

/** `Intl.NumberFormat` of the active locale (or the given one), e.g. 1 decimal place. */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale: Locale = getLocale(),
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
