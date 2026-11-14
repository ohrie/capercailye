// Print placement (PLAN.md 4a, M2b): symbols never drop out at the print scale.
//
// - layers.ts   which layers take part (layer metadata) and their clones on a GeoJSON source
// - displace.ts the displacement algorithm (pure, unit-tested)
// - collect.ts  features from the vector tiles -> paper mm -> placement -> GeoJSON
// - thin.ts     greedy thinning of urban restaurants/cafés by paper distance (8 mm)
//
// Waymark signs (waymarks/index.ts) are placed by the app BEFORE the pictograms: their boxes come in
// as obstacles (`setWaymarkObstacles`, `req.options.obstacles`) and the pictograms move off them.
// The same sheet-layout computation delivers which urban restaurants/cafés, toilets and hotels stay
// (`setUrbanKeep`, `req.urban`), so preview and every export page agree.
//
// The main map runs it only in print view (exact print zoom), recomputing after the map is idle
// whenever the view or the loaded tiles changed; elsewhere the original layers with MapLibre's
// own collision stay in charge (sensible screen map while zooming). The export map always runs
// it once before capturing (print/render.ts). Both place the sheet incl. bleed first and alone,
// with the same zoom and the same feature set, so the preview matches the PDF.
// Before placing, urban restaurants/cafés are thinned greedily to at least 8 mm of paper between
// kept ones (thin.ts). The greedy result depends on the whole neighbourhood, so it is computed once
// per sheet layout from the tiles (waymarks/index.ts) and handed in as a kept set.
import type { GeoJSONSource, Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl";
import { computePlacement, type UrbanKeep, type PlacementRequest } from "./collect";
import type { Obstacle } from "./displace";
import type { RectMm } from "./geo";
import { EMPTY_COLLECTION, ICON_CLONE_ID, type ManagedLayer, PLACEMENT_SOURCE } from "./layers";

export { computePlacement } from "./collect";
export { rectAround } from "./geo";
export { PLACEMENT_SOURCE, withPlacementLayers, type ManagedLayer } from "./layers";

export interface PrintPlacementOptions {
  /** Whether the toggle owning a displaced layer is on. */
  wanted: (layerId: string) => boolean;
  /** Sheet incl. bleed around the current centre at the current zoom. */
  region: () => RectMm;
}

/** Visibility of "fixed" layers is not ours to manage: read it from the map. */
function fixedWanted(map: MapLibreMap, id: string): boolean {
  return map.getLayer(id) !== undefined && map.getLayoutProperty(id, "visibility") !== "none";
}

export function setPlacementData(map: MapLibreMap, data: GeoJSON.FeatureCollection): void {
  map.getSource<GeoJSONSource>(PLACEMENT_SOURCE)?.setData(data);
}

/**
 * One-shot placement for the export map (style built with `active = true`); map must be idle.
 * Waymark boxes come in through `req.options.obstacles`, the urban decision through `req.urban`.
 */
export function placeForExport(
  map: MapLibreMap,
  managed: readonly ManagedLayer[],
  req: Omit<PlacementRequest, "wanted">,
): void {
  const result = computePlacement(map, managed, {
    ...req,
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
  private waymarkBoxes: readonly Obstacle[] = [];
  private urban: UrbanKeep | undefined;

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

  /** Boxes of the waymark signs (global paper mm): the pictograms move off them. */
  setWaymarkObstacles(boxes: readonly Obstacle[]): void {
    if (boxes === this.waymarkBoxes) return;
    this.waymarkBoxes = boxes;
    this.touch();
  }

  /** Urban restaurants/cafés, toilets and hotels that stay (sheet layout, waymarks/index.ts); undefined = fallback. */
  setUrbanKeep(urban: UrbanKeep | undefined): void {
    if (urban === this.urban) return;
    this.urban = urban;
    this.touch();
  }

  private touch(): void {
    this.dirty = true;
    if (this.active) this.map.triggerRepaint();
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
      options: { obstacles: this.waymarkBoxes },
      urban: this.urban,
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
