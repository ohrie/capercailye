// Behaviour of the language selects (components/LangSelect.astro): choosing a language stores it
// in the `lang` cookie (the only place the language is ever stored), then
//  - goes to the page of that language if the select has `data-href-<lang>` (landing, legal), or
//  - reloads the current page (app), which then starts in that language.
// No Paraglide import: the landing page bundles this file, and the app passes its locale in.
import { storeLocale } from "./lang-cookie";

type Lang = "de" | "en";

const wired = new WeakSet<HTMLSelectElement>();

function isLang(value: string): value is Lang {
  return value === "de" || value === "en";
}

/**
 * Wires every `select[data-lang-select]` once (calling it again is harmless). `current` is the
 * locale the page really runs in; the app, rendered in English whatever the language, passes it
 * to set the shown option of selects that have no `data-href-*` target.
 */
export function initLangSelect(current?: Lang): void {
  for (const select of document.querySelectorAll<HTMLSelectElement>("select[data-lang-select]")) {
    const reloads = !select.dataset.hrefDe && !select.dataset.hrefEn;
    if (current && reloads) select.value = current;
    if (wired.has(select)) continue;
    wired.add(select);
    select.addEventListener("change", () => {
      const lang = select.value;
      if (!isLang(lang)) return;
      storeLocale(lang);
      const href = lang === "de" ? select.dataset.hrefDe : select.dataset.hrefEn;
      if (href) {
        location.assign(href);
        return;
      }
      // `?lang=` beats the cookie, so it has to go for the choice to take effect.
      const url = new URL(location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.delete("lang");
        location.replace(url);
      } else {
        location.reload();
      }
    });
  }
}
