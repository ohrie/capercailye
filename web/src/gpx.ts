// GPX upload (PLAN.md 1 and 8: G6). The pure parts (`normalizeTrack`, `areaForTrack`,
// `trackLengthKm`) work on GeoJSON and are unit-tested; `readGpxFile` is the DOM part.
//
// Tracks (`trk`) and routes (`rte`) become lines, waypoints are ignored. The normalised
// collection feeds the map source `gpx` (style/gpx.ts): the line features and one start and one
// end point, each tagged with `_kind`.
import { gpx as gpxToGeoJson } from "@tmcw/togeojson";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Area } from "./print/layout";

export type Position = [number, number];
/** [west, south, east, north] */
export type Bounds = [number, number, number, number];

export interface Track {
  /** Name from the file, else the file name. */
  name: string;
  /** Lines (`_kind: "line"`) plus the start and end point (`_kind: "start" | "end"`). */
  data: FeatureCollection;
  bounds: Bounds;
  lengthKm: number;
}

export type TrackResult = { track: Track } | { error: string };

export const ERROR_NO_TRACK = "Keine Spur in der Datei";
export const ERROR_UNREADABLE = "Datei ist kein lesbares GPX";

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Haversine distance in metres. */
function distanceM(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of lines (each a list of points, segments of a track add up) in km. */
export function trackLengthKm(lines: readonly (readonly Position[])[]): number {
  let m = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) m += distanceM(line[i - 1]!, line[i]!);
  }
  return m / 1000;
}

const isPosition = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Lines of a geometry as lists of [lng, lat] (elevation and time dropped, one-point lines gone). */
function linesOf(geometry: Geometry | null): Position[][] {
  const raw =
    geometry?.type === "LineString"
      ? [geometry.coordinates]
      : geometry?.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  return raw
    .map((line) => line.filter(isPosition).map((p): Position => [p[0]!, p[1]!]))
    .filter((line) => line.length >= 2);
}

/**
 * Normalises the GeoJSON of togeojson: lines only, start = first point of the first line, end =
 * last point of the last line. Without any line: `{ error }`.
 */
export function normalizeTrack(fc: FeatureCollection, fallbackName = "GPX-Track"): TrackResult {
  const features: Feature[] = [];
  const all: Position[][] = [];
  let name = "";
  for (const f of fc.features ?? []) {
    const lines = linesOf(f.geometry);
    if (lines.length === 0) continue;
    all.push(...lines);
    if (!name && typeof f.properties?.name === "string") name = f.properties.name.trim();
    features.push({
      type: "Feature",
      properties: { _kind: "line" },
      geometry:
        lines.length === 1
          ? { type: "LineString", coordinates: lines[0]! }
          : { type: "MultiLineString", coordinates: lines },
    });
  }
  if (all.length === 0) return { error: ERROR_NO_TRACK };

  const start = all[0]![0]!;
  const lastLine = all[all.length - 1]!;
  const end = lastLine[lastLine.length - 1]!;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of all) {
    for (const [lng, lat] of line) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  // Numeric ids keep start and end apart in the print placement even when they coincide (loops).
  const point = (id: number, kind: string, c: Position): Feature => ({
    type: "Feature",
    id,
    properties: { _kind: kind },
    geometry: { type: "Point", coordinates: c },
  });
  return {
    track: {
      name: name || fallbackName,
      data: {
        type: "FeatureCollection",
        features: [...features, point(1, "start", start), point(2, "end", end)],
      },
      bounds: [west, south, east, north],
      lengthKm: trackLengthKm(all),
    },
  };
}

/** Margin of the print area around the track: 10 % of its extent per side, at least 300 m. */
export const AREA_MARGIN_RATIO = 0.1;
export const AREA_MIN_MARGIN_M = 300;

/** Print area around a track: its hull plus 10 % on each side, at least 300 m. */
export function areaForTrack(bounds: Bounds): Area {
  const [w, s, e, n] = bounds;
  const midLat = (s + n) / 2;
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLon = mPerDegLat * Math.cos(rad(midLat));
  const marginLng = Math.max((e - w) * AREA_MARGIN_RATIO, AREA_MIN_MARGIN_M / mPerDegLon);
  const marginLat = Math.max((n - s) * AREA_MARGIN_RATIO, AREA_MIN_MARGIN_M / mPerDegLat);
  return { west: w - marginLng, south: s - marginLat, east: e + marginLng, north: n + marginLat };
}

/** Parses GPX text in the browser. */
export function parseGpx(text: string, fallbackName?: string): TrackResult {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName.toLowerCase() !== "gpx") {
    return { error: ERROR_UNREADABLE };
  }
  let fc: FeatureCollection;
  try {
    fc = gpxToGeoJson(doc) as FeatureCollection;
  } catch {
    return { error: ERROR_UNREADABLE };
  }
  return normalizeTrack(fc, fallbackName);
}

/** Reads a GPX file chosen or dropped by the user. */
export async function readGpxFile(file: File): Promise<TrackResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { error: ERROR_UNREADABLE };
  }
  return parseGpx(text, file.name.replace(/\.gpx$/i, "") || undefined);
}

/**
 * Drag and drop of a GPX file onto `target`. While a file is dragged over it the target gets the
 * class `map--drop` (a dashed frame, see app.css); the first dropped file goes to `onFile`.
 */
export function initGpxDrop(target: HTMLElement, onFile: (file: File) => void): void {
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    target.classList.add("map--drop");
  };
  target.addEventListener("dragenter", over);
  target.addEventListener("dragover", over);
  target.addEventListener("dragleave", (e) => {
    if (!target.contains(e.relatedTarget as Node | null)) target.classList.remove("map--drop");
  });
  target.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    target.classList.remove("map--drop");
    const file = e.dataTransfer?.files[0];
    if (file) onFile(file);
  });
}
