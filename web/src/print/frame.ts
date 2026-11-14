// Sheet layout drawn over the map: the area (dashed, with corner and centre handles), the grid of
// numbered A4 sheets and a mask over everything outside the grid. The layout comes from
// `computeLayout` (print/layout.ts); positions are projected with `map.project`.
//
// Dragging a handle only redraws this frame (draft area); the app state is set on pointerup, so
// zoom and placement do not recompute on every pixel.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { RectMm } from "../placement/geo";
import { mmToLngLat } from "../placement/geo";
import type { PrintSettings } from "../state";
import { currentLayout } from "../state";
import { type Area, computeLayout, layoutLabel, MAX_SHEETS, type SheetLayout } from "./layout";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Smallest area side while dragging, in screen px. */
const MIN_AREA_PX = 12;
const HANDLE_RADIUS = 7;

type Corner = "nw" | "ne" | "se" | "sw";
type Pt = [number, number];

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute("class", className);
  return node;
}

/** Elements created on demand and hidden when not needed (the sheet count changes often). */
class Pool<T extends SVGElement> {
  private readonly items: T[] = [];
  constructor(
    private readonly parent: SVGElement,
    private readonly make: () => T,
  ) {}

  use(count: number): T[] {
    while (this.items.length < count) {
      const item = this.make();
      this.items.push(item);
      this.parent.appendChild(item);
    }
    this.items.forEach((item, i) => item.toggleAttribute("hidden", i >= count));
    return this.items.slice(0, count);
  }
}

function setRect(el: SVGRectElement, x: number, y: number, w: number, h: number): void {
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("width", String(w));
  el.setAttribute("height", String(h));
}

export class PrintFrame {
  private readonly svg: SVGSVGElement;
  private readonly mask: SVGPathElement;
  private readonly strips: Pool<SVGRectElement>;
  private readonly outlines: Pool<SVGRectElement>;
  private readonly numbers: Pool<SVGTextElement>;
  private readonly areaRect: SVGRectElement;
  private readonly label: SVGTextElement;
  private readonly corners = new Map<Corner, SVGCircleElement>();
  private readonly mover: SVGCircleElement;
  private settings: PrintSettings;
  /** Shown only in mode "sheets"; hidden, nothing is drawn and no handle catches events. */
  private visible = true;
  /** Area while a handle is being dragged. */
  private draft: Area | null = null;

  constructor(
    private readonly map: MapLibreMap,
    settings: PrintSettings,
    private readonly onAreaChange: (area: Area) => void,
  ) {
    this.settings = settings;
    this.svg = svg("svg", "print-frame");
    this.mask = svg("path", "print-frame__mask");
    this.mask.setAttribute("fill-rule", "evenodd");
    const stripLayer = svg("g");
    const outlineLayer = svg("g");
    const numberLayer = svg("g");
    this.strips = new Pool(stripLayer, () => svg("rect", "print-frame__strip"));
    this.outlines = new Pool(outlineLayer, () => svg("rect", "print-frame__sheet"));
    this.numbers = new Pool(numberLayer, () => svg("text", "print-frame__number"));
    this.areaRect = svg("rect", "print-frame__area");
    this.label = svg("text", "print-frame__label");
    this.svg.append(this.mask, stripLayer, outlineLayer, numberLayer, this.areaRect, this.label);
    for (const corner of ["nw", "ne", "se", "sw"] as const) {
      const handle = this.makeHandle("print-frame__handle print-frame__handle--corner", corner);
      handle.dataset.corner = corner;
      this.corners.set(corner, handle);
    }
    this.mover = this.makeHandle("print-frame__handle print-frame__handle--move", "move");
    this.svg.append(...this.corners.values(), this.mover);
    map.getContainer().appendChild(this.svg);
    map.on("move", () => this.update());
    map.on("resize", () => this.update());
    this.update();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.draft = null;
    this.update();
  }

  setSettings(settings: PrintSettings): void {
    this.settings = settings;
    this.draft = null;
    this.update();
  }

  private layout(): SheetLayout | null {
    if (this.draft) return computeLayout({ ...this.settings, area: this.draft });
    return currentLayout(this.settings);
  }

  private project(xMm: number, yMm: number, zoom: number): Pt {
    const p = this.map.project(mmToLngLat(xMm, yMm, zoom));
    return [p.x, p.y];
  }

  update(): void {
    const container = this.map.getContainer();
    const W = container.clientWidth;
    const H = container.clientHeight;
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("width", String(W));
    this.svg.setAttribute("height", String(H));

    const layout = this.visible ? this.layout() : null;
    this.svg.toggleAttribute("hidden", !layout);
    if (!layout) return;
    const zoom = layout.zoom;
    const rectPx = (r: RectMm) => {
      const [x0, y0] = this.project(r.minX, r.minY, zoom);
      const [x1, y1] = this.project(r.maxX, r.maxY, zoom);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };

    // Area (always) with its handles.
    const a = rectPx(layout.areaMm);
    setRect(this.areaRect, a.x, a.y, a.w, a.h);
    const pos: Record<Corner, Pt> = {
      nw: [a.x, a.y],
      ne: [a.x + a.w, a.y],
      se: [a.x + a.w, a.y + a.h],
      sw: [a.x, a.y + a.h],
    };
    for (const [corner, handle] of this.corners) {
      handle.setAttribute("cx", String(pos[corner][0]));
      handle.setAttribute("cy", String(pos[corner][1]));
    }
    this.mover.setAttribute("cx", String(a.x + a.w / 2));
    this.mover.setAttribute("cy", String(a.y + a.h / 2));

    // Grid, strips, numbers. Too many sheets: only the area outline.
    const sheets = layout.sheets;
    const g = rectPx(layout.gridMm);
    if (layout.tooLarge) {
      this.mask.setAttribute("d", "");
    } else {
      this.mask.setAttribute("d", `M0 0H${W}V${H}H0Z M${g.x} ${g.y}h${g.w}v${g.h}h${-g.w}Z`);
    }
    const strips = this.strips.use(sheets.length);
    const outlines = this.outlines.use(sheets.length);
    const numbers = this.numbers.use(layout.count > 1 ? sheets.length : 0);
    sheets.forEach((sheet, i) => {
      const p = rectPx(sheet.printMm);
      const f = rectPx(sheet.fieldMm);
      setRect(outlines[i]!, p.x, p.y, p.w, p.h);
      setRect(strips[i]!, p.x, f.y + f.h, p.w, p.y + p.h - (f.y + f.h));
      const n = numbers[i];
      if (n) {
        n.textContent = String(sheet.number);
        n.setAttribute("x", String(f.x + f.w / 2));
        n.setAttribute("y", String(f.y + f.h / 2));
        n.setAttribute("font-size", String(Math.max(14, Math.min(80, 0.35 * Math.min(f.w, f.h)))));
      }
    });

    // Label above the grid's top left corner (above the area if there is no grid).
    const top = layout.tooLarge ? a : g;
    this.label.textContent = layout.tooLarge
      ? `Gebiet zu groß: ${layout.count} Seiten (höchstens ${MAX_SHEETS})`
      : layoutLabel(layout);
    this.label.setAttribute("x", String(Math.max(6, top.x)));
    this.label.setAttribute("y", String(Math.max(16, top.y - 6)));
  }

  private makeHandle(className: string, kind: Corner | "move"): SVGCircleElement {
    const handle = svg("circle", className);
    handle.setAttribute("r", String(kind === "move" ? HANDLE_RADIUS + 2 : HANDLE_RADIUS));
    // The map must not see these events (it would pan or select under the handle).
    for (const type of ["pointerdown", "mousedown", "touchstart"] as const) {
      handle.addEventListener(type, (e) => e.stopPropagation());
    }
    handle.addEventListener("pointerdown", (e) => this.startDrag(e, handle, kind));
    return handle;
  }

  private startDrag(e: PointerEvent, handle: SVGCircleElement, kind: Corner | "move"): void {
    const start = this.settings.area ? (this.draft ?? this.settings.area) : null;
    if (!start || e.button !== 0) return;
    e.preventDefault();
    const bounds = this.svg.getBoundingClientRect();
    const at = (ev: PointerEvent): Pt => [ev.clientX - bounds.left, ev.clientY - bounds.top];
    const origin = at(e);
    const nw = this.map.project([start.west, start.north]);
    const se = this.map.project([start.east, start.south]);
    const corner: Record<Corner, Pt> = {
      nw: [nw.x, nw.y],
      ne: [se.x, nw.y],
      se: [se.x, se.y],
      sw: [nw.x, se.y],
    };
    const opposite: Record<Corner, Corner> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };

    const dragPanWas = this.map.dragPan.isEnabled();
    this.map.dragPan.disable();
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const [px, py] = at(ev);
      const dx = px - origin[0];
      const dy = py - origin[1];
      let x0: number, y0: number, x1: number, y1: number;
      if (kind === "move") {
        [x0, y0, x1, y1] = [nw.x + dx, nw.y + dy, se.x + dx, se.y + dy];
      } else {
        // The opposite corner stays; the grabbed one follows the pointer (keeping the grab offset).
        const fixed = corner[opposite[kind]];
        let mx = corner[kind][0] + dx;
        let my = corner[kind][1] + dy;
        if (Math.abs(mx - fixed[0]) < MIN_AREA_PX) {
          mx = fixed[0] + (mx >= fixed[0] ? MIN_AREA_PX : -MIN_AREA_PX);
        }
        if (Math.abs(my - fixed[1]) < MIN_AREA_PX) {
          my = fixed[1] + (my >= fixed[1] ? MIN_AREA_PX : -MIN_AREA_PX);
        }
        [x0, y0, x1, y1] = [
          Math.min(fixed[0], mx),
          Math.min(fixed[1], my),
          Math.max(fixed[0], mx),
          Math.max(fixed[1], my),
        ];
      }
      const topLeft = this.map.unproject([x0, y0]);
      const bottomRight = this.map.unproject([x1, y1]);
      this.draft = {
        west: topLeft.lng,
        north: topLeft.lat,
        east: bottomRight.lng,
        south: bottomRight.lat,
      };
      this.update();
    };
    const finish = (commit: boolean) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      if (dragPanWas) this.map.dragPan.enable();
      const draft = this.draft;
      this.draft = null;
      if (commit && draft) this.onAreaChange(draft);
      else this.update();
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  }
}
