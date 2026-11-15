// Mobile bottom sheet (src/mobile-sheet.ts): breakpoint and the one event the app code
// uses to fold the sheet away so the map is visible.

/** Below this width the sidebar lives in the bottom sheet (keep in step with the @media in app.css). */
export const MOBILE_QUERY = "(max-width: 767px)";

const COLLAPSE_EVENT = "capercailye:sheet-collapse";

/** Snaps the sheet to its collapsed position (header and search field). No effect on desktop. */
export function collapseSheet(): void {
  document.dispatchEvent(new Event(COLLAPSE_EVENT));
}

/** Calls `handler` whenever `collapseSheet()` runs; returns the unsubscribe function. */
export function onCollapseSheet(handler: () => void): () => void {
  document.addEventListener(COLLAPSE_EVENT, handler);
  return () => document.removeEventListener(COLLAPSE_EVENT, handler);
}
