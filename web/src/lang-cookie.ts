// The `lang` cookie: the one thing the site remembers, and only after the user actively picks a
// language in the language select (never automatically, never from `?lang=`). It holds only "de" or "en".
// Kept free of Paraglide imports so the landing page's small script can use it without the runtime.

/** Name of the cookie. */
export const LANG_COOKIE = "lang";

/** Stores the chosen language for one year. `Secure` is added on https. */
export function storeLocale(locale: "de" | "en"): void {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANG_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    // Cookies blocked: the switch still works for this visit.
  }
}
