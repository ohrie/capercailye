// Bottom sheet for narrow screens (Cupertino Pane). The sidebar is not rebuilt: the existing #sidebar
// element (wired by src/sidebar.ts) is moved into the pane while the screen is narrow and back to
// its place in .app on wider screens, so all event listeners survive. The library is imported
// dynamically, so desktop visitors never download it.
import type { CupertinoPane, CupertinoSettings } from "cupertino-pane";
import { MOBILE_QUERY, onCollapseSheet } from "./sheet";

/** Height of the grip area above the content (keep in step with `.pane` padding in app.css). */
const GRIP_PX = 22;

/** Visible map strip above the sheet at the top break ("almost full"). */
const TOP_GAP_PX = 40;

/** Collapsed height until measured (never used: the sidebar exists before the pane is built). */
const FALLBACK_COLLAPSED_PX = 150;

interface Sheet {
  pane: CupertinoPane;
  host: HTMLElement;
  sidebar: HTMLElement;
  /** Where the sidebar sits on wider screens. */
  home: { parent: Node; next: Node | null };
  collapsedPx: number;
  stop: () => void;
}

let sheet: Sheet | null = null;

/** Collapsed = grip + sidebar header + search panel. */
function measureCollapsed(sidebar: HTMLElement): number {
  const parts = [sidebar.querySelector<HTMLElement>(".sidebar__header")];
  parts.push(sidebar.querySelector<HTMLElement>(".panel--search"));
  const px = parts.reduce((sum, el) => sum + (el?.offsetHeight ?? 0), 0);
  return px > 0 ? GRIP_PX + px : FALLBACK_COLLAPSED_PX;
}

function breaksFor(collapsedPx: number): NonNullable<CupertinoSettings["breaks"]> {
  const screenPx = window.innerHeight;
  return {
    top: { enabled: true, height: screenPx - TOP_GAP_PX },
    middle: { enabled: true, height: Math.max(Math.round(screenPx / 2), collapsedPx + 80) },
    bottom: { enabled: true, height: collapsedPx },
  };
}

/** Applies new break heights; the library re-locks them so its own resize handler keeps them. */
async function applyBreaks(s: Sheet): Promise<void> {
  s.pane.breakpoints.lockedBreakpoints = undefined;
  await s.pane.setBreakpoints(breaksFor(s.collapsedPx));
}

async function create(): Promise<Sheet | null> {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar?.parentNode) return null;
  const { CupertinoPane } = await import("cupertino-pane");
  // The media query may have flipped while the chunk loaded.
  if (!window.matchMedia(MOBILE_QUERY).matches) return null;

  const home = { parent: sidebar.parentNode, next: sidebar.nextSibling };
  const host = document.createElement("div");
  host.className = "mobile-sheet__host";
  // Invisible but laid out, so the collapsed height can be measured before the pane exists.
  host.style.cssText = "position:fixed;top:0;left:0;right:0;visibility:hidden";
  document.body.appendChild(host);
  host.appendChild(sidebar);
  const collapsedPx = measureCollapsed(sidebar);
  host.style.cssText = "";
  // The map's container changes size: let MapLibre and the print frame follow.
  window.dispatchEvent(new Event("resize"));

  const pane = new CupertinoPane(host, {
    cssClass: "mobile-sheet",
    parentElement: document.body,
    initialBreak: "bottom",
    breaks: breaksFor(collapsedPx),
    // Not dismissible, no backdrop: the map stays usable behind the sheet.
    backdrop: false,
    buttonDestroy: false,
    bottomClose: false,
    fastSwipeClose: false,
    lowerThanBottom: false,
    upperThanTop: false,
    // A tap on the collapsed sheet does nothing by itself (search focus opens it, see below).
    clickBottomOpen: false,
  });
  const s: Sheet = { pane, host, sidebar, home, collapsedPx, stop: () => {} };
  await pane.present({ animate: false });

  // New collapsed height (e.g. the header wraps): move the bottom break; a resize or rotation
  // changes the other two. Not while an input has focus: the on-screen keyboard resizes the window.
  const refresh = () => {
    const px = measureCollapsed(sidebar);
    if (px === s.collapsedPx) return;
    s.collapsedPx = px;
    void applyBreaks(s);
  };
  const observer = new ResizeObserver(refresh);
  for (const el of sidebar.querySelectorAll(".sidebar__header, .panel--search")) {
    observer.observe(el);
  }
  let frame = 0;
  const onResize = () => {
    if (document.activeElement instanceof HTMLInputElement) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => void applyBreaks(s));
  };
  window.addEventListener("resize", onResize);
  s.stop = () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
  };
  return s;
}

async function destroy(s: Sheet): Promise<void> {
  s.stop();
  await s.pane.destroy({ animate: false });
  // Set by the library on Android only; restore the page default.
  document.body.style.overscrollBehaviorY = "";
  s.home.parent.insertBefore(s.sidebar, s.home.next);
  s.host.remove();
  window.dispatchEvent(new Event("resize"));
}

/** Builds the sheet on narrow screens and removes it on wider ones; call once at page load. */
export function initMobileSheet(): void {
  const query = window.matchMedia(MOBILE_QUERY);
  // Changes are applied one after the other: creating takes time (import, present).
  let queue: Promise<void> = Promise.resolve();
  const sync = () => {
    queue = queue
      .then(async () => {
        if (query.matches && !sheet) sheet = await create();
        else if (!query.matches && sheet) {
          const old = sheet;
          sheet = null;
          await destroy(old);
        }
      })
      .catch((err: unknown) => console.error("mobile sheet", err));
  };
  query.addEventListener("change", sync);
  sync();

  onCollapseSheet(() => {
    if (sheet && sheet.pane.currentBreak() !== "bottom") void sheet.pane.moveToBreak("bottom");
  });
  // Search results hang below the field: open the sheet to half height when the field is used.
  document.addEventListener("focusin", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement) || target.id !== "search-input") return;
    if (sheet?.pane.currentBreak() === "bottom") void sheet.pane.moveToBreak("middle");
  });
}
