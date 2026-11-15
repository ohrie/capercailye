#!/usr/bin/env bun
/**
 * GTFS -> Bushaltestellen (GeoJSON Lines) fuer capercailye. Regeln: siehe transit/README.md.
 *
 * Aufruf:
 *   bun transit/busstops.ts --gtfs <entpacktes-GTFS-Verzeichnis> --out <datei.geojsonl>
 *       [--min 4] [--saturday YYYY-MM-DD] [--bbox minLon,minLat,maxLon,maxLat]
 *       [--cluster-m 150] [--merge-m 75] [--include-on-demand] [--include-rail-replacement] [--stats <datei.json>] [--all <datei.geojsonl>]
 *
 * --merge-m: ausgewaehlte Haltestellen im Umkreis dieser Metern (Leader-Verfahren) zu einem Symbol zusammenfassen
 * (Standard 75, 0 = aus); --all liefert alle Haltestellen unzusammengefasst.
 *
 * stop_times.txt (mehrere GB) wird gestreamt; im Speicher liegen nur trips (aktive Fahrten) und Zaehler je Mast.
 */
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- Argumente
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (!a.startsWith("--")) throw new Error(`unerwartetes Argument: ${a}`);
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) args.set(a.slice(2), "true");
  else (args.set(a.slice(2), next), i++);
}
const gtfsDir = args.get("gtfs");
const outPath = args.get("out");
if (!gtfsDir || !outPath) {
  console.error("Aufruf: bun busstops.ts --gtfs <dir> --out <datei.geojsonl> [--min 4] [--saturday YYYY-MM-DD] [--bbox a,b,c,d] [--cluster-m 150] [--merge-m 75] [--include-on-demand] [--include-rail-replacement] [--stats f.json] [--all f.geojsonl]");
  process.exit(2);
}
const THRESHOLD = Number(args.get("min") ?? 4);
const CLUSTER_M = Number(args.get("cluster-m") ?? 150);
const MERGE_M = Number(args.get("merge-m") ?? 75);
if (Number.isNaN(MERGE_M) || MERGE_M < 0) throw new Error("--merge-m: Meter >= 0 (0 = aus)");
const INCLUDE_ON_DEMAND = args.has("include-on-demand");
const INCLUDE_RAIL_REPLACEMENT = args.has("include-rail-replacement");
const bbox = args.get("bbox")?.split(",").map(Number) as [number, number, number, number] | undefined;
if (bbox && (bbox.length !== 4 || bbox.some(Number.isNaN))) throw new Error("--bbox: minLon,minLat,maxLon,maxLat");

const t0 = performance.now();
const log = (m: string) => console.error(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// ---------------------------------------------------------------- CSV
/** Zerlegt eine CSV-Zeile (RFC 4180, Anfuehrungszeichen). Schneller Pfad ohne Anfuehrungszeichen. */
function parseLine(line: string): string[] {
  if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
  if (line.indexOf('"') < 0) return line.split(",");
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line.charCodeAt(i) === 34) {
      let s = "";
      i++;
      for (;;) {
        const j = line.indexOf('"', i);
        if (j < 0) { s += line.slice(i); i = n; break; }
        s += line.slice(i, j);
        if (line.charCodeAt(j + 1) === 34) { s += '"'; i = j + 2; } else { i = j + 1; break; }
      }
      out.push(s);
      i++; // Komma
    } else {
      const j = line.indexOf(",", i);
      if (j < 0) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

/** Streamt eine Datei zeilenweise; erste Zeile = Kopf (BOM entfernt). */
async function* lines(path: string): AsyncGenerator<string> {
  const dec = new TextDecoder("utf-8");
  let rest = "";
  let first = true;
  for await (const chunk of Bun.file(path).stream()) {
    rest += dec.decode(chunk, { stream: true });
    let start = 0;
    for (;;) {
      const nl = rest.indexOf("\n", start);
      if (nl < 0) break;
      let l = rest.slice(start, nl);
      start = nl + 1;
      if (first) { l = l.replace(/^﻿/, ""); first = false; }
      if (l.length) yield l;
    }
    rest = rest.slice(start);
  }
  rest += dec.decode();
  if (rest.length) yield rest;
}

async function readTable(path: string, fn: (get: (col: string) => string) => void): Promise<void> {
  let idx: Map<string, number> | undefined;
  let row: string[] = [];
  const get = (c: string) => {
    const i = idx!.get(c);
    return i === undefined ? "" : (row[i] ?? "");
  };
  for await (const l of lines(path)) {
    if (!idx) {
      idx = new Map(parseLine(l).map((h, i) => [h.trim(), i]));
      continue;
    }
    row = parseLine(l);
    fn(get);
  }
}

// ---------------------------------------------------------------- Datumslogik
const ymd = (d: Date) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const parseYmd = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
/** Bundesweite gesetzliche Feiertage (YYYYMMDD). */
function nationalHolidays(y: number): Set<number> {
  const e = easter(y);
  const fixed = [new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y, 4, 1)), new Date(Date.UTC(y, 9, 3)), new Date(Date.UTC(y, 11, 25)), new Date(Date.UTC(y, 11, 26))];
  const moving = [-2, 0, 1, 39, 50, 51].map((n) => addDays(e, n)); // Karfreitag .. Pfingstmontag (50 = Pfingstsonntag)
  return new Set([...fixed, ...moving].map(ymd));
}

// ---------------------------------------------------------------- 1. Dienste (calendar + calendar_dates)
type Cal = { start: number; end: number; dow: boolean[] };
const calendar = new Map<string, Cal>();
const exceptions = new Map<string, Map<number, number>>(); // service_id -> (date -> 1|2)
let feedMin = 99999999, feedMax = 0;
const calPath = join(gtfsDir, "calendar.txt");
const calDatesPath = join(gtfsDir, "calendar_dates.txt");
const exists = (p: string) => Bun.file(p).size > 0;
if (exists(calPath)) {
  await readTable(calPath, (g) => {
    const start = +g("start_date"), end = +g("end_date");
    calendar.set(g("service_id"), { start, end, dow: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((d) => g(d) === "1") });
    feedMin = Math.min(feedMin, start);
    feedMax = Math.max(feedMax, end);
  });
}
if (exists(calDatesPath)) {
  await readTable(calDatesPath, (g) => {
    const d = +g("date");
    let m = exceptions.get(g("service_id"));
    if (!m) exceptions.set(g("service_id"), (m = new Map()));
    m.set(d, +g("exception_type"));
    if (!exists(calPath)) { feedMin = Math.min(feedMin, d); feedMax = Math.max(feedMax, d); }
  });
}
log(`Gueltigkeit des Feeds: ${feedMin}..${feedMax}; calendar ${calendar.size}, calendar_dates fuer ${exceptions.size} Dienste`);

// Woche waehlen
let satDate: Date;
const satArg = args.get("saturday");
if (satArg) {
  satDate = parseYmd(satArg.replaceAll("-", ""));
  if (satDate.getUTCDay() !== 6) throw new Error("--saturday ist kein Samstag");
} else {
  const lo = parseYmd(String(feedMin)), hi = parseYmd(String(feedMax));
  const mid = new Date((lo.getTime() + hi.getTime()) / 2);
  // Samstage nahe der Mitte, Woche (Mo..So) komplett im Zeitraum und ohne bundesweiten Feiertag
  const firstSat = addDays(mid, (6 - mid.getUTCDay() + 7) % 7 - 7 * 8);
  let best: Date | undefined;
  for (let k = 0; k < 17; k++) {
    const sat = addDays(firstSat, 7 * k);
    const mon = addDays(sat, -5), sun = addDays(sat, 1);
    if (mon < lo || sun > hi) continue;
    const hol = nationalHolidays(sat.getUTCFullYear());
    let bad = false;
    for (let d = 0; d < 7; d++) if (hol.has(ymd(addDays(mon, d)))) bad = true;
    if (bad) continue;
    if (!best || Math.abs(sat.getTime() - mid.getTime()) < Math.abs(best.getTime() - mid.getTime())) best = sat;
  }
  if (!best) throw new Error("keine normale Woche im Gueltigkeitszeitraum gefunden; --saturday angeben");
  satDate = best;
}
const sunDate = addDays(satDate, 1);
const SAT = ymd(satDate), SUN = ymd(sunDate);
log(`gezaehlt: Samstag ${SAT}, Sonntag ${SUN}`);

function activeOn(serviceId: string, date: number, dow: number): boolean {
  const ex = exceptions.get(serviceId)?.get(date);
  if (ex === 1) return true;
  if (ex === 2) return false;
  const c = calendar.get(serviceId);
  return !!c && date >= c.start && date <= c.end && c.dow[dow]!;
}
const serviceFlag = new Map<string, number>(); // 1 = Samstag, 2 = Sonntag
for (const id of new Set([...calendar.keys(), ...exceptions.keys()])) {
  const f = (activeOn(id, SAT, 6) ? 1 : 0) | (activeOn(id, SUN, 0) ? 2 : 0);
  if (f) serviceFlag.set(id, f);
}
log(`Dienste, die am Samstag/Sonntag fahren: ${serviceFlag.size}`);

// ---------------------------------------------------------------- 2. Bus-Linien
// Bus: route_type 3 und 700-799. Bedarfsverkehr (Rufbus, AST, ALT, ...) wird ausgeschlossen:
//  - route_type 715 (Demand and Response Bus Service)
//  - route_type 3 mit Linienname nach Muster (der Feed kennzeichnet Bedarfsverkehr nur im Namen)
const ON_DEMAND = /(?<![a-zäöüß])(ast|alt|alf|alfa|alita|ruf[a-zäöüß]*|anruf[a-zäöüß]*|[a-zäöüß]*taxi[a-zäöüß]*|bedarf[a-zäöüß]*|on-?demand|flex[a-zäöüß]*)(?![a-zäöüß])/i;
// Schienenersatzverkehr (Busse unter route_type 3 mit Bahn-Liniennamen) wird ebenfalls ausgeschlossen:
// er ist vorübergehend und würde Bahnhöfe als Bushaltestellen erscheinen lassen. Erkennung am Namen:
//  - SEV..., RB/RE/IRE/MEX/REX/RS/IC/ICE/EC + Ziffer, Namensteil "EV" (z. B. 3EV, S5EV), "Schienenersatz"
//  - S<Ziffer>/U<Ziffer>, wenn dieser Liniennamen im Feed auch als Bahn-/S-/U-Bahn-Linie (route_type 0-2) vorkommt
const RAIL_REPLACEMENT = /^(SEV|(RB|RE|IRE|MEX|REX|RS|IC|ICE|EC)\s*\d)|^\s*\d*\s*EV\b|\d\s*EV\b|schienenersatz/i;
const busRoutes = new Set<string>();
const routeTypeCount = new Map<string, number>();
let excludedOnDemand = 0, excludedRail = 0;
type Route = { id: string; type: number; short: string; long: string };
const routes: Route[] = [];
await readTable(join(gtfsDir, "routes.txt"), (g) => {
  routes.push({ id: g("route_id"), type: +g("route_type"), short: g("route_short_name").trim(), long: g("route_long_name") });
  routeTypeCount.set(g("route_type"), (routeTypeCount.get(g("route_type")) ?? 0) + 1);
});
const railNames = new Set(routes.filter((r) => r.type <= 2).map((r) => r.short));
for (const r of routes) {
  if (!(r.type === 3 || (r.type >= 700 && r.type <= 799))) continue;
  if (!INCLUDE_ON_DEMAND && (r.type === 715 || ON_DEMAND.test(`${r.short} ${r.long}`))) { excludedOnDemand++; continue; }
  if (!INCLUDE_RAIL_REPLACEMENT && r.type === 3 && (RAIL_REPLACEMENT.test(`${r.short} ${r.long}`) || (/^[SU]\s*\d/i.test(r.short) && railNames.has(r.short)))) { excludedRail++; continue; }
  busRoutes.add(r.id);
}
log(`route_type im Feed: ${[...routeTypeCount].sort().map(([k, v]) => `${k}:${v}`).join(" ")}; Bus-Linien ${busRoutes.size}, ausgeschlossen: Bedarfsverkehr ${excludedOnDemand}, Schienenersatzverkehr ${excludedRail}`);

// ---------------------------------------------------------------- 3. Fahrten
const tripFlag = new Map<string, number>(); // trip_id -> 1|2|3
await readTable(join(gtfsDir, "trips.txt"), (g) => {
  if (!busRoutes.has(g("route_id"))) return;
  const f = serviceFlag.get(g("service_id"));
  if (f) tripFlag.set(g("trip_id"), f);
});
log(`Bus-Fahrten am Wochenende (Sa oder So): ${tripFlag.size}`);

// ---------------------------------------------------------------- 4. Haltestellen (Masten)
type Stop = { id: string; name: string; lat: number; lon: number; parent: string; type: string };
const stops: Stop[] = [];
const stopIdx = new Map<string, number>();
const stopById = new Map<string, Stop>();
await readTable(join(gtfsDir, "stops.txt"), (g) => {
  const s: Stop = { id: g("stop_id"), name: g("stop_name"), lat: +g("stop_lat"), lon: +g("stop_lon"), parent: g("parent_station"), type: g("location_type") };
  stopById.set(s.id, s);
  if (s.type === "" || s.type === "0") { stopIdx.set(s.id, stops.length); stops.push(s); }
});
log(`Masten (location_type 0): ${stops.length}`);

// ---------------------------------------------------------------- 5. stop_times streamen
const sat = new Int32Array(stops.length);
const sun = new Int32Array(stops.length);
const pickupTypeCount = [0, 0, 0, 0];
let rows = 0, activeRows = 0, counted = 0, reentered = 0, unknownStops = 0, badRows = 0;
const done = new Set<string>();
let curTrip = "", curFlag = 0;
let buf: { s: number; seq: number; p: number }[] = [];

function flush() {
  if (buf.length > 1) {
    let last = 0;
    for (let i = 1; i < buf.length; i++) if (buf[i]!.seq > buf[last]!.seq) last = i;
    for (let i = 0; i < buf.length; i++) {
      if (i === last) continue; // letzte Haltestelle: nur Ausstieg
      const b = buf[i]!;
      if (b.p === 1) continue;
      if (curFlag & 1) sat[b.s]!++;
      if (curFlag & 2) sun[b.s]!++;
      counted++;
    }
  }
  if (curFlag) done.add(curTrip);
  buf = [];
}

{
  let idx: Map<string, number> | undefined;
  let iTrip = 0, iStop = 0, iSeq = 0, iPick = 0, nCols = 0;
  for await (const l of lines(join(gtfsDir, "stop_times.txt"))) {
    if (!idx) {
      const h = parseLine(l);
      idx = new Map(h.map((x, i) => [x.trim(), i]));
      iTrip = idx.get("trip_id")!; iStop = idx.get("stop_id")!; iSeq = idx.get("stop_sequence")!; iPick = idx.get("pickup_type") ?? -1;
      nCols = h.length;
      continue;
    }
    rows++;
    // trip_id steht in der Regel vorn und ist nie in Anfuehrungszeichen: schneller Pfad
    const row = parseLine(l);
    if (row.length !== nCols) { badRows++; continue; }
    const trip = row[iTrip]!;
    if (trip !== curTrip) {
      flush();
      curTrip = trip;
      curFlag = tripFlag.get(trip) ?? 0;
      if (curFlag && done.has(trip)) reentered++;
    }
    if (!curFlag) continue;
    activeRows++;
    const s = stopIdx.get(row[iStop]!);
    if (s === undefined) { unknownStops++; continue; }
    const p = iPick >= 0 && row[iPick] !== "" ? +row[iPick]! : 0;
    pickupTypeCount[p]!++;
    buf.push({ s, seq: +row[iSeq]!, p });
  }
  flush();
}
log(`stop_times: ${rows} Zeilen, ${activeRows} davon in Bus-Fahrten am Wochenende, ${counted} Abfahrten gezaehlt; pickup_type 0/1/2/3: ${pickupTypeCount.join("/")}; Fahrten nicht zusammenhaengend: ${reentered}; unbekannte Masten: ${unknownStops}; defekte Zeilen: ${badRows}`);

// ---------------------------------------------------------------- 6. Masten zu Haltestellen zusammenfassen
// a) parent_station (location_type 1) -> eine Einheit; Masten ohne Elternstation -> eigene Einheit.
// b) Einheiten mit gleichem stop_name (getrimmt, Kleinschreibung) und Abstand <= CLUSTER_M werden vereinigt
//    (Union-Find, Einfachverknuepfung). Begruendung: gegenueberliegende Masten haengen im Feed oft an
//    verschiedenen Elternstationen oder an gar keiner; 150 m deckt Kreuzungen/Strassenseiten ab, ohne
//    gleichnamige Haltestellen verschiedener Orte zu verschmelzen (Namen enthalten meist den Ort).
type Unit = { key: string; name: string; sat: number; sun: number; sumLat: number; sumLon: number; n: number; masts: number };
const units = new Map<string, Unit>();
for (let i = 0; i < stops.length; i++) {
  if (sat[i]! + sun[i]! === 0) continue;
  const s = stops[i]!;
  const parent = s.parent ? stopById.get(s.parent) : undefined;
  const key = parent ? `p${parent.id}` : `s${s.id}`;
  let u = units.get(key);
  if (!u) units.set(key, (u = { key, name: (parent?.name || s.name).trim(), sat: 0, sun: 0, sumLat: 0, sumLon: 0, n: 0, masts: 0 }));
  u.sat += sat[i]!; u.sun += sun[i]!;
  u.sumLat += s.lat; u.sumLon += s.lon; u.n++; u.masts++;
}
const unitList = [...units.values()];
const parentUF = unitList.map((_, i) => i);
const find = (i: number): number => { while (parentUF[i] !== i) { parentUF[i] = parentUF[parentUF[i]!]!; i = parentUF[i]!; } return i; };
const byName = new Map<string, number[]>();
unitList.forEach((u, i) => {
  const k = u.name.toLowerCase().replace(/\s+/g, " ");
  let a = byName.get(k);
  if (!a) byName.set(k, (a = []));
  a.push(i);
});
const M_PER_DEG = 111320;
const dist = (a: Unit, b: Unit) => {
  const la = a.sumLat / a.n, lb = b.sumLat / b.n;
  const dy = (la - lb) * M_PER_DEG;
  const dx = (a.sumLon / a.n - b.sumLon / b.n) * M_PER_DEG * Math.cos(((la + lb) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
};
let merges = 0;
for (const idxs of byName.values()) {
  if (idxs.length < 2) continue;
  const grid = new Map<string, number[]>();
  const cell = CLUSTER_M / M_PER_DEG; // Zellgroesse in Grad (Breite); Laenge grosszuegig (cos >= 0.5 in Deutschland)
  for (const i of idxs) {
    const u = unitList[i]!;
    const cx = Math.floor(u.sumLon / u.n / (cell * 1.7)), cy = Math.floor(u.sumLat / u.n / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (dist(u, unitList[j]!) <= CLUSTER_M) {
          const a = find(i), b = find(j);
          if (a !== b) { parentUF[a] = b; merges++; }
        }
      }
    }
    const k = `${cx},${cy}`;
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
}
type Stat = { name: string; sat: number; sun: number; sumLat: number; sumLon: number; n: number; masts: number; minLat: number; maxLat: number; minLon: number; maxLon: number };
const clusters = new Map<number, Stat>();
unitList.forEach((u, i) => {
  const r = find(i);
  let c = clusters.get(r);
  if (!c) clusters.set(r, (c = { name: u.name, sat: 0, sun: 0, sumLat: 0, sumLon: 0, n: 0, masts: 0, minLat: 99, maxLat: -99, minLon: 999, maxLon: -999 }));
  c.sat += u.sat; c.sun += u.sun; c.sumLat += u.sumLat; c.sumLon += u.sumLon; c.n += u.n; c.masts += u.masts;
  const la = u.sumLat / u.n, lo = u.sumLon / u.n;
  c.minLat = Math.min(c.minLat, la); c.maxLat = Math.max(c.maxLat, la); c.minLon = Math.min(c.minLon, lo); c.maxLon = Math.max(c.maxLon, lo);
});
log(`Haltestellen mit Bus-Abfahrten: ${clusters.size} (Einheiten ${unitList.length}, ${merges} Namens-Zusammenfassungen)`);

// ---------------------------------------------------------------- 7. Auswahl
type Sel = { name: string; sat: number; sun: number; min: number; lat: number; lon: number };
const selection: Sel[] = [];
const allOut = args.get("all") ? createWriteStream(args.get("all")!) : undefined; // Diagnose: alle Haltestellen mit Abfahrten
let maxSpreadM = 0, maxSpreadName = "";
for (const c of clusters.values()) {
  const lat = c.sumLat / c.n, lon = c.sumLon / c.n;
  const spread = Math.hypot((c.maxLat - c.minLat) * M_PER_DEG, (c.maxLon - c.minLon) * M_PER_DEG * Math.cos(lat * Math.PI / 180));
  if (spread > maxSpreadM) { maxSpreadM = spread; maxSpreadName = c.name; }
  const min = Math.min(c.sat, c.sun);
  allOut?.write(JSON.stringify({ type: "Feature", properties: { name: c.name, sat: c.sat, sun: c.sun, min, masts: c.masts }, geometry: { type: "Point", coordinates: [+lon.toFixed(6), +lat.toFixed(6)] } }) + "\n");
  if (min < THRESHOLD) continue;
  selection.push({ name: c.name, sat: c.sat, sun: c.sun, min, lat, lon });
}
if (allOut) await new Promise<void>((r) => allOut.end(r));
log(`ausgewaehlt (min(Sa,So) >= ${THRESHOLD}): ${selection.length}; groesste Ausdehnung einer Haltestelle: ${Math.round(maxSpreadM)} m (${maxSpreadName})`);

// ---------------------------------------------------------------- 8. Zusammenfassen benachbarter Haltestellen
// Wie die Picknickplaetze im Tile-Profil (Leader-Verfahren): nur die AUSGEWAEHLTEN Haltestellen (die Schwelle
// gilt je Haltestelle, vor dem Zusammenfassen; Addieren wuerde Fahrten benachbarter Haltestellen doppelt zaehlen
// und schwache Haltestellen ueber die Schwelle heben). Sortiert nach min absteigend, dann sat + sun absteigend,
// dann Name (Code-Einheiten-Vergleich), lon, lat; die beste noch freie wird Repraesentant und nimmt alle freien
// im Umkreis `radiusM` von SICH SELBST (keine Ketten). Position, Name und Abfahrten sind die des Repraesentanten.
// Gerechnet wird ueber alle ausgewaehlten, --bbox filtert erst danach.
const cmp = <T>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

/** Leader-Zusammenfassung (rein, deterministisch): Repraesentanten in Reihenfolge der Rangfolge + groesste Gruppe. */
function mergeNearby(list: readonly Sel[], radiusM: number): { kept: Sel[]; largest: { count: number; name: string } } {
  const sorted = [...list].sort((a, b) => b.min - a.min || b.sat + b.sun - (a.sat + a.sun) || cmp(a.name, b.name) || cmp(a.lon, b.lon) || cmp(a.lat, b.lat));
  if (radiusM <= 0) return { kept: sorted, largest: { count: 1, name: sorted[0]?.name ?? "" } };
  const cell = radiusM / M_PER_DEG; // Zellgroesse in Grad (Breite); Laenge grosszuegig (cos >= 0.56 in Deutschland)
  const cellLon = cell * 1.8;
  const key = (s: Sel) => `${Math.floor(s.lon / cellLon)},${Math.floor(s.lat / cell)}`;
  const grid = new Map<string, number[]>();
  sorted.forEach((s, i) => {
    const k = key(s);
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  });
  const geoDist = (a: Sel, b: Sel) => {
    const dy = (a.lat - b.lat) * M_PER_DEG;
    const dx = (a.lon - b.lon) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    return Math.hypot(dx, dy);
  };
  const taken = new Array<boolean>(sorted.length).fill(false);
  const kept: Sel[] = [];
  let largest = { count: 0, name: "" };
  for (let i = 0; i < sorted.length; i++) {
    if (taken[i]) continue;
    taken[i] = true;
    const lead = sorted[i]!;
    let count = 1;
    const cx = Math.floor(lead.lon / cellLon), cy = Math.floor(lead.lat / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (!taken[j] && geoDist(lead, sorted[j]!) <= radiusM) { taken[j] = true; count++; }
      }
    }
    if (count > largest.count) largest = { count, name: lead.name };
    kept.push(lead);
  }
  return { kept, largest };
}

const merged = mergeNearby(selection, MERGE_M);
log(MERGE_M > 0 ? `zusammengefasst (<= ${MERGE_M} m): ${selection.length} -> ${merged.kept.length}; groesste Gruppe: ${merged.largest.count} (${merged.largest.name})` : "Zusammenfassen aus (--merge-m 0)");

// ---------------------------------------------------------------- 9. Ausgabe
const out = createWriteStream(outPath);
let inBbox = 0;
for (const s of merged.kept) {
  if (bbox && (s.lon < bbox[0] || s.lat < bbox[1] || s.lon > bbox[2] || s.lat > bbox[3])) continue;
  inBbox++;
  out.write(JSON.stringify({ type: "Feature", properties: { name: s.name, sat: s.sat, sun: s.sun, min: s.min }, geometry: { type: "Point", coordinates: [+s.lon.toFixed(6), +s.lat.toFixed(6)] } }) + "\n");
}
await new Promise<void>((r) => out.end(r));
if (bbox) log(`davon in bbox: ${inBbox}`);

const stats = { saturday: SAT, sunday: SUN, feedValidity: [feedMin, feedMax], threshold: THRESHOLD, clusterM: CLUSTER_M, mergeM: MERGE_M, routeTypes: Object.fromEntries(routeTypeCount), busRoutes: busRoutes.size, onDemandRoutesExcluded: excludedOnDemand, railReplacementRoutesExcluded: excludedRail, busTripsWeekend: tripFlag.size, departuresCounted: counted, pickupTypeCount, stopsWithDepartures: clusters.size, selected: merged.kept.length, selectedBeforeMerge: selection.length, selectedAfterMerge: merged.kept.length, largestMergedGroup: merged.largest, inBbox: bbox ? inBbox : null, maxSpreadM: Math.round(maxSpreadM), seconds: Math.round((performance.now() - t0) / 1000) };
if (args.get("stats")) writeFileSync(args.get("stats")!, JSON.stringify(stats, null, 2) + "\n");
