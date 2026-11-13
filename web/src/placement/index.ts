// Print placement (PLAN.md 4a, M2b): symbols never drop out at the print scale.
//
// - layers.ts   which layers take part (layer metadata) and their clones on a GeoJSON source
// - displace.ts the displacement algorithm (pure, unit-tested)
// - collect.ts  features from the vector tiles -> paper mm -> placement -> GeoJSON
// - rendered.ts boxes of symbols MapLibre placed itself ("obstacle": waymarks) as obstacles
//
// The main map runs it only in print view (exact print zoom), recomputing after the map is idle
// whenever the view or the loaded tiles changed; elsewhere the original layers with MapLibre's
// own collision stay in charge (sensible screen map while zooming). The export map always runs
// it once before capturing (print/render.ts). Both place the sheet incl. bleed first and alone,
// with the same zoom and the same feature set, so the preview matches the PDF.
import type { GeoJSONSource, Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl";
import { computePlacement, type PlacementRequest } from "./collect";
import type { RectMm } from "./geo";
import { EMPTY_COLLECTION, ICON_CLONE_ID, type ManagedLayer, PLACEMENT_SOURCE } from "./layers";
import { renderedObstacles } from "./rendered";

export { computePlacement } from "./collect";
export { rectAround } from "./geo";
export { PLACEMENT_SOURCE, withPlacementLayers, type ManagedLayer } from "./layers";

export interface PrintPlacementOptions {
  /** Whether the toggle owning a displaced layer is on. */
  wanted: (layerId: string) => boolean;
  /** Sheet incl. bleed around the current centre at the current zoom. */
  region: () => RectMm;
}

/** Visibility of "fixed" and "obstacle" layers is not ours to manage: read it from the map. */
function fixedWanted(map: MapLibreMap, id: string): boolean {
  return map.getLayer(id) !== undefined && map.getLayoutProperty(id, "visibility") !== "none";
}

export function setPlacementData(map: MapLibreMap, data: GeoJSON.FeatureCollection): void {
  map.getSource<GeoJSONSource>(PLACEMENT_SOURCE)?.setData(data);
}

/** Placed boxes of the visible "obstacle" layers (waymarks); call when the map is idle. */
function obstacles(map: MapLibreMap, managed: readonly ManagedLayer[], zoom: number) {
  const layers = managed.filter((m) => m.role === "obstacle" && fixedWanted(map, m.id));
  return renderedObstacles(map, layers, zoom);
}

/** One-shot placement for the export map (style built with `active = true`); map must be idle. */
export function placeForExport(
  map: MapLibreMap,
  managed: readonly ManagedLayer[],
  req: Omit<PlacementRequest, "wanted">,
): void {
  const result = computePlacement(map, managed, {
    ...req,
    options: {
      ...req.options,
      obstacles: [...(req.options?.obstacles ?? []), ...obstacles(map, managed, req.zoom)],
    },
    wanted: (m) =>
      m.role === "fixed"
        ? fixedWanted(map, m.id)
        : (m.spec.layout as { visibility?: string } | undefined)?.visibility !== "none",
  });
  setPlacementData(map, result.data);
}

/** Placement controller for the interactive map. */
export class PrintPlacement {
  private active = false;
  private dirty = true;
  private lastData = "";

  constructor(
    private readonly map: MapLibreMap,
    private readonly managed: readonly ManagedLayer[],
    private readonly options: PrintPlacementOptions,
  ) {
    const touch = () => {
      this.dirty = true;
    };
    map.on("moveend", touch);
    map.on("resize", touch);
    map.on("sourcedata", (e: MapSourceDataEvent) => {
      if (e.sourceId !== PLACEMENT_SOURCE && e.tile) this.dirty = true;
    });
    map.on("idle", () => this.recompute());
  }

  isActive(): boolean {
    return this.active;
  }

  /** Print mode on/off; call after group visibilities changed, too. */
  setActive(active: boolean): void {
    this.active = active;
    this.dirty = true;
    this.sync();
    if (!active) this.setData(EMPTY_COLLECTION);
    else this.recompute();
  }

  /** Re-applies original/clone visibility from the toggles (after setGroupVisible). */
  sync(): void {
    const map = this.map;
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    let anyWanted = false;
    for (const m of this.managed) {
      if (m.role !== "displace") continue;
      const wanted = this.options.wanted(m.id);
      anyWanted ||= wanted;
      set(m.id, wanted && !this.active);
      for (const c of m.clones) set(c, wanted && this.active);
    }
    // The icons of all displaced layers share one clone layer (placement/layers.ts).
    set(ICON_CLONE_ID, anyWanted && this.active);
    this.dirty = true;
    // Region or toggles may have changed without a camera move: make sure "idle" comes again.
    map.triggerRepaint();
  }

  private recompute(): void {
    if (!this.active || !this.dirty) return;
    if (!this.map.isStyleLoaded()) return;
    this.dirty = false;
    const zoom = this.map.getZoom();
    const result = computePlacement(this.map, this.managed, {
      zoom,
      region: this.options.region(),
      outside: true,
      options: { obstacles: obstacles(this.map, this.managed, zoom) },
      wanted: (m) => (m.role === "fixed" ? fixedWanted(this.map, m.id) : this.options.wanted(m.id)),
    });
    this.setData(result.data);
  }

  private setData(data: GeoJSON.FeatureCollection): void {
    const json = JSON.stringify(data);
    if (json === this.lastData) return;
    this.lastData = json;
    setPlacementData(this.map, data);
  }
}
