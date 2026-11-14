#!/usr/bin/env bun
/**
 * Prueft eine neu gebaute PMTiles-Datei, bevor update.sh sie nach live/ tauscht.
 *
 * Aufruf: bun check.ts <neu.pmtiles> [<live.pmtiles>]
 * Pruefungen:
 *   - Header und Metadaten lesbar, maxZoom == 14 (OSM-Kacheln und Bushaltestellen)
 *   - mit <live>: Groesse >= 70 % der alten Datei
 *   - OSM-Kacheln (Name ohne "busstops"): Metadatum planetiler:osm:osmosisreplicationtime vorhanden
 *     und nicht aelter als das der alten Datei
 * Ausstieg 0 = in Ordnung, 1 = Pruefung fehlgeschlagen (Meldung auf stderr).
 */
import { existsSync, statSync } from "node:fs";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";

const OSM_STAND_KEY = "planetiler:osm:osmosisreplicationtime";
const MIN_SIZE_RATIO = 0.7;
const MAX_ZOOM = 14;

/** Liest Byte-Bereiche aus einer lokalen Datei (PMTiles-Source ohne HTTP). */
class FileSource implements Source {
  constructor(private path: string) {}
  getKey = () => this.path;
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const data = await Bun.file(this.path).slice(offset, offset + length).arrayBuffer();
    return { data };
  }
}

async function open(path: string) {
  const archive = new PMTiles(new FileSource(path));
  const header = await archive.getHeader();
  const meta = (await archive.getMetadata()) as Record<string, unknown> | null;
  return { header, meta: meta ?? {} };
}

function stand(meta: Record<string, unknown>): number | undefined {
  const v = meta[OSM_STAND_KEY];
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? undefined : t;
}

function fail(msg: string): never {
  console.error(`check: FEHLER: ${msg}`);
  process.exit(1);
}

const [newPath, livePath] = process.argv.slice(2);
if (!newPath) {
  console.error("Aufruf: bun check.ts <neu.pmtiles> [<live.pmtiles>]");
  process.exit(2);
}
if (!existsSync(newPath)) fail(`${newPath} fehlt`);

const isOsm = !newPath.includes("busstops");
let fresh;
try {
  fresh = await open(newPath);
} catch (e) {
  fail(`${newPath} nicht lesbar: ${e instanceof Error ? e.message : e}`);
}
if (fresh.header.maxZoom !== MAX_ZOOM) fail(`maxZoom ist ${fresh.header.maxZoom}, erwartet ${MAX_ZOOM}`);
const newStand = stand(fresh.meta);
if (isOsm && newStand === undefined) fail(`Metadatum ${OSM_STAND_KEY} fehlt oder ist kein Datum`);

const hasLive = livePath !== undefined && existsSync(livePath);
if (hasLive) {
  const newSize = statSync(newPath).size;
  const liveSize = statSync(livePath).size;
  if (newSize < liveSize * MIN_SIZE_RATIO) {
    fail(`neue Datei ${newSize} Byte ist kleiner als ${MIN_SIZE_RATIO * 100} % der alten (${liveSize} Byte)`);
  }
  if (isOsm) {
    let old;
    try {
      old = await open(livePath);
    } catch (e) {
      console.error(`check: Hinweis: alte Datei nicht lesbar (${e instanceof Error ? e.message : e}), Vergleich entfaellt`);
    }
    const oldStand = old ? stand(old.meta) : undefined;
    if (oldStand !== undefined && newStand! < oldStand) {
      fail(`OSM-Stand ${new Date(newStand!).toISOString()} ist aelter als der der alten Datei ${new Date(oldStand).toISOString()}`);
    }
  }
}

const standText = isOsm && newStand !== undefined ? `, OSM-Stand ${new Date(newStand).toISOString()}` : "";
console.error(`check: OK ${newPath} (maxZoom ${fresh.header.maxZoom}, ${statSync(newPath).size} Byte${standText}${hasLive ? ", gegen live geprueft" : ""})`);
