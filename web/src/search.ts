// Place search over Photon (komoot). The pure parts (URL, response parsing) are unit-tested; the
// DOM part `initSearch` wires the sidebar field, the result list and the jump on the map.
//
// Privacy: the request carries exactly the search text and the map centre rounded to three
// decimals (about 100 m) as a ranking bias; no zoom, no ids, no cookies, no referrer.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Locale } from "./i18n";
import { m } from "./paraglide/messages.js";
import { getLocale } from "./paraglide/runtime.js";
import { getState } from "./state";
import { collapseSheet } from "./sheet";

export const PHOTON_URL = "https://photon.komoot.io/api";
export const MIN_QUERY_LENGTH = 3;
export const DEBOUNCE_MS = 300;
export const RESULT_LIMIT = 8;
/** A request that has not answered after this long counts as unreachable. */
const TIMEOUT_MS = 10_000;

export interface SearchResult {
  /** Name (or street and house number) of the hit. */
  label: string;
  /** Second line: place, county / state, kind. May be empty. */
  detail: string;
  /** [lng, lat] */
  center: [number, number];
  /** [west, south, east, north] of the hit's extent; points have none. */
  bounds?: [number, number, number, number];
}

/**
 * Request URL: only `q`, `lang` (the active language, Photon knows `de` and `en`), `limit` and
 * the rounded map centre as `lat`/`lon`.
 */
export function photonUrl(
  query: string,
  center: { lng: number; lat: number },
  locale: Locale = getLocale(),
): string {
  const params = new URLSearchParams({
    q: query,
    lang: locale,
    limit: String(RESULT_LIMIT),
    lat: center.lat.toFixed(3),
    lon: center.lng.toFixed(3),
  });
  return `${PHOTON_URL}?${params}`;
}

/** Kind names for `osm_value` in the active language; unknown values get no kind. */
const KIND_NAMES: Record<string, (locale?: Locale) => string> = {
  city: (locale) => m.search_kind_city({}, { locale }),
  town: (locale) => m.search_kind_town({}, { locale }),
  village: (locale) => m.search_kind_village({}, { locale }),
  hamlet: (locale) => m.search_kind_hamlet({}, { locale }),
  suburb: (locale) => m.search_kind_district({}, { locale }),
  quarter: (locale) => m.search_kind_district({}, { locale }),
  neighbourhood: (locale) => m.search_kind_district({}, { locale }),
  locality: (locale) => m.search_kind_locality({}, { locale }),
  isolated_dwelling: (locale) => m.search_kind_isolated_dwelling({}, { locale }),
  farm: (locale) => m.search_kind_farm({}, { locale }),
  municipality: (locale) => m.search_kind_municipality({}, { locale }),
  county: (locale) => m.search_kind_county({}, { locale }),
  state: (locale) => m.search_kind_state({}, { locale }),
  peak: (locale) => m.search_kind_peak({}, { locale }),
  saddle: (locale) => m.search_kind_saddle({}, { locale }),
  hill: (locale) => m.search_kind_hill({}, { locale }),
  ridge: (locale) => m.search_kind_ridge({}, { locale }),
  valley: (locale) => m.search_kind_valley({}, { locale }),
  rock: (locale) => m.search_kind_rock({}, { locale }),
  cliff: (locale) => m.search_kind_cliff({}, { locale }),
  cave_entrance: (locale) => m.search_kind_cave({}, { locale }),
  spring: (locale) => m.search_kind_spring({}, { locale }),
  waterfall: (locale) => m.search_kind_waterfall({}, { locale }),
  water: (locale) => m.search_kind_water({}, { locale }),
  lake: (locale) => m.search_kind_lake({}, { locale }),
  river: (locale) => m.search_kind_river({}, { locale }),
  stream: (locale) => m.search_kind_stream({}, { locale }),
  wood: (locale) => m.search_kind_forest({}, { locale }),
  forest: (locale) => m.search_kind_forest({}, { locale }),
  heath: (locale) => m.search_kind_heath({}, { locale }),
  nature_reserve: (locale) => m.search_kind_nature_reserve({}, { locale }),
  national_park: (locale) => m.search_kind_national_park({}, { locale }),
  protected_area: (locale) => m.search_kind_protected_area({}, { locale }),
  castle: (locale) => m.search_kind_castle({}, { locale }),
  ruins: (locale) => m.search_kind_ruins({}, { locale }),
  tower: (locale) => m.search_kind_tower({}, { locale }),
  viewpoint: (locale) => m.search_kind_viewpoint({}, { locale }),
  alpine_hut: (locale) => m.search_kind_hut({}, { locale }),
  wilderness_hut: (locale) => m.search_kind_hut({}, { locale }),
  shelter: (locale) => m.search_kind_shelter({}, { locale }),
  station: (locale) => m.search_kind_station({}, { locale }),
  halt: (locale) => m.search_kind_halt({}, { locale }),
  camp_site: (locale) => m.search_kind_camp_site({}, { locale }),
  hostel: (locale) => m.search_kind_hostel({}, { locale }),
  hotel: (locale) => m.search_kind_hotel({}, { locale }),
  restaurant: (locale) => m.search_kind_restaurant({}, { locale }),
  cafe: (locale) => m.search_kind_cafe({}, { locale }),
  parking: (locale) => m.search_kind_parking({}, { locale }),
  church: (locale) => m.search_kind_church({}, { locale }),
  chapel: (locale) => m.search_kind_chapel({}, { locale }),
  attraction: (locale) => m.search_kind_attraction({}, { locale }),
  museum: (locale) => m.search_kind_museum({}, { locale }),
};

interface PhotonProperties {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  osm_key?: string;
  osm_value?: string;
  extent?: unknown;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Photon's `extent` is [minLon, maxLat, maxLon, minLat]; returns [west, south, east, north]. */
function boundsOf(extent: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(extent) || extent.length !== 4) return undefined;
  const [minLon, maxLat, maxLon, minLat] = extent as number[];
  if (![minLon, maxLat, maxLon, minLat].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return undefined;
  }
  const [w, s, e, n] = [minLon!, minLat!, maxLon!, maxLat!];
  return w < e && s < n ? [w, s, e, n] : undefined;
}

/**
 * Search results of a Photon response. A hit without a name is shown as street and house number,
 * and left out if it has no street either.
 */
export function parsePhoton(json: unknown, locale?: Locale): SearchResult[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: SearchResult[] = [];
  for (const f of features) {
    const coords = (f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    if (!Array.isArray(coords) || typeof coords[0] !== "number" || typeof coords[1] !== "number") {
      continue;
    }
    const p = ((f as { properties?: PhotonProperties }).properties ?? {}) as PhotonProperties;
    const street = text(p.street);
    const label = text(p.name) || (street ? [street, text(p.housenumber)].join(" ").trim() : "");
    if (!label) continue;
    const place = text(p.city) || text(p.district);
    const area = [text(p.county), text(p.state)].filter((x) => x !== "");
    const parts = [place, ...area].filter(
      (x, i, a) => x !== "" && x !== label && a.indexOf(x) === i,
    );
    const kind =
      KIND_NAMES[text(p.osm_value)]?.(locale) ??
      (text(p.osm_key) === "highway" ? m.search_kind_street({}, { locale }) : "");
    const detail = [parts.join(", "), kind].filter((x) => x !== "").join(" · ");
    const bounds = boundsOf(p.extent);
    out.push({
      label,
      detail,
      center: [coords[0], coords[1]],
      ...(bounds ? { bounds } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// DOM

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** Moves the map to a result: the whole extent if it has one, else a point at zoom 14. */
export function jumpTo(map: MapLibreMap, result: SearchResult): void {
  if (getState().printView) {
    // The zoom is locked to the print zoom; the area stays where it is.
    map.setCenter(result.center);
  } else if (result.bounds) {
    const [w, s, e, n] = result.bounds;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 40, maxZoom: 15, duration: 800 },
    );
  } else {
    map.flyTo({ center: result.center, zoom: 14, duration: 800 });
  }
}

export function initSearch(map: MapLibreMap): void {
  const input = el<HTMLInputElement>("search-input");
  const list = el<HTMLUListElement>("search-results");
  const state = el<HTMLParagraphElement>("search-state");

  let results: SearchResult[] = [];
  let active = -1;
  let timer = 0;
  /** The text changed after the shown results were fetched. */
  let stale = false;
  let controller: AbortController | null = null;

  const say = (message: string, error = false) => {
    state.textContent = message;
    state.hidden = message === "";
    state.classList.toggle("hint--warn", error);
  };

  const setOpen = (open: boolean) => {
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  };

  const setActive = (index: number) => {
    active = index;
    for (const [i, node] of [...list.children].entries()) {
      node.setAttribute("aria-selected", String(i === index));
      node.classList.toggle("search__option--active", i === index);
    }
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", `search-option-${index}`);
      list.children[index]?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const clearResults = () => {
    results = [];
    list.replaceChildren();
    setActive(-1);
    setOpen(false);
  };

  const cancel = () => {
    window.clearTimeout(timer);
    controller?.abort();
    controller = null;
  };

  const choose = (index: number) => {
    const result = results[index];
    if (!result) return;
    jumpTo(map, result);
    collapseSheet();
    input.value = result.label;
    setOpen(false);
    say("");
  };

  const render = () => {
    list.replaceChildren(
      ...results.map((r, i) => {
        const li = document.createElement("li");
        li.id = `search-option-${i}`;
        li.className = "search__option";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        const name = document.createElement("span");
        name.className = "search__name";
        name.textContent = r.label;
        li.append(name);
        if (r.detail) {
          const detail = document.createElement("span");
          detail.className = "search__detail";
          detail.textContent = r.detail;
          li.append(detail);
        }
        // mousedown, not click: the input must not lose focus (and close the list) before.
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(i);
        });
        li.addEventListener("mousemove", () => {
          if (active !== i) setActive(i);
        });
        return li;
      }),
    );
    setActive(-1);
    setOpen(results.length > 0);
  };

  const search = async (query: string, jumpToFirst = false) => {
    cancel();
    const mine = new AbortController();
    controller = mine;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      mine.abort();
    }, TIMEOUT_MS);
    say(m.search_searching());
    try {
      const c = map.getCenter();
      const response = await fetch(photonUrl(query, c), {
        signal: mine.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      results = parsePhoton(await response.json());
      stale = false;
      render();
      say(results.length === 0 ? m.search_none() : "");
      if (jumpToFirst && results.length > 0) choose(0);
    } catch (err) {
      // Superseded by a newer search or cleared: stay silent.
      if (mine.signal.aborted && !timedOut) return;
      console.warn("Photon search:", err);
      results = [];
      render();
      say(m.search_unreachable(), true);
    } finally {
      window.clearTimeout(timeout);
      if (controller === mine) controller = null;
    }
  };

  input.addEventListener("input", () => {
    const query = input.value.trim();
    cancel();
    stale = true;
    if (query.length < MIN_QUERY_LENGTH) {
      clearResults();
      say("");
      return;
    }
    timer = window.setTimeout(() => void search(query), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    const open = !list.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      if (!open) setOpen(true);
      const n = results.length;
      setActive(e.key === "ArrowDown" ? (active + 1) % n : active <= 0 ? n - 1 : active - 1);
    } else if (e.key === "Enter") {
      const query = input.value.trim();
      if (results.length > 0 && !stale) {
        e.preventDefault();
        choose(active >= 0 ? active : 0);
      } else if (query.length >= MIN_QUERY_LENGTH) {
        // Pressed before the debounce fired: search now and jump to the first hit.
        e.preventDefault();
        cancel();
        void search(query, true);
      }
    } else if (e.key === "Escape") {
      if (open) {
        setOpen(false);
      } else {
        cancel();
        input.value = "";
        clearResults();
        say("");
      }
    }
  });

  input.addEventListener("focus", () => {
    if (results.length > 0) setOpen(true);
  });
  input.addEventListener("blur", () => setOpen(false));

  // "/" focuses the search unless a text field already has the focus.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.closest("input, textarea, select") || target.isContentEditable)) return;
    e.preventDefault();
    if (document.body.classList.contains("sidebar-collapsed")) el("sidebar-expand").click();
    input.focus();
    input.select();
  });
}
