// Minimal observable app state (no framework).
import { type Area, computeLayout, type PrintMode, type SheetLayout } from "./print/layout";
import type { Track } from "./gpx";
import type { Orientation } from "./print/paper";
import { defaultVisibility, type GroupVisibility } from "./style";

export interface PrintSettings {
  /** "scale": the scale is chosen, the page count follows; "pages": the other way round. */
  mode: PrintMode;
  scale: number;
  pages: number;
  orientation: Orientation;
  /** Area to print (not persisted); set once the map exists, see main.ts. */
  area: Area | null;
}

export interface AppState {
  print: PrintSettings;
  /** Map is locked to the exact print zoom. */
  printView: boolean;
  visibility: GroupVisibility;
  /** The loaded GPX track (not persisted, like the area). */
  gpx: Track | null;
}

type Listener = (state: AppState, prev: AppState) => void;

let state: AppState = {
  print: { mode: "scale", scale: 25000, pages: 6, orientation: "portrait", area: null },
  printView: false,
  visibility: defaultVisibility(),
  gpx: null,
};
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  const prev = state;
  state = { ...state, ...patch };
  for (const l of listeners) l(state, prev);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let layoutMemo: { print: PrintSettings; layout: SheetLayout | null } | undefined;

/** Sheet layout of the current print settings (null until the area is set); memoised. */
export function currentLayout(print: PrintSettings = state.print): SheetLayout | null {
  if (layoutMemo?.print !== print) {
    layoutMemo = {
      print,
      layout: print.area ? computeLayout({ ...print, area: print.area }) : null,
    };
  }
  return layoutMemo.layout;
}
