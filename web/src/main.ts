import { Map as MapLibreMap, NavigationControl, ScaleControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./app.css";
import {
  appUrl,
  BUSSTOPS_PMTILES_PATH,
  INITIAL_CENTER,
  INITIAL_ZOOM,
  PMTILES_PATH,
} from "./config";
import { pmtilesExists } from "./data";
import { installIcons } from "./icons";
import { downloadBlob, exportPdf, type ExportResult, pdfFilename } from "./print/export";
import { PrintPlacement, rectAround, withPlacementLayers } from "./placement";
import { PrintFrame } from "./print/frame";
import { BLEED_MM, EXPORT_DPI, type Orientation, printableArea } from "./print/paper";
import { zoomForScale } from "./print/scale";
import { initSidebar, setExportBusy, setStatus, updatePrintInfo } from "./sidebar";
import { getState, setState, subscribe } from "./state";
import { buildStyle, GROUPS, setGroupVisible } from "./style";
import { applyVectorTileZoom, VECTOR_TILE_ZOOM, type VectorTileZoomMode } from "./style/sources";
import { reliefUrls, setupMapLibre, tileLog, tileZoomHistogram } from "./tiles";

setupMapLibre();

// The GTFS bus stop file is optional: without it no source is added, and the app (placement, PDF
// export) works as before, only without bus stops. Probed once; the export reuses the result.
const busstopsUrl = appUrl(BUSSTOPS_PMTILES_PATH);
const busstopsAvailable = await pmtilesExists(busstopsUrl);
if (!busstopsAvailable) console.info(`Keine Bushaltestellen-Datei (${BUSSTOPS_PMTILES_PATH}).`);

function currentStyle() {
  return buildStyle({
    pmtilesUrl: appUrl(PMTILES_PATH),
    busstopsUrl: busstopsAvailable ? busstopsUrl : undefined,
    glyphsUrl: `${appUrl("fonts/")}{fontstack}/{range}.pbf`,
    relief: reliefUrls(),
    visibility: getState().visibility,
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

const frame = new PrintFrame(map, getState().print);

/** Toggle state of the group owning a layer (same rule as style/index.ts). */
function layerWanted(layerId: string): boolean {
  const group = GROUPS.find((g) => layerId.startsWith(`${g.id}-`));
  if (!group) return true;
  const key = group.toggledBy ?? group.id;
  const owner = GROUPS.find((g) => g.id === key) ?? group;
  return getState().visibility[key] ?? owner.defaultVisible;
}

// Print placement (PLAN.md 4a): in print view symbols are displaced instead of dropped,
// exactly as in the PDF; outside print view MapLibre's collision keeps the screen map tidy.
const placement = new PrintPlacement(map, placementLayers, {
  wanted: layerWanted,
  region: () => {
    const c = map.getCenter();
    const area = printableArea(getState().print.orientation);
    return rectAround(
      [c.lng, c.lat],
      map.getZoom(),
      area.width + 2 * BLEED_MM,
      area.height + 2 * BLEED_MM,
    );
  },
});

function printZoom(): number {
  return zoomForScale(getState().print.scale, map.getCenter().lat);
}

/** In print view the zoom follows the centre latitude exactly and user zooming is disabled. */
function syncPrintView(): void {
  const on = getState().printView;
  for (const h of [map.scrollZoom, map.doubleClickZoom, map.boxZoom, map.touchZoomRotate]) {
    if (on) h.disable();
    else h.enable();
  }
  if (on && Math.abs(map.getZoom() - printZoom()) > 1e-9) map.jumpTo({ zoom: printZoom() });
  if (placement.isActive() !== on) placement.setActive(on);
}

map.on("moveend", () => {
  if (getState().printView) syncPrintView();
  updatePrintInfo(printZoom());
});

subscribe((state, prev) => {
  if (state.print !== prev.print) {
    frame.setSettings(state.print);
    updatePrintInfo(printZoom());
  }
  if (state.printView !== prev.printView || state.print.scale !== prev.print.scale) syncPrintView();
  if (state.visibility !== prev.visibility) {
    for (const g of GROUPS) {
      if (state.visibility[g.id] !== prev.visibility[g.id]) {
        setGroupVisible(map, g.id, state.visibility[g.id] ?? g.defaultVisible);
      }
    }
    placement.sync();
  }
  if (state.print.orientation !== prev.print.orientation) placement.sync();
});

export interface ExportCallOptions {
  scale?: number;
  orientation?: Orientation;
  /** Automation only (tests); the UI always exports at EXPORT_DPI (300). */
  dpi?: number;
  center?: [number, number];
  vectorTileZoom?: VectorTileZoomMode;
  /** Trigger a browser download (default true from the UI, false from automation). */
  download?: boolean;
}

let busy = false;

async function runExport(options: ExportCallOptions = {}): Promise<ExportResult> {
  if (busy) throw new Error("Export läuft bereits");
  busy = true;
  setExportBusy(true);
  setStatus("Karte wird in Druckauflösung gerendert …");
  try {
    const s = getState().print;
    const c = map.getCenter();
    const result = await exportPdf({
      center: options.center ?? [c.lng, c.lat],
      scale: options.scale ?? s.scale,
      orientation: options.orientation ?? s.orientation,
      dpi: options.dpi ?? EXPORT_DPI,
      style: currentStyle(),
      vectorTileZoom: options.vectorTileZoom,
    });
    const m = result.meta;
    const mb = (result.blob.size / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 });
    const reliefWarning =
      m.reliefErrors > 0
        ? `Relief (Schummerung/Höhenlinien) unvollständig: ${m.reliefErrors} Kacheln nicht geladen (offline?).`
        : "";
    if (m.reduced) {
      setStatus(
        `Achtung: Der Browser hat die Auflösung reduziert (${Math.round(m.effectiveDpi)} statt ${m.dpi} dpi, ` +
          `${m.actualCanvasPx.join(" × ")} px). Der Maßstab stimmt trotzdem.` +
          (reliefWarning ? ` ${reliefWarning}` : ""),
        "warn",
      );
    } else if (reliefWarning) {
      setStatus(`Fertig, aber ${reliefWarning}`, "warn");
    } else {
      setStatus(`Fertig: ${m.imagePx.join(" × ")} px, ${m.dpi} dpi, ${mb} MB.`);
    }
    if (options.download ?? true) {
      downloadBlob(result.blob, pdfFilename(m.scale, m.orientation));
    }
    return result;
  } catch (err) {
    setStatus(
      `Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
    throw err;
  } finally {
    busy = false;
    setExportBusy(false);
  }
}

initSidebar({
  unavailableGroups: busstopsAvailable ? [] : ["busstops"],
  onExport: () => void runExport().catch((e) => console.error(e)),
  onCollapseChange: () => {
    map.resize();
    frame.update();
  },
});
updatePrintInfo(printZoom());

// Automation hook (browser tests, headless export).
declare global {
  interface Window {
    __capercailye: {
      map: MapLibreMap;
      exportPdf: (options?: ExportCallOptions) => Promise<ExportResult>;
      tileLog: typeof tileLog;
      tileZoomHistogram: typeof tileZoomHistogram;
      zoomForScale: typeof zoomForScale;
      vectorTileZoom: typeof VECTOR_TILE_ZOOM;
      setState: typeof setState;
      busstopsAvailable: boolean;
    };
  }
}

window.__capercailye = {
  map,
  exportPdf: (options = {}) => runExport({ download: false, ...options }),
  tileLog,
  tileZoomHistogram,
  zoomForScale,
  vectorTileZoom: VECTOR_TILE_ZOOM,
  setState,
  busstopsAvailable,
};
