// Legend dialog of the panel "Layers": a static list of every symbol and area of the map, whatever
// the switches say. The content (src/legend.ts, pure data) is built into the <dialog> on first open.
// The dialog sits outside #sidebar (the sidebar moves into the bottom sheet on narrow screens) and
// opens with showModal(), i.e. in the top layer above map and sheet.
import {
  LEGEND_DIALOG_AREA_SCALE,
  LEGEND_DIALOG_SCALE,
  LEGEND_SECTION_KEYS,
  legendCatalog,
  legendDataUrl,
} from "./legend";
import type { LegendEntry, LegendGroup } from "./legend";
import { m } from "./paraglide/messages.js";

type Message = (inputs?: Record<string, never>) => string;

function text(key: string): string {
  const message = (m as unknown as Record<string, Message | undefined>)[key];
  if (!message) throw new Error(`Unknown message key: ${key}`);
  return message();
}

function heading(tag: "h3" | "h4", className: string, label: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = label;
  return node;
}

function entryItem(entry: LegendEntry, section: LegendGroup["section"]): HTMLElement {
  const item = document.createElement("li");
  item.className = "legend__item";
  const cell = document.createElement("span");
  cell.className = "legend__cell";
  const img = document.createElement("img");
  img.className = section === "areas" ? "legend__img legend__img--area" : "legend__img";
  img.alt = "";
  img.src = legendDataUrl(entry.image);
  const scale = section !== "symbols" ? LEGEND_DIALOG_AREA_SCALE : LEGEND_DIALOG_SCALE;
  img.style.width = `${entry.image.width * scale}px`;
  img.style.height = `${entry.image.height * scale}px`;
  cell.append(img);
  const label = document.createElement("span");
  label.textContent = text(entry.labelKey);
  item.append(cell, label);
  return item;
}

/** Sections with their headings, groups below them; consecutive groups of a section share one. */
function buildContent(groups: LegendGroup[]): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  let section: LegendGroup["section"] | undefined;
  for (const group of groups) {
    if (group.section !== section) {
      section = group.section;
      nodes.push(heading("h3", "legend__section", text(LEGEND_SECTION_KEYS[section])));
    }
    if (group.titleKey) nodes.push(heading("h4", "legend__group", text(group.titleKey)));
    const list = document.createElement("ul");
    list.className = "legend__list";
    for (const entry of group.entries) list.append(entryItem(entry, group.section));
    nodes.push(list);
  }
  return nodes;
}

export function initLegendDialog(): void {
  const dialog = document.getElementById("legend-dialog") as HTMLDialogElement | null;
  const open = document.getElementById("legend-open");
  const close = document.getElementById("legend-close");
  const body = document.getElementById("legend-body");
  if (!dialog || !open || !close || !body) throw new Error("Missing legend dialog elements");

  let built = false;
  open.addEventListener("click", () => {
    if (!built) {
      body.replaceChildren(...buildContent(legendCatalog()));
      built = true;
    }
    body.scrollTop = 0;
    dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  // The panel fills the dialog completely, so a click that hits the dialog itself is the backdrop.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
