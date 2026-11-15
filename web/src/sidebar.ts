// Sidebar wiring: mode switch, print settings, GPX panel, layer toggles with legend symbols
// (sections, sub-switches), collapse.
import type { CreditPart } from "./credits";
import { formatNumber } from "./i18n";
import { legendDataUrl, legendSvg, LEGEND_CELL, LEGEND_SCALE } from "./legend";
import { MAP_MODES, type MapMode } from "./mode";
import { m } from "./paraglide/messages.js";
import { MAX_SHEETS, type PrintMode, type SheetLayout } from "./print/layout";
import type { Orientation } from "./print/paper";
import { formatScale } from "./print/scale";
import { getState, setState, subscribe } from "./state";
import type { Track } from "./gpx";
import { type LayerGroup, SECTIONS, uiGroups } from "./style";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** Grey line under the mode switch; none in mode "sheets". */
function modeHint(mode: MapMode): string {
  switch (mode) {
    case "explore":
      return m.app_hint_explore();
    case "draw":
      return m.app_hint_draw();
    case "sheets":
      return "";
  }
}

export interface SidebarHooks {
  /** The mode was chosen in the switch. */
  onMode: (mode: MapMode) => void;
  /** Groups without data: their switch is shown disabled. */
  unavailableGroups?: readonly string[];
  /** Button "Export PDF". */
  onExport: () => void;
  /** The same button while an export runs ("Cancel"). */
  onCancel: () => void;
  /** A GPX file was chosen in the panel. */
  onGpxFile: (file: File) => void;
  /** Button "Set area to track". */
  onGpxArea: () => void;
  /** Button "Remove track". */
  onGpxRemove: () => void;
  onCollapseChange: () => void;
}

export function initSidebar(hooks: SidebarHooks): void {
  const scaleSelect = el<HTMLSelectElement>("print-scale");
  const pagesSelect = el<HTMLSelectElement>("print-pages");
  const printView = el<HTMLInputElement>("print-view");
  const exportButton = el<HTMLButtonElement>("export-pdf");

  const modeInputs = document.querySelectorAll<HTMLInputElement>('input[name="map-mode"]');
  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      if (input.checked && MAP_MODES.includes(input.value as MapMode)) {
        hooks.onMode(input.value as MapMode);
      }
    });
  }
  // The switch, the hint and the print panel follow the mode (also when it is set from outside).
  const syncMode = () => {
    const mode = getState().mode;
    for (const input of modeInputs) input.checked = input.value === mode;
    const hint = el("mode-hint");
    const text = modeHint(mode);
    hint.textContent = text;
    hint.hidden = text === "";
    el("print-panel").hidden = mode !== "sheets";
  };
  syncMode();
  subscribe((s, prev) => {
    if (s.mode !== prev.mode) syncMode();
  });

  scaleSelect.addEventListener("change", () => {
    setState({ print: { ...getState().print, scale: Number(scaleSelect.value) } });
  });
  pagesSelect.addEventListener("change", () => {
    setState({ print: { ...getState().print, pages: Number(pagesSelect.value) } });
  });
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="print-mode"]')) {
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

  // Controls follow the print settings (also when they are changed from outside).
  const syncControls = () => {
    const p = getState().print;
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="print-mode"]')) {
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

  // GPX panel: file chooser (the drop target is the map, see main.ts).
  const gpxFile = el<HTMLInputElement>("gpx-file");
  el("gpx-load").addEventListener("click", () => gpxFile.click());
  gpxFile.addEventListener("change", () => {
    const file = gpxFile.files?.[0];
    // Reset, so choosing the same file again (after removing the track) fires `change`.
    if (file) hooks.onGpxFile(file);
    gpxFile.value = "";
  });
  el("gpx-area").addEventListener("click", () => hooks.onGpxArea());
  el("gpx-remove").addEventListener("click", () => hooks.onGpxRemove());
  updateGpxPanel(getState().gpx);
  subscribe((s, prev) => {
    if (s.gpx !== prev.gpx) updateGpxPanel(s.gpx);
  });

  initLayerToggles(hooks.unavailableGroups ?? []);

  const setCollapsed = (collapsed: boolean) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    hooks.onCollapseChange();
  };
  el("sidebar-collapse").addEventListener("click", () => setCollapsed(true));
  el("sidebar-expand").addEventListener("click", () => setCollapsed(false));
}

const ONE_DECIMAL = { maximumFractionDigits: 1, minimumFractionDigits: 1 } as const;
const TWO_DECIMALS = { maximumFractionDigits: 2, minimumFractionDigits: 2 } as const;

/** "6 pages (3 × 2) · 1:21,000 · 11.8 × 11.1 km · print zoom 13.19" plus a hint if needed. */
export function updatePrintInfo(layout: SheetLayout): void {
  const km = (mm: number) => formatNumber((mm * layout.scale) / 1e6, ONE_DECIMAL);
  const zoom = formatNumber(layout.zoom, TWO_DECIMALS);
  const w = layout.gridMm.maxX - layout.gridMm.minX;
  const h = layout.gridMm.maxY - layout.gridMm.minY;
  const note = el("print-note");
  let warning = "";
  if (layout.tooLarge) {
    warning = m.app_area_too_large({ count: layout.count, max: MAX_SHEETS });
    el("print-info").textContent = m.app_print_info_large({
      scale: formatScale(layout.scale),
      zoom,
    });
  } else {
    el("print-info").textContent = m.app_print_info({
      pages: m.app_pages_count({ count: layout.count }),
      cols: layout.cols,
      rows: layout.rows,
      scale: formatScale(layout.scale),
      width: km(w),
      height: km(h),
      zoom,
    });
    if (!layout.areaCovered) {
      warning = m.app_area_not_covered({ count: layout.count });
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
  // Only the label changes; the download icon stays except while the button cancels.
  el("export-pdf").querySelector(".button__label")!.textContent = exportBusy
    ? m.app_export_cancel()
    : m.app_export_pdf();
  button.classList.toggle("button--cancel", exportBusy);
  // The mode cannot be changed while an export runs.
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="map-mode"]')) {
    input.disabled = exportBusy;
    input.closest("label")?.classList.toggle("is-disabled", exportBusy);
  }
}

/**
 * Sidebar footer: the credits of the sources (with their data dates), names with a target as links.
 * Built with DOM APIs (text nodes and anchors), no HTML string goes in.
 */
export function setAttribution(parts: CreditPart[]): void {
  const nodes: Node[] = [];
  parts.forEach((part, i) => {
    if (i > 0) nodes.push(document.createTextNode(" · "));
    if (part.href) {
      const a = document.createElement("a");
      a.href = part.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = part.name;
      nodes.push(a);
    } else {
      nodes.push(document.createTextNode(part.name));
    }
    if (part.suffix) nodes.push(document.createTextNode(part.suffix));
  });
  el("attribution").replaceChildren(...nodes);
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

/** Name and length of the loaded track, or the hint to load one. */
function updateGpxPanel(gpx: Track | null): void {
  el("gpx-info").hidden = gpx === null;
  el("gpx-hint").hidden = gpx !== null;
  if (gpx) {
    el("gpx-name").textContent = gpx.name;
    el("gpx-length").textContent = m.app_gpx_length({
      km: formatNumber(gpx.lengthKm, ONE_DECIMAL),
    });
    setGpxStatus("");
  }
}

/** Error line of the GPX panel (empty clears it). */
export function setGpxStatus(text: string): void {
  el("gpx-status").textContent = text;
}

// ---------------------------------------------------------------------------------------------
// Layer switches

/**
 * Legend symbol of a switch (an <img> from the same sources as the map), or an empty cell of the
 * same width so the labels line up (sub-switches have no symbol).
 */
function legendCell(groupId: string): HTMLElement {
  const image = legendSvg(groupId);
  if (!image) {
    const empty = document.createElement("span");
    empty.className = "switch__legend";
    empty.setAttribute("aria-hidden", "true");
    return empty;
  }
  const img = document.createElement("img");
  img.className = "switch__legend";
  img.alt = "";
  img.src = legendDataUrl(image);
  const width = image.width * LEGEND_SCALE;
  img.style.width = `${width}px`;
  img.style.height = `${image.height * LEGEND_SCALE}px`;
  // Left-aligned in the fixed cell: the margin makes up the rest of the cell width.
  img.style.marginRight = `${Math.max(0, LEGEND_CELL.width - width)}px`;
  return img;
}

/**
 * One switch per labelled style group, in the sections of the panel "Layers" (collapsible
 * <details>). Sub-switches are indented below their parent and disabled, keeping their value,
 * while the parent is off (the four route networks under "Hiking routes", the guidepost names).
 */
function initLayerToggles(unavailable: readonly string[]): void {
  const root = el<HTMLDivElement>("layer-toggles");
  const entries: { group: LayerGroup; input: HTMLInputElement; label: HTMLElement }[] = [];
  const isOn = (g: LayerGroup) => getState().visibility[g.id] ?? g.defaultVisible;

  const makeInput = (group: LayerGroup): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.group = group.id;
    input.addEventListener("change", () => {
      setState({ visibility: { ...getState().visibility, [group.id]: input.checked } });
    });
    return input;
  };

  for (const section of SECTIONS) {
    const details = document.createElement("details");
    details.className = "layers__section";
    details.open = true;
    details.dataset.section = section.id;
    const summary = document.createElement("summary");
    summary.textContent = section.label;
    details.append(summary);
    const body = document.createElement("div");
    body.className = "toggles";
    details.append(body);

    for (const group of uiGroups(section.id)) {
      const label = document.createElement("label");
      label.className = "switch";
      if (group.parent) label.classList.add("switch--sub");
      const input = makeInput(group);
      const track = document.createElement("span");
      track.className = "switch__track";
      track.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = group.label!;
      label.append(input, track, legendCell(group.id), text);
      body.append(label);
      entries.push({ group, input, label });
    }
    root.append(details);
  }

  const sync = () => {
    for (const { group, input, label } of entries) {
      const missing = unavailable.includes(group.id);
      const parent = group.parent ? entries.find((e) => e.group.id === group.parent) : undefined;
      const parentOff = parent ? !isOn(parent.group) : false;
      input.checked = !missing && isOn(group);
      input.disabled = missing || parentOff;
      label.classList.toggle("switch--disabled", input.disabled);
      label.title = missing ? m.layer_missing() : "";
    }
  };
  sync();
  subscribe((s, prev) => {
    if (s.visibility !== prev.visibility) sync();
  });
}
