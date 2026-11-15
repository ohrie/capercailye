// Sidebar wiring: mode switch, print settings, GPX panel, layer toggles with legend symbols
// (sections, sub-switches), collapse.
import type { CreditPart } from "./credits";
import { legendDataUrl, legendSvg, LEGEND_CELL, LEGEND_SCALE } from "./legend";
import { MAP_MODES, type MapMode } from "./mode";
import { MAX_SHEETS, type PrintMode, type SheetLayout } from "./print/layout";
import type { Orientation } from "./print/paper";
import { formatScale } from "./print/scale";
import { getState, setState, subscribe } from "./state";
import type { Track } from "./gpx";
import { type LayerGroup, SECTIONS, uiGroups } from "./style";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} fehlt`);
  return node as T;
}

/** Grey line under the mode switch; none in mode "sheets". */
const MODE_HINTS: Record<MapMode, string> = {
  explore: "Zum Drucken ein Gebiet zeichnen.",
  draw: "Rechteck auf der Karte aufziehen · Esc bricht ab",
  sheets: "",
};

export interface SidebarHooks {
  /** The mode was chosen in the switch. */
  onMode: (mode: MapMode) => void;
  /** Groups without data: their switch is shown disabled. */
  unavailableGroups?: readonly string[];
  /** Button "PDF exportieren". */
  onExport: () => void;
  /** The same button while an export runs ("Abbrechen"). */
  onCancel: () => void;
  /** A GPX file was chosen in the panel. */
  onGpxFile: (file: File) => void;
  /** Button "Gebiet auf Track setzen". */
  onGpxArea: () => void;
  /** Button "Track entfernen". */
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
    hint.textContent = MODE_HINTS[mode];
    hint.hidden = MODE_HINTS[mode] === "";
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
  // Only the label changes; the download icon stays except while the button cancels.
  el("export-pdf").querySelector(".button__label")!.textContent = exportBusy
    ? "Abbrechen"
    : "PDF exportieren";
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

const nf1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Name and length of the loaded track, or the hint to load one. */
function updateGpxPanel(gpx: Track | null): void {
  el("gpx-info").hidden = gpx === null;
  el("gpx-hint").hidden = gpx !== null;
  if (gpx) {
    el("gpx-name").textContent = gpx.name;
    el("gpx-length").textContent = `${nf1.format(gpx.lengthKm)} km`;
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
 * One switch per labelled style group, in the sections of the panel "Ebenen" (collapsible
 * <details>). Sub-switches are indented below their parent and disabled, keeping their value,
 * while the parent is off (the four route networks under "Wanderrouten", the guidepost names).
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
      label.title = missing ? "Datei nicht vorhanden" : "";
    }
  };
  sync();
  subscribe((s, prev) => {
    if (s.visibility !== prev.visibility) sync();
  });
}
