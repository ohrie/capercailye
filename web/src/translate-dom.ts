// Fills the static markup of the app page (src/pages/app/index.astro) with the active language.
// The page is rendered once in English at build time; elements carry the message key in
// `data-i18n` (text) or `data-i18n-<attribute>` (title, aria-label, placeholder, alt). Runs first
// thing in the client script, before the map starts, so the page does not flash in English.
import { getLocale } from "./paraglide/runtime.js";
import { m } from "./paraglide/messages.js";
import { formatScale } from "./print/scale";

type Message = (inputs?: Record<string, never>) => string;

const ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"] as const;

function text(key: string): string {
  const message = (m as unknown as Record<string, Message | undefined>)[key];
  if (!message) throw new Error(`Unknown message key: ${key}`);
  return message();
}

/** Sets the text of an element without touching child elements (e.g. the step number badge). */
function setText(node: HTMLElement, value: string): void {
  const own = [...node.childNodes].filter(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
  );
  const target = own[own.length - 1];
  if (target) target.textContent = value;
  else node.append(document.createTextNode(value));
}

export function translateDocument(): void {
  try {
    document.documentElement.lang = getLocale();
    document.title = m.app_title();
    for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      setText(node, text(node.dataset.i18n!));
    }
    for (const attribute of ATTRIBUTES) {
      for (const node of document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
        node.setAttribute(attribute, text(node.getAttribute(`data-i18n-${attribute}`)!));
      }
    }
    // Scale options: "1:25 000" (de) or "1:25,000" (en), value = the scale.
    for (const option of document.querySelectorAll<HTMLOptionElement>("#print-scale option")) {
      option.textContent = formatScale(Number(option.value));
    }
  } finally {
    // The sidebar is hidden by an inline style until the texts are in (see the page head).
    document.getElementById("i18n-pending")?.remove();
  }
}
