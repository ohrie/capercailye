// Sidebar wiring: print settings, layer toggles, collapse.
import { MAX_SHEETS, type PrintMode, type SheetLayout } from "./print/layout";
import type { Orientation } from "./print/paper";
import { formatScale } from "./print/scale";
import { getState, setState, subscribe } from "./state";
import { ATTRIBUTION_TEXT } from "./config";
import { GROUPS } from "./style";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} fehlt`);
  return node as T;
}

export interface SidebarHooks {
  /** Groups without data: their switch is shown disabled. */
  unavailableGroups?: readonly string[];
  /** Button "PDF exportieren". */
  onExport: () => void;
  /** The same button while an export runs ("Abbrechen"). */
  onCancel: () => void;
  /** Button "Gebiet zur Kartenmitte". */
  onRecenter: () => void;
  onCollapseChange: () => void;
}

export function initSidebar(hooks: SidebarHooks): void {
  const scaleSelect = el<HTMLSelectElement>("print-scale");
  const pagesSelect = el<HTMLSelectElement>("print-pages");
  const printView = el<HTMLInputElement>("print-view");
  const exportButton = el<HTMLButtonElement>("export-pdf");

  scaleSelect.addEventListener("change", () => {
    setState({ print: { ...getState().print, scale: Number(scaleSelect.value) } });
  });
  pagesSelect.addEventListener("change", () => {
    setState({ print: { ...getState().print, pages: Number(pagesSelect.value) } });
  });
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    input.addEventListener("change", () => {
      if (input.checked) {
        setState({ print: { ...getState().print, mode: input.value as PrintMode } });
      }
    });
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="orientation"]')) {
    input.addEventListener("change", () => {
      if (input.checked) {
        setState({ print: { ...getState().print, orientation: input.value as Orientation } });
      }
    });
  }
  printView.addEventListener("change", () => setState({ printView: printView.checked }));
  subscribe((s) => {
    printView.checked = s.printView;
  });
  exportButton.addEventListener("click", () => (exportBusy ? hooks.onCancel() : hooks.onExport()));
  el("area-recenter").addEventListener("click", () => hooks.onRecenter());

  // Controls follow the print settings (also when they are changed from outside).
  const syncControls = () => {
    const p = getState().print;
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
      input.checked = input.value === p.mode;
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="orientation"]')) {
      input.checked = input.value === p.orientation;
    }
    scaleSelect.value = String(p.scale);
    pagesSelect.value = String(p.pages);
    el("field-scale").hidden = p.mode !== "scale";
    el("field-pages").hidden = p.mode !== "pages";
  };
  syncControls();
  subscribe((s, prev) => {
    if (s.print !== prev.print) syncControls();
  });

  // Layer toggles: one per labelled style group.
  const toggles = el<HTMLDivElement>("layer-toggles");
  for (const group of GROUPS) {
    if (!group.label) continue;
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = getState().visibility[group.id] ?? group.defaultVisible;
    input.dataset.group = group.id;
    if (hooks.unavailableGroups?.includes(group.id)) {
      input.disabled = true;
      input.checked = false;
      label.classList.add("switch--disabled");
      label.title = "Datei nicht vorhanden";
    }
    input.addEventListener("change", () => {
      setState({ visibility: { ...getState().visibility, [group.id]: input.checked } });
    });
    const track = document.createElement("span");
    track.className = "switch__track";
    track.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = group.label;
    label.append(input, track, text);
    toggles.appendChild(label);
  }

  el("attribution").textContent = ATTRIBUTION_TEXT;

  const setCollapsed = (collapsed: boolean) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    hooks.onCollapseChange();
  };
  el("sidebar-collapse").addEventListener("click", () => setCollapsed(true));
  el("sidebar-expand").addEventListener("click", () => setCollapsed(false));
}

const nf = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** "6 Seiten (3 × 2) · 1:21 000 · 11,8 × 11,1 km · Druckzoom 13,19" plus a hint if needed. */
export function updatePrintInfo(layout: SheetLayout): void {
  const km = (mm: number) => nf.format((mm * layout.scale) / 1e6);
  const w = layout.gridMm.maxX - layout.gridMm.minX;
  const h = layout.gridMm.maxY - layout.gridMm.minY;
  const note = el("print-note");
  let warning = "";
  if (layout.tooLarge) {
    warning = `Gebiet zu groß: ${layout.count} Seiten (höchstens ${MAX_SHEETS})`;
    el("print-info").textContent =
      `${formatScale(layout.scale)} · Druckzoom ${nf2.format(layout.zoom)}`;
  } else {
    const pages = `${layout.count} ${layout.count === 1 ? "Seite" : "Seiten"}`;
    el("print-info").textContent =
      `${pages} (${layout.cols} × ${layout.rows}) · ${formatScale(layout.scale)} · ` +
      `${km(w)} × ${km(h)} km · Druckzoom ${nf2.format(layout.zoom)}`;
    if (!layout.areaCovered) {
      warning = `Gebiet passt nicht auf ${layout.count} Seiten, mehr Seiten wählen`;
    }
  }
  note.textContent = warning;
  note.hidden = warning === "";
  exportAllowed = !layout.tooLarge;
  refreshExportButton();
}

let exportBusy = false;
let exportAllowed = true;

function refreshExportButton(): void {
  const button = el<HTMLButtonElement>("export-pdf");
  button.disabled = !exportBusy && !exportAllowed;
  button.textContent = exportBusy ? "Abbrechen" : "PDF exportieren";
}

/** While an export runs the button turns into "Abbrechen". */
export function setExportBusy(busy: boolean): void {
  exportBusy = busy;
  refreshExportButton();
}

export function setStatus(text: string, kind: "info" | "warn" | "error" = "info"): void {
  const status = el("export-status");
  status.textContent = text;
  status.classList.toggle("status--warn", kind === "warn");
  status.classList.toggle("status--error", kind === "error");
}
