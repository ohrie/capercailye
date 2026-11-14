// Draws a print area on the map: drag a rectangle with the primary pointer (mouse, finger, pen).
// Used in mode "draw" (src/mode.ts); the map's dragging is switched off there, so the pointer
// events on the canvas container belong to this class. Wheel zoom and the keyboard stay with the
// map. The rectangle is a dashed overlay in the style of the print frame's area.
import type { Map as MapLibreMap } from "maplibre-gl";
import { dragRect, MIN_DRAW_PX } from "../mode";
import type { Area } from "./layout";

const SVG_NS = "http://www.w3.org/2000/svg";

type Pt = [number, number];

/** Input types that take no typed text: Escape still cancels there (e.g. on the mode switch itself). */
const NON_TEXT_INPUTS = new Set([
  "radio",
  "checkbox",
  "button",
  "submit",
  "reset",
  "range",
  "file",
]);

/** Escape must not cancel while the focus is in a form control (a text field, a menu). */
function inFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.matches("select, textarea") || target.isContentEditable;
}

export class AreaDrawer {
  private readonly svg: SVGSVGElement;
  private readonly rect: SVGRectElement;
  private readonly surface: HTMLElement;
  private enabled = false;
  /** Pointer id and start point of the running drag. */
  private drag: { id: number; start: Pt } | null = null;

  constructor(
    private readonly map: MapLibreMap,
    private readonly onDone: (area: Area) => void,
    private readonly onCancel: () => void,
  ) {
    this.surface = map.getCanvasContainer();
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "area-draw");
    this.svg.setAttribute("hidden", "");
    this.rect = document.createElementNS(SVG_NS, "rect");
    this.rect.setAttribute("class", "print-frame__area");
    this.svg.append(this.rect);
    map.getContainer().appendChild(this.svg);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.surface.addEventListener("pointerdown", this.onDown);
    this.surface.addEventListener("pointermove", this.onMove);
    this.surface.addEventListener("pointerup", this.onUp);
    this.surface.addEventListener("pointercancel", this.onPointerCancel);
    document.addEventListener("keydown", this.onKey, true);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.surface.removeEventListener("pointerdown", this.onDown);
    this.surface.removeEventListener("pointermove", this.onMove);
    this.surface.removeEventListener("pointerup", this.onUp);
    this.surface.removeEventListener("pointercancel", this.onPointerCancel);
    document.removeEventListener("keydown", this.onKey, true);
    this.discard();
  }

  private at(e: PointerEvent): Pt {
    const bounds = this.map.getContainer().getBoundingClientRect();
    return [e.clientX - bounds.left, e.clientY - bounds.top];
  }

  private show(a: Pt, b: Pt): void {
    const container = this.map.getContainer();
    const W = container.clientWidth;
    const H = container.clientHeight;
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("width", String(W));
    this.svg.setAttribute("height", String(H));
    const x0 = Math.min(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    this.rect.setAttribute("x", String(x0));
    this.rect.setAttribute("y", String(y0));
    this.rect.setAttribute("width", String(Math.abs(b[0] - a[0])));
    this.rect.setAttribute("height", String(Math.abs(b[1] - a[1])));
    this.svg.removeAttribute("hidden");
  }

  /** Forgets a running drag and hides the rectangle. */
  private discard(): void {
    if (this.drag && this.surface.hasPointerCapture(this.drag.id)) {
      this.surface.releasePointerCapture(this.drag.id);
    }
    this.drag = null;
    this.svg.setAttribute("hidden", "");
  }

  private readonly onDown = (e: PointerEvent): void => {
    // A second finger (or any other pointer) while dragging aborts the drag.
    if (this.drag) {
      this.discard();
      return;
    }
    if (e.button !== 0 || !e.isPrimary) return;
    this.drag = { id: e.pointerId, start: this.at(e) };
    this.surface.setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.show(this.drag.start, this.at(e));
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const { start } = this.drag;
    this.discard();
    // A click or a sliver is no area; the mode stays as it is.
    const r = dragRect(start, this.at(e), MIN_DRAW_PX);
    if (!r) return;
    const topLeft = this.map.unproject([r[0], r[1]]);
    const bottomRight = this.map.unproject([r[2], r[3]]);
    this.onDone({
      west: topLeft.lng,
      north: topLeft.lat,
      east: bottomRight.lng,
      south: bottomRight.lat,
    });
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) this.discard();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || inFormControl(e.target)) return;
    this.discard();
    this.onCancel();
  };
}
