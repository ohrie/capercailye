// Minimal observable app state (no framework).
import type { Orientation } from "./print/paper";
import { defaultVisibility, type GroupVisibility } from "./style";

export interface PrintSettings {
  scale: number;
  orientation: Orientation;
  dpi: number;
}

export interface AppState {
  print: PrintSettings;
  /** Map is locked to the exact print zoom. */
  printView: boolean;
  visibility: GroupVisibility;
}

type Listener = (state: AppState, prev: AppState) => void;

let state: AppState = {
  print: { scale: 25000, orientation: "portrait", dpi: 254 },
  printView: false,
  visibility: defaultVisibility(),
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
