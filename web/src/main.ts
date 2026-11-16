import {
  type GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import "./app.css";
import {
  appUrl,
  BUSSTOPS_PMTILES_PATH,
  INITIAL_CENTER,
  INITIAL_ZOOM,
  PMTILES_PATH,
} from "./config";
import { buildCredits, gtfsStand, osmStand } from "./credits";
import { pmtilesExists, pmtilesMetadata } from "./data";
import { areaForTrack, initGpxDrop, parseGpx, readGpxFile, type TrackResult } from "./gpx";
import { installIcons } from "./icons";
import { formatNumber } from "./i18n";
import { areaOutside, interactionFor, type MapMode } from "./mode";
import { m } from "./paraglide/messages.js";
import { downloadBlob, exportLayout, type ExportResult, isAbortError } from "./print/export";
import { PrintPlacement, rectAround, withPlacementLayers } from "./placement";
import type { Obstacle } from "./placement/displace";
import { mmToLngLat, type RectMm } from "./placement/geo";
import { AreaDrawer } from "./print/draw";
import { PrintFrame } from "./print/frame";
import {
  type Area,
  computeLayout,
  defaultArea,
  type LayoutSettings,
  layoutFilename,
  type PrintMode,
  recenterArea,
  type SheetLayout,
} from "./print/layout";
import { BLEED_MM, EXPORT_DPI, type Orientation, printableArea } from "./print/paper";
import { zoomForScale } from "./print/scale";
import { initSearch } from "./search";
import { collapseSheet } from "./sheet";
import {
  initSidebar,
  setAttribution,
  setExportBusy,
  setGpxStatus,
  setStatus,
  updatePrintInfo,
} from "./sidebar";
import { currentLayout, getState, setState, subscribe } from "./state";
import { buildStyle, GROUPS, setGroupVisible } from "./style";
import {
  applyVectorTileZoom,
  EMPTY_GPX,
  GPX_SOURCE,
  VECTOR_TILE_ZOOM,
  type VectorTileZoomMode,
} from "./style/sources";
import { reliefUrls, setupMapLibre, tileLog, tileZoomHistogram } from "./tiles";
import { computeWaymarks, WaymarkController } from "./waymarks";

setupMapLibre();

// The GTFS bus stop file is optional: without it no source is added, and the app (placement, PDF
// export) works as before, only without bus stops. Probed once; the export reuses the result.
// The data dates of OSM and GTFS come from the PMTiles metadata, read in parallel with the probe.
const pmtilesUrl = appUrl(PMTILES_PATH);
const busstopsUrl = appUrl(BUSSTOPS_PMTILES_PATH);
const [busstopsAvailable, osmMeta, busstopsMeta] = await Promise.all([
  pmtilesExists(busstopsUrl),
  pmtilesMetadata(pmtilesUrl),
  pmtilesMetadata(busstopsUrl),
]);
if (!busstopsAvailable) console.info(`No bus stop file (${BUSSTOPS_PMTILES_PATH}).`);

/** Source credits, built once: map attribution and sidebar with data dates, PDF line without. */
const credits = buildCredits({
  osm: osmStand(osmMeta),
  gtfs: busstopsAvailable ? gtfsStand(busstopsMeta) : undefined,
  busstopsAvailable,
  // The PDF line points to <host>/quellen; the domain is not hard-coded in the app.
  host: window.location.host,
});

function currentStyle(waymarks?: FeatureCollection) {
  return buildStyle({
    pmtilesUrl,
    busstopsUrl: busstopsAvailable ? busstopsUrl : undefined,
    glyphsUrl: `${appUrl("fonts/")}{fontstack}/{range}.pbf`,
    relief: reliefUrls(),
    credits,
    visibility: getState().visibility,
    // The hidden export map renders the track, too.
    gpx: getState().gpx?.data,
    // The placed waymark signs (the export passes its layout-wide result).
    waymarks,
  });
}

// The main map carries the print-placement clones from the start (hidden until print view).
const { style: initialStyle, managed: placementLayers } = withPlacementLayers(
  currentStyle(),
  false,
);

const map = new MapLibreMap({
  container: "map",
  style: initialStyle,
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  maxPitch: 0,
  dragRotate: false,
  attributionControl: { compact: true },
  hash: true,
});
installIcons(map);
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new NavigationControl({ showCompass: false }), "top-right");
map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
applyVectorTileZoom(map);

// The area starts as 90 % of one map field around the map centre: one sheet, as before.
{
  const c = map.getCenter();
  const print = getState().print;
  setState({
    print: { ...print, area: defaultArea([c.lng, c.lat], print.orientation, print.scale) },
  });
}

/** Layout of the current print settings (the area is set above). */
function layout(): SheetLayout {
  return currentLayout()!;
}

function setArea(area: Area): void {
  setState({ print: { ...getState().print, area } });
}

const frame = new PrintFrame(map, getState().print, setArea);
// Mode "explore" (the start): no frame, no mask, no handles.
frame.setVisible(false);

/** Mode before drawing started: Escape returns there. */
let modeBeforeDraw: MapMode = "explore";

/** Drawing: a drawn rectangle becomes the print area and the app shows the sheets. */
const drawer = new AreaDrawer(
  map,
  (area) => {
    setState({ mode: "sheets", print: { ...getState().print, area } });
    fitSheets();
  },
  () => setState({ mode: modeBeforeDraw }),
);

/** After drawing: zooms out (never in) so the whole sheet grid is visible; not in print view (fixed zoom). */
function fitSheets(): void {
  const l = currentLayout();
  if (!l || getState().printView) return;
  const [west, north] = mmToLngLat(l.gridMm.minX, l.gridMm.minY, l.zoom);
  const [east, south] = mmToLngLat(l.gridMm.maxX, l.gridMm.maxY, l.zoom);
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: 40, duration: 600, maxZoom: map.getZoom() },
  );
}

function viewBounds(): Area {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}

/**
 * Mode switch from the sidebar. From "explore" to "sheets" the area is moved to the map centre if
 * it lies completely outside the view (you print where you are looking); otherwise it stays.
 */
function selectMode(mode: MapMode): void {
  const s = getState();
  if (mode === s.mode) return;
  // Drawing and placing the sheets happen on the map: fold the mobile sheet away.
  if (mode !== "explore") collapseSheet();
  const area = s.print.area;
  if (mode === "sheets" && s.mode === "explore" && area && areaOutside(area, viewBounds())) {
    const c = map.getCenter();
    setState({ mode, print: { ...s.print, area: recenterArea(area, [c.lng, c.lat]) } });
  } else {
    setState({ mode });
  }
}

/** Handler enablement follows the mode and the print view (see interactionFor in mode.ts). */
function syncInteraction(): void {
  const { mode, printView } = getState();
  const i = interactionFor(mode, printView);
  for (const [handler, on] of [
    [map.dragPan, i.dragPan],
    [map.scrollZoom, i.scrollZoom],
    [map.doubleClickZoom, i.doubleClickZoom],
    [map.boxZoom, i.boxZoom],
    [map.touchZoomRotate, i.touchZoomRotate],
  ] as const) {
    if (on) handler.enable();
    else handler.disable();
  }
}

/** Toggle state of the group owning a layer (same rule as style/index.ts). */
function layerWanted(layerId: string): boolean {
  const group = GROUPS.find((g) => layerId.startsWith(`${g.id}-`));
  if (!group) return true;
  const key = group.toggledBy ?? group.id;
  const owner = GROUPS.find((g) => g.id === key) ?? group;
  return getState().visibility[key] ?? owner.defaultVisible;
}

// Print placement (SPEC.md 4.4): in print view symbols are displaced instead of dropped,
// exactly as in the PDF; outside print view MapLibre's collision keeps the screen map tidy.
/**
 * Region of the print view: all sheets incl. bleed at the layout zoom. Too many sheets: just one
 * sheet around the centre (the grid would be huge; there is no export then anyway).
 */
function placementRegion(): RectMm {
  const l = layout();
  if (!l.tooLarge) return l.regionMm;
  const c = map.getCenter();
  const area = printableArea(l.orientation);
  return rectAround([c.lng, c.lat], l.zoom, area.width + 2 * BLEED_MM, area.height + 2 * BLEED_MM);
}

const placement = new PrintPlacement(map, placementLayers, {
  wanted: layerWanted,
  region: placementRegion,
});

// Waymark signs (SPEC.md 4.5): placed by the app, one by one along the routes. In print view the
// plan covers the sheet layout (the same result as the export), otherwise the viewport. Its boxes
// are obstacles of the pictogram placement, and it decides which urban restaurants/cafés, toilets and hotels stay.
const NO_BOXES: Obstacle[] = [];
const waymarks = new WaymarkController(map, pmtilesUrl, {
  printRegion: () =>
    getState().printView ? { region: placementRegion(), zoom: printZoom() } : null,
  visibility: () => getState().visibility,
  onResult: (r) => {
    const printView = getState().printView;
    placement.setWaymarkObstacles(printView ? r.boxes : NO_BOXES);
    placement.setUrbanKeep(printView ? r.urban : undefined);
  },
});
map.once("load", () => waymarks.update());

function printZoom(): number {
  return layout().zoom;
}

/** In print view the zoom is the layout zoom exactly (user zooming is off, see syncInteraction). */
function syncPrintView(): void {
  const on = getState().printView;
  if (on && Math.abs(map.getZoom() - printZoom()) > 1e-9) map.jumpTo({ zoom: printZoom() });
  if (placement.isActive() !== on) placement.setActive(on);
}

map.on("moveend", () => {
  if (getState().printView) syncPrintView();
});

subscribe((state, prev) => {
  if (state.mode !== prev.mode) {
    if (state.mode === "draw") modeBeforeDraw = prev.mode === "draw" ? modeBeforeDraw : prev.mode;
    frame.setVisible(state.mode === "sheets");
    if (state.mode === "draw") drawer.enable();
    else drawer.disable();
    map.getContainer().classList.toggle("map--draw", state.mode === "draw");
  }
  if (state.mode !== prev.mode || state.printView !== prev.printView) syncInteraction();
  if (state.print !== prev.print) {
    frame.setSettings(state.print);
    updatePrintInfo(layout());
  }
  if (state.printView !== prev.printView || state.print !== prev.print) syncPrintView();
  if (state.visibility !== prev.visibility) {
    for (const g of GROUPS) {
      if (state.visibility[g.id] !== prev.visibility[g.id]) {
        setGroupVisible(map, g.id, state.visibility[g.id] ?? g.defaultVisible, state.visibility);
      }
    }
    placement.sync();
  }
  // Sheets, scale or zoom changed: region and visibility of the placement follow.
  if (state.print !== prev.print) placement.sync();
  // Switches ("Hiking routes" and the network switches decide band and signs alike; recomputed on every
  // visibility change, the result is cached by key), print view or layout: new signs.
  if (
    state.visibility !== prev.visibility ||
    state.printView !== prev.printView ||
    state.print !== prev.print
  ) {
    waymarks.update();
  }
  if (state.gpx !== prev.gpx) applyGpxData();
});

/** Puts the loaded track (or nothing) on the map's `gpx` source; the fixed markers re-place. */
function applyGpxData(): void {
  const apply = () => {
    map.getSource<GeoJSONSource>(GPX_SOURCE)?.setData(getState().gpx?.data ?? EMPTY_GPX);
    placement.sync();
  };
  if (map.getSource(GPX_SOURCE)) apply();
  else map.once("load", apply);
}

/** Shows the area (the track plus margin) with the sidebar's padding; print view only re-centres. */
function fitArea(area: Area): void {
  if (getState().printView) {
    map.setCenter([(area.west + area.east) / 2, (area.south + area.north) / 2]);
  } else {
    map.fitBounds(
      [
        [area.west, area.south],
        [area.east, area.north],
      ],
      { padding: 40, duration: 600 },
    );
  }
}

/** Takes over a parsed track: state, print area on the track, map fitted to it. */
function useTrack(result: TrackResult): TrackResult {
  if ("error" in result) {
    setGpxStatus(result.error);
    return result;
  }
  const area = areaForTrack(result.track.bounds);
  // The track sets the area and shows the sheets, in one step.
  setState({ gpx: result.track, mode: "sheets", print: { ...getState().print, area } });
  fitArea(area);
  return result;
}

function gpxToArea(): void {
  const gpx = getState().gpx;
  if (!gpx) return;
  const area = areaForTrack(gpx.bounds);
  setState({ mode: "sheets", print: { ...getState().print, area } });
  fitArea(area);
}

function clearGpx(): void {
  setState({ gpx: null });
  setGpxStatus("");
}

export interface ExportCallOptions {
  /** These override `state.print` for this export only. */
  mode?: PrintMode;
  scale?: number;
  pages?: number;
  area?: Area;
  orientation?: Orientation;
  /** Automation only (tests); the UI always exports at EXPORT_DPI (300). */
  dpi?: number;
  /** Without `area`: area of one default sheet around this centre (lng/lat) instead of the state's. */
  center?: [number, number];
  vectorTileZoom?: VectorTileZoomMode;
  /** Trigger a browser download (default true from the UI, false from automation). */
  download?: boolean;
  /** Abort between sheets (the running sheet is finished first). */
  signal?: AbortSignal;
}

let busy = false;
let abort: AbortController | null = null;

/** Layout of the current print settings with optional overrides (area required in the end). */
function layoutFor(options: Partial<LayoutSettings> & { center?: [number, number] }): SheetLayout {
  const s = getState().print;
  const orientation = options.orientation ?? s.orientation;
  const scale = options.scale ?? s.scale;
  const area =
    options.area ?? (options.center ? defaultArea(options.center, orientation, scale) : s.area);
  if (!area) throw new Error(m.app_error_no_area());
  return computeLayout({
    mode: options.mode ?? s.mode,
    scale,
    pages: options.pages ?? s.pages,
    orientation,
    area,
  });
}

function cancelExport(): void {
  abort?.abort();
}

async function runExport(options: ExportCallOptions = {}): Promise<ExportResult> {
  if (busy) throw new Error(m.app_error_export_running());
  const l = layoutFor(options);
  busy = true;
  const controller = new AbortController();
  abort = controller;
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  setExportBusy(true);
  collapseSheet();
  setStatus(m.app_status_waymarks());
  try {
    // One result for the whole layout: every sheet gets the same signs, obstacles and urban set
    // (the preview used the same, see waymarks/index.ts).
    const wm = await computeWaymarks({
      pmtilesUrl,
      region: l.regionMm,
      zoom: l.zoom,
      visibility: getState().visibility,
    });
    if (controller.signal.aborted) throw new DOMException(m.app_status_cancelled(), "AbortError");
    setStatus(m.app_status_rendering());
    const result = await exportLayout(l, {
      style: currentStyle(wm.data),
      waymarkObstacles: wm.boxes,
      urban: wm.urban,
      dpi: options.dpi ?? EXPORT_DPI,
      credits: credits.line,
      vectorTileZoom: options.vectorTileZoom,
      signal: controller.signal,
      onProgress: (n, total) => {
        if (total > 1) setStatus(m.app_status_page({ n, total }));
      },
    });
    const meta = result.meta;
    const size = formatNumber(result.blob.size / 1e6, { maximumFractionDigits: 1 });
    const reliefWarning =
      meta.reliefErrors > 0 ? m.app_status_relief_warning({ count: meta.reliefErrors }) : "";
    const weakest = meta.pages.reduce((a, p) => (p.effectiveDpi < a.effectiveDpi ? p : a));
    if (meta.reduced) {
      setStatus(
        m.app_status_reduced({
          effective: Math.round(meta.effectiveDpi),
          dpi: meta.dpi,
          size: weakest.actualCanvasPx.join(" × "),
        }) + (reliefWarning ? ` ${reliefWarning}` : ""),
        "warn",
      );
    } else if (reliefWarning) {
      setStatus(m.app_status_done_with_warning({ warning: reliefWarning }), "warn");
    } else {
      setStatus(
        meta.pageCount > 1
          ? m.app_status_done_pages({ count: meta.pageCount, dpi: meta.dpi, size })
          : m.app_status_done({ dpi: meta.dpi, size }),
      );
    }
    if (options.download ?? true) downloadBlob(result.blob, layoutFilename(l));
    return result;
  } catch (err) {
    if (isAbortError(err)) {
      setStatus(m.app_status_cancelled());
    } else {
      setStatus(
        m.app_status_failed({ reason: err instanceof Error ? err.message : String(err) }),
        "error",
      );
    }
    throw err;
  } finally {
    busy = false;
    abort = null;
    setExportBusy(false);
  }
}

initSidebar({
  onMode: selectMode,
  unavailableGroups: busstopsAvailable ? [] : ["busstops"],
  onExport: () =>
    void runExport().catch((e) => {
      if (!isAbortError(e)) console.error(e);
    }),
  onCancel: cancelExport,
  onGpxFile: (file) => void readGpxFile(file).then(useTrack),
  onGpxArea: gpxToArea,
  onGpxRemove: clearGpx,
  onCollapseChange: () => {
    map.resize();
    frame.update();
  },
});
updatePrintInfo(layout());
setAttribution(credits.sidebar);
syncInteraction();
initSearch(map);
initGpxDrop(document.getElementById("map")!, (file) => void readGpxFile(file).then(useTrack));

// Automation hook (browser tests, headless export).
declare global {
  interface Window {
    __capercailye: {
      map: MapLibreMap;
      exportPdf: (options?: ExportCallOptions) => Promise<ExportResult>;
      /** Computed sheet layout (no map objects) for the current settings, optionally overridden. */
      layout: (settings?: Partial<LayoutSettings>) => SheetLayout;
      tileLog: typeof tileLog;
      tileZoomHistogram: typeof tileZoomHistogram;
      zoomForScale: typeof zoomForScale;
      vectorTileZoom: typeof VECTOR_TILE_ZOOM;
      setState: typeof setState;
      busstopsAvailable: boolean;
      /** Built source credits (map attribution and sidebar with dates, `line` for the PDF without). */
      credits: ReturnType<typeof buildCredits>;
      /** Loads GPX text like the file chooser does (state, area, map); returns the parse result. */
      loadGpx: (text: string) => TrackResult;
      clearGpx: () => void;
    };
  }
}

window.__capercailye = {
  map,
  exportPdf: (options = {}) => runExport({ download: false, ...options }),
  layout: (settings = {}) => layoutFor(settings),
  tileLog,
  tileZoomHistogram,
  zoomForScale,
  vectorTileZoom: VECTOR_TILE_ZOOM,
  setState,
  busstopsAvailable,
  credits,
  loadGpx: (text) => useTrack(parseGpx(text, m.gpx_default_name())),
  clearGpx,
};
