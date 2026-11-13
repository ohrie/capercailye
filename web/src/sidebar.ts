// Sidebar wiring: print settings, layer toggles, collapse.
import type { Orientation } from "./print/paper";
import { printableArea } from "./print/paper";
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
  onExport: () => void;
  onCollapseChange: () => void;
}

export function initSidebar(hooks: SidebarHooks): void {
  const scaleSelect = el<HTMLSelectElement>("print-scale");
  const printView = el<HTMLInputElement>("print-view");
  const exportButton = el<HTMLButtonElement>("export-pdf");

  scaleSelect.addEventListener("change", () => {
    setState({ print: { ...getState().print, scale: Number(scaleSelect.value) } });
  });
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
  exportButton.addEventListener("click", () => hooks.onExport());

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

export function updatePrintInfo(printZoom: number): void {
  const { scale, orientation } = getState().print;
  const area = printableArea(orientation);
  const wKm = (area.width * scale) / 1e6;
  const hKm = (area.height * scale) / 1e6;
  el("print-info").textContent =
    `Blatt ${nf.format(wKm)} × ${nf.format(hKm)} km · Druckzoom ${nf2.format(printZoom)}`;
}

export function setExportBusy(busy: boolean): void {
  const button = el<HTMLButtonElement>("export-pdf");
  button.disabled = busy;
  button.textContent = busy ? "Exportiere …" : "PDF exportieren";
}

export function setStatus(text: string, kind: "info" | "warn" | "error" = "info"): void {
  const status = el("export-status");
  status.textContent = text;
  status.classList.toggle("status--warn", kind === "warn");
  status.classList.toggle("status--error", kind === "error");
}
