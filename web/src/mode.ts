// Map modes (pure, testable): what the map lets the user do in each of them.
import type { Area } from "./print/layout";

/** Not to be confused with `PrintSettings.mode` (page count or scale leading). */
export type MapMode = "explore" | "draw" | "sheets";

export const MAP_MODES: readonly MapMode[] = ["explore", "draw", "sheets"];

/** Smallest side of a drawn area in screen px. */
export const MIN_DRAW_PX = 12;

/** Which of MapLibre's interaction handlers are enabled. */
export interface Interaction {
  dragPan: boolean;
  scrollZoom: boolean;
  doubleClickZoom: boolean;
  boxZoom: boolean;
  touchZoomRotate: boolean;
}

/**
 * Handlers per mode: drawing replaces dragging (and the gestures that would fight it) but keeps
 * wheel zoom and the keyboard; print view locks the zoom to the layout zoom.
 */
export function interactionFor(mode: MapMode, printView: boolean): Interaction {
  const drawing = mode === "draw";
  return {
    dragPan: !drawing,
    scrollZoom: !printView,
    doubleClickZoom: !printView && !drawing,
    boxZoom: !printView && !drawing,
    touchZoomRotate: !printView && !drawing,
  };
}

/**
 * Rectangle spanned by two points as `[x0, y0, x1, y1]` (x0 <= x1, y0 <= y1), or null if either
 * side is shorter than `minPx` (a click, not a drag).
 */
export function dragRect(
  a: readonly [number, number],
  b: readonly [number, number],
  minPx: number = MIN_DRAW_PX,
): [number, number, number, number] | null {
  const [x0, x1] = a[0] <= b[0] ? [a[0], b[0]] : [b[0], a[0]];
  const [y0, y1] = a[1] <= b[1] ? [a[1], b[1]] : [b[1], a[1]];
  return x1 - x0 < minPx || y1 - y0 < minPx ? null : [x0, y0, x1, y1];
}

/** True if the area does not intersect the visible bounds at all (touching counts as outside). */
export function areaOutside(area: Area, bounds: Area): boolean {
  return (
    area.east <= bounds.west ||
    area.west >= bounds.east ||
    area.north <= bounds.south ||
    area.south >= bounds.north
  );
}
