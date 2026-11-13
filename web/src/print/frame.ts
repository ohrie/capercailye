// A4 sheet frame drawn over the map, centred on the map centre.
import type { Map as MapLibreMap } from "maplibre-gl";
import { LEGEND_STRIP_MM, mmToCssPx, printableArea } from "./paper";
import { formatScale, zoomForScale } from "./scale";
import type { PrintSettings } from "../state";

const SVG_NS = "http://www.w3.org/2000/svg";

export class PrintFrame {
  private readonly svg: SVGSVGElement;
  private readonly mask: SVGPathElement;
  private readonly rect: SVGRectElement;
  private readonly strip: SVGRectElement;
  private readonly label: SVGTextElement;
  private settings: PrintSettings;

  constructor(
    private readonly map: MapLibreMap,
    settings: PrintSettings,
  ) {
    this.settings = settings;
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("print-frame");
    this.mask = document.createElementNS(SVG_NS, "path");
    this.mask.classList.add("print-frame__mask");
    this.mask.setAttribute("fill-rule", "evenodd");
    this.rect = document.createElementNS(SVG_NS, "rect");
    this.rect.classList.add("print-frame__sheet");
    this.strip = document.createElementNS(SVG_NS, "rect");
    this.strip.classList.add("print-frame__strip");
    this.label = document.createElementNS(SVG_NS, "text");
    this.label.classList.add("print-frame__label");
    this.svg.append(this.mask, this.strip, this.rect, this.label);
    map.getContainer().appendChild(this.svg);
    map.on("move", () => this.update());
    map.on("resize", () => this.update());
    this.update();
  }

  setSettings(settings: PrintSettings): void {
    this.settings = settings;
    this.update();
  }

  /** Print zoom for the current map centre. */
  printZoom(): number {
    return zoomForScale(this.settings.scale, this.map.getCenter().lat);
  }

  update(): void {
    const container = this.map.getContainer();
    const W = container.clientWidth;
    const H = container.clientHeight;
    const area = printableArea(this.settings.orientation);
    const factor = 2 ** (this.map.getZoom() - this.printZoom());
    const w = mmToCssPx(area.width) * factor;
    const h = mmToCssPx(area.height) * factor;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    const stripH = mmToCssPx(LEGEND_STRIP_MM) * factor;
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("width", String(W));
    this.svg.setAttribute("height", String(H));
    this.mask.setAttribute("d", `M0 0H${W}V${H}H0Z M${x} ${y}h${w}v${h}h${-w}Z`);
    for (const [el, ry, rh] of [
      [this.rect, y, h],
      [this.strip, y + h - stripH, stripH],
    ] as const) {
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(ry));
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(rh));
    }
    const orient = this.settings.orientation === "portrait" ? "hoch" : "quer";
    this.label.textContent = `A4 ${orient} · ${formatScale(this.settings.scale)}`;
    this.label.setAttribute("x", String(x));
    this.label.setAttribute("y", String(y - 6));
  }
}
