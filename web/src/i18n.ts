// Language of the app page (/app/). The page is one static HTML file, so the language is chosen
// in the browser: `?lang=de|en` (for testing and linking), then the `lang` cookie, then the first
// language of `navigator.languages` that starts with `de` or `en`, then English. The cookie is
// written only when the user picks a language in the language select (see lang-cookie.ts); without it,
// nothing is stored.
//
// Messages come from Paraglide (messages/*.json, compiled to src/paraglide/). The choice above is
// a custom Paraglide client strategy (see paraglide.config.mjs); `getLocale()` returns its result.
// The landing page does not use it: it passes its locale to every message call at build time.
import { LANG_COOKIE } from "./lang-cookie";
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

/** Locale stored in the `lang` cookie of a `document.cookie` string; undefined if absent or not exactly "de"/"en". */
export function cookieLocale(cookie: string | null | undefined): Locale | undefined {
  for (const part of (cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== LANG_COOKIE) continue;
    const value = part.slice(i + 1).trim();
    return value === "de" || value === "en" ? value : undefined;
  }
  return undefined;
}

/**
 * Locale for a URL query string, a `document.cookie` string and a browser language list: the
 * `lang` parameter if it names a supported language, else the `lang` cookie, else the first
 * supported entry of the list, else English.
 */
export function detectLocale(
  search: string,
  languages: readonly string[] = [],
  cookie: string = "",
): Locale {
  return (
    localeOf(new URLSearchParams(search).get("lang")) ??
    cookieLocale(cookie) ??
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
        document.cookie,
      ),
    // Storing is the language select's job (storeLocale), only on an explicit click: nothing to do.
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
