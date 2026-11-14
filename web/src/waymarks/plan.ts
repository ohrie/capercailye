// Placement of waymark signs along edges (PLAN.md 3 / 4a). Pure and deterministic.
//
// Input are edges between real forks (graph.ts) in global paper millimetres (y down); every part of
// an edge carries the distinct signs of the routes running there. Signs stand upright
// (axis-parallel w × h boxes) at points of the line. There are no blocks at forks: the signs stand
// on the open stretch, at least `forkGapMm` away from a fork.
//
// A sign k runs on an edge in one or more intervals (the stretches where k is shown). The intervals
// of k join to chains over forks where k just passes through (k appears on exactly two intervals
// there), over ring starts and over nothing else; a chain ends where k ends or branches.
//
// Phase A works in one dimension:
//   * A1 mandatory signs, per edge: every sign gets one place on its longest interval if that is at
//     least `minEdgeMm` long; the signs of equal intervals take turns, spread evenly over the
//     allowed zone (not as a block). Shorter intervals show it on the neighbouring edges.
//   * A2 repeats, per sign and chain: starting from the mandatory signs (and virtual anchors half
//     a spacing before the first and after the last allowed point), signs are inserted so that no
//     two are further apart than `spacingMm` along the route, across forks. Repeats move to the
//     nearest allowed point and drop out if that would bring equal signs closer than `minSameMm`.
// Phase B works in two dimensions over all edges: signs are placed one after another (mandatory
// signs before repeats, then higher networks first) and shift along their line, inside the allowed
// zone, until their box is free. Signs never overlap; a repeat without a free place is dropped, a
// mandatory sign only after the whole zone was searched.
import { BoxIndex, type Obstacle } from "../placement/displace";
import type { SignSpec } from "./signs";

export interface PlanPart {
  /** Vertex index where the part ends (as in graph.ts `EdgePart`). */
  end: number;
  signs: SignSpec[];
}

export interface PlanEdge {
  id: string;
  coords: [number, number][];
  parts: PlanPart[];
  ring: boolean;
  /** Node ids of real forks, else null. */
  start: string | null;
  end: string | null;
}

export interface PlacedSign {
  edgeId: string;
  key: string;
  imageId: string;
  /** Centre (mm). */
  x: number;
  y: number;
  /** Absolute box, without clearance. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** Arc length on the whole edge (mm). */
  t: number;
  /** Mandatory sign (else repeat). */
  mandatory: boolean;
}

export interface PlanStats {
  signs: PlacedSign[];
  /** Places phase A asked for (mandatory) and how many were placed. */
  mandatory: { wanted: number; placed: number };
  /** Same for repeats. */
  repeats: { wanted: number; placed: number };
  /** Places that already dropped out in phase A (too short, fork gap, minimum distance). */
  short: number;
}

export interface PlanOptions {
  /** Largest distance of two equal signs along the route. */
  spacingMm: number;
  /** Smallest distance of two equal signs along the route (repeats). */
  minSameMm: number;
  /** A centre must be at least this far (arc length) from a real fork. */
  forkGapMm: number;
  /** A centre must be at least this far from every other end of an interval. */
  endGapMm: number;
  /** An interval gets a mandatory sign from this length on. */
  minEdgeMm: number;
  /** Gap between boxes of different signs, only for the room test of mandatory signs. */
  signGapMm: number;
  /** Minimum distance of two boxes (of any edges). */
  clearanceMm: number;
  /** Largest shift along the line when giving way. */
  maxShiftMm: number;
  shiftStepMm: number;
}

/** A sign of every route at least every 6 cm on paper. */
export const WAYMARK_SPACING_MM = 60;

export const PLAN_DEFAULTS: PlanOptions = {
  spacingMm: WAYMARK_SPACING_MM,
  minSameMm: 25,
  forkGapMm: 8,
  endGapMm: 2,
  minEdgeMm: 25,
  signGapMm: 0.8,
  clearanceMm: 0.4,
  maxShiftMm: 10,
  shiftStepMm: 0.5,
};

const EPS = 1e-9;

/** An edge prepared for planning: positive-length segments with cumulative arc length. */
class Line {
  readonly cum: number[] = [0];
  /** Arc length at every vertex of the input (zero-length segments count 0). */
  readonly vertexT: number[] = [0];
  readonly segs: { x0: number; y0: number; x1: number; y1: number; len: number }[] = [];
  readonly length: number;

  constructor(coords: readonly [number, number][]) {
    for (let i = 0; i + 1 < coords.length; i++) {
      const [x0, y0] = coords[i]!;
      const [x1, y1] = coords[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len > 0) {
        this.segs.push({ x0, y0, x1, y1, len });
        this.cum.push(this.cum[this.cum.length - 1]! + len);
      }
      this.vertexT.push(this.vertexT[i]! + len);
    }
    this.length = this.cum[this.cum.length - 1]!;
  }

  private seg(t: number): number {
    let lo = 0;
    let hi = this.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  point(t: number): { x: number; y: number } {
    const i = this.seg(Math.min(Math.max(t, 0), this.length));
    const s = this.segs[i]!;
    const f = (Math.min(Math.max(t, 0), this.length) - this.cum[i]!) / s.len;
    return { x: s.x0 + (s.x1 - s.x0) * f, y: s.y0 + (s.y1 - s.y0) * f };
  }

  /** Absolute components of the unit tangent. */
  tangent(t: number): { ux: number; uy: number } {
    const s = this.segs[this.seg(Math.min(Math.max(t, 0), this.length))]!;
    return { ux: Math.abs(s.x1 - s.x0) / s.len, uy: Math.abs(s.y1 - s.y0) / s.len };
  }

  /** Half extent of a sign along the line at t. */
  half(sign: SignSpec, t: number): number {
    const { ux, uy } = this.tangent(t);
    return (sign.widthMm / 2) * ux + (sign.heightMm / 2) * uy;
  }
}

type EndKind = "fork" | "ring" | "open";

/** The stretch of an edge on which a sign k is shown. */
interface Interval {
  id: number;
  edge: number;
  key: string;
  sign: SignSpec;
  a: number;
  b: number;
  aEnd: EndKind;
  bEnd: EndKind;
  /** Allowed zone (arc length on the edge); empty if zlo > zhi. */
  zlo: number;
  zhi: number;
}

/** A place a sign wants (phase A) and where phase B starts looking. */
interface Candidate {
  iv: Interval;
  t0: number;
  mandatory: boolean;
}

const cmpSign = (a: SignSpec, b: SignSpec): number =>
  a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Intervals of all signs of one edge. */
function intervalsOf(index: number, e: PlanEdge, line: Line, o: PlanOptions): Interval[] {
  const np = e.parts.length;
  const tEnd = e.parts.map((p) => line.vertexT[p.end]!);
  const tStart = tEnd.map((_, i) => (i === 0 ? 0 : tEnd[i - 1]!));
  const out: Interval[] = [];
  const open = new Map<string, { sign: SignSpec; first: number }>();
  const close = (key: string, first: number, last: number, sign: SignSpec) => {
    const a = tStart[first]!;
    const b = tEnd[last]!;
    // At the start of a ring the sign runs on only if it is also on the part at the other end.
    const continues = (part: PlanPart) => part.signs.some((s) => s.key === key);
    const kind = (atEdge: boolean, fork: string | null, other: PlanPart): EndKind =>
      !atEdge ? "open" : fork !== null ? "fork" : e.ring && continues(other) ? "ring" : "open";
    const aEnd = kind(first === 0, e.start, e.parts[np - 1]!);
    const bEnd = kind(last === np - 1, e.end, e.parts[0]!);
    const gap = (k: EndKind) => (k === "fork" ? o.forkGapMm : k === "ring" ? 0 : o.endGapMm);
    out.push({
      id: -1,
      edge: index,
      key,
      sign,
      a,
      b,
      aEnd,
      bEnd,
      zlo: a + gap(aEnd),
      zhi: b - gap(bEnd),
    });
  };
  e.parts.forEach((part, i) => {
    const keys = new Set(part.signs.map((s) => s.key));
    for (const [k, r] of [...open]) {
      if (keys.has(k)) continue;
      close(k, r.first, i - 1, r.sign);
      open.delete(k);
    }
    for (const s of part.signs) if (!open.has(s.key)) open.set(s.key, { sign: s, first: i });
  });
  for (const [k, r] of open) close(k, r.first, np - 1, r.sign);
  out.sort((x, y) => cmpStr(x.key, y.key) || x.a - y.a);
  return out;
}

/** One chain of intervals of a sign, with its own coordinate s. */
interface Chain {
  items: { iv: Interval; rev: boolean; off: number }[];
  length: number;
  cyclic: boolean;
}

interface IvEnd {
  iv: Interval;
  side: 0 | 1;
}

/** Chains of the intervals of one sign. */
function chainsOf(ivs: readonly Interval[], edges: readonly PlanEdge[]): Chain[] {
  const nodeOf = (iv: Interval, side: 0 | 1): string => {
    const kind = side === 0 ? iv.aEnd : iv.bEnd;
    const e = edges[iv.edge]!;
    if (kind === "fork") return `f:${side === 0 ? e.start : e.end}`;
    if (kind === "ring") return `r:${e.id}`;
    return `o:${iv.id}:${side}`;
  };
  const ends = new Map<string, IvEnd[]>();
  for (const iv of ivs) {
    for (const side of [0, 1] as const) {
      const k = nodeOf(iv, side);
      const list = ends.get(k);
      if (list) list.push({ iv, side });
      else ends.set(k, [{ iv, side }]);
    }
  }
  const used = new Set<number>();
  const chains: Chain[] = [];

  /** Walks from an interval entered at `side` until a node of degree ≠ 2 (or back to the start). */
  const walk = (start: IvEnd): Chain => {
    const items: Chain["items"] = [];
    let cur = start;
    let cyclic = false;
    for (;;) {
      items.push({ iv: cur.iv, rev: cur.side === 1, off: 0 });
      used.add(cur.iv.id);
      const leave = (1 - cur.side) as 0 | 1;
      const list = ends.get(nodeOf(cur.iv, leave))!;
      if (list.length !== 2) break;
      const next = list.find((x) => !(x.iv === cur.iv && x.side === leave))!;
      if (next.iv === start.iv && next.side === start.side) {
        cyclic = true;
        break;
      }
      if (used.has(next.iv.id)) break;
      cur = next;
    }
    return { items, length: 0, cyclic };
  };
  const finish = (c: Chain): Chain => {
    let off = 0;
    for (const it of c.items) {
      it.off = off;
      off += it.iv.b - it.iv.a;
    }
    c.length = off;
    return c;
  };

  for (const k of [...ends.keys()].sort()) {
    const list = ends.get(k)!;
    if (list.length === 2) continue;
    for (const end of list) {
      if (used.has(end.iv.id)) continue;
      let c = walk(end);
      // Begin at the end whose first interval has the smaller (edge id, t).
      const first = c.items[0]!;
      const last = c.items[c.items.length - 1]!;
      const posA = { id: edges[first.iv.edge]!.id, t: first.rev ? first.iv.b : first.iv.a };
      const posB = { id: edges[last.iv.edge]!.id, t: last.rev ? last.iv.a : last.iv.b };
      if (posB.id < posA.id || (posB.id === posA.id && posB.t < posA.t)) {
        c = {
          ...c,
          items: c.items
            .slice()
            .reverse()
            .map((it) => ({ ...it, rev: !it.rev })),
        };
      }
      chains.push(finish(c));
    }
  }
  // Cyclic chains: from the interval with the smallest (edge id, a), rising t.
  const rest = ivs
    .filter((iv) => !used.has(iv.id))
    .sort((x, y) => cmpStr(edges[x.edge]!.id, edges[y.edge]!.id) || x.a - y.a);
  for (const iv of rest) {
    if (used.has(iv.id)) continue;
    chains.push(finish(walk({ iv, side: 0 })));
  }
  return chains;
}

/** Zones of a chain in its coordinate s (sorted). */
function chainZones(c: Chain): [number, number][] {
  const out: [number, number][] = [];
  for (const { iv, rev, off } of c.items) {
    if (iv.zlo > iv.zhi) continue;
    out.push(
      rev ? [off + iv.b - iv.zhi, off + iv.b - iv.zlo] : [off + iv.zlo - iv.a, off + iv.zhi - iv.a],
    );
  }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/** Nearest point of the zones inside the open interval (lo, hi), ties to the smaller one. */
function nearestAllowed(
  x: number,
  lo: number,
  hi: number,
  zones: readonly [number, number][],
): number | undefined {
  let best: { c: number; d: number } | undefined;
  for (const [zl, zh] of zones) {
    const l = Math.max(zl, lo + 1e-6);
    const h = Math.min(zh, hi - 1e-6);
    if (l > h) continue;
    const c = Math.min(Math.max(x, l), h);
    const d = Math.abs(c - x);
    if (!best || d < best.d - EPS || (Math.abs(d - best.d) <= EPS && c < best.c)) {
      best = { c, d };
    }
  }
  return best?.c;
}

/** Chain coordinate of (interval, t). */
function chainPos(c: Chain, iv: Interval, t: number): number {
  const it = c.items.find((x) => x.iv === iv)!;
  return it.rev ? it.off + iv.b - t : it.off + t - iv.a;
}

/** Interval and arc length of a chain coordinate inside a zone. */
function chainPoint(c: Chain, s: number): { iv: Interval; t: number } | undefined {
  const tol = 1e-6;
  for (const probe of [s, s + c.length]) {
    for (const { iv, rev, off } of c.items) {
      if (iv.zlo > iv.zhi) continue;
      const t = rev ? iv.b - (probe - off) : iv.a + (probe - off);
      if (t >= iv.zlo - tol && t <= iv.zhi + tol) {
        return { iv, t: Math.min(Math.max(t, iv.zlo), iv.zhi) };
      }
    }
    if (!c.cyclic) break;
  }
  return undefined;
}

export function planWaymarks(
  edges: readonly PlanEdge[],
  opts: Partial<PlanOptions> = {},
): PlacedSign[] {
  return planWithStats(edges, opts).signs;
}

export function planWithStats(
  edges: readonly PlanEdge[],
  opts: Partial<PlanOptions> = {},
): PlanStats {
  const o = { ...PLAN_DEFAULTS, ...opts };
  const order = [...edges]
    .filter((e) => e.parts.some((p) => p.signs.length > 0))
    .sort((a, b) => cmpStr(a.id, b.id) || cmpCoords(a.coords, b.coords));
  const lines = order.map((e) => new Line(e.coords));

  // Intervals.
  const intervals: Interval[] = [];
  const byEdge: Interval[][] = [];
  order.forEach((e, i) => {
    const list = lines[i]!.length > 0 ? intervalsOf(i, e, lines[i]!, o) : [];
    byEdge.push(list);
    for (const iv of list) {
      iv.id = intervals.length;
      intervals.push(iv);
    }
  });

  let short = 0;
  const candidates: Candidate[] = [];

  // A1: mandatory signs per edge.
  const mandatoryOn = new Map<number, number[]>();
  order.forEach((_, i) => {
    const line = lines[i]!;
    const longest = new Map<string, Interval>();
    for (const iv of byEdge[i]!) {
      const old = longest.get(iv.key);
      if (!old || iv.b - iv.a > old.b - old.a + EPS) longest.set(iv.key, iv);
    }
    const groups = new Map<string, Interval[]>();
    for (const iv of longest.values()) {
      if (iv.b - iv.a < o.minEdgeMm - EPS || iv.zlo > iv.zhi) {
        short++;
        continue;
      }
      const g = `${iv.a}|${iv.b}`;
      const list = groups.get(g);
      if (list) list.push(iv);
      else groups.set(g, [iv]);
    }
    for (const group of groups.values()) {
      group.sort((x, y) => cmpSign(x.sign, y.sign));
      const z0 = group[0]!.zlo;
      const z1 = group[0]!.zhi;
      const size = z1 - z0;
      const mid = (z0 + z1) / 2;
      const pitch = Math.max(...group.map((iv) => 2 * line.half(iv.sign, mid))) + o.signGapMm;
      const nFit = Math.floor(size / pitch + EPS) + 1;
      const n = Math.min(group.length, nFit);
      short += group.length - n;
      for (let j = 0; j < n; j++) {
        const iv = group[j]!;
        const t = z0 + ((j + 0.5) * size) / n;
        candidates.push({ iv, t0: t, mandatory: true });
        const list = mandatoryOn.get(iv.id);
        if (list) list.push(t);
        else mandatoryOn.set(iv.id, [t]);
      }
    }
  });
  const mandatoryWanted = candidates.length;

  // A2: repeats per sign and chain.
  const byKey = new Map<string, Interval[]>();
  for (const iv of intervals) {
    const list = byKey.get(iv.key);
    if (list) list.push(iv);
    else byKey.set(iv.key, [iv]);
  }
  const sp = o.spacingMm;
  for (const key of [...byKey.keys()].sort()) {
    for (const chain of chainsOf(byKey.get(key)!, order)) {
      let zones = chainZones(chain);
      if (zones.length === 0) continue;
      const C = chain.length;
      // A chain below the minimum length (a short edge between two branching points of k) shows
      // nothing of its own; the neighbouring chains show the sign.
      if (C < o.minEdgeMm - EPS) continue;
      const anchors: number[] = [];
      for (const it of chain.items) {
        for (const t of mandatoryOn.get(it.iv.id) ?? []) anchors.push(chainPos(chain, it.iv, t));
      }
      anchors.sort((x, y) => x - y);
      const added: number[] = [];
      let pts: { s: number; real: boolean }[];
      if (chain.cyclic) {
        zones = [...zones, ...zones.map(([l, h]): [number, number] => [l + C, h + C])];
        if (anchors.length === 0) {
          const first = nearestAllowed(
            C / 2,
            -Infinity,
            Infinity,
            zones.slice(0, zones.length / 2),
          );
          if (first === undefined) continue;
          anchors.push(first);
          added.push(first);
        }
        pts = [...anchors.map((s) => ({ s, real: true })), { s: anchors[0]! + C, real: true }];
      } else {
        const b0 = zones[0]![0];
        const bC = Math.max(...zones.map((z) => z[1]));
        pts = [
          { s: b0 - sp / 2, real: false },
          ...anchors.map((s) => ({ s, real: true })),
          { s: bC + sp / 2, real: false },
        ];
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        const u = pts[i]!;
        const w = pts[i + 1]!;
        const g = w.s - u.s;
        if (g <= sp + EPS) continue;
        const n = Math.ceil(g / sp - 1e-9) - 1;
        let prev = u;
        for (let j = 1; j <= n; j++) {
          const p = nearestAllowed(u.s + (j * g) / (n + 1), u.s, w.s, zones);
          if (
            p === undefined ||
            (prev.real && Math.abs(p - prev.s) < o.minSameMm - EPS) ||
            (w.real && Math.abs(w.s - p) < o.minSameMm - EPS)
          ) {
            short++;
            continue;
          }
          prev = { s: p, real: true };
          added.push(chain.cyclic ? ((p % C) + C) % C : p);
        }
      }
      for (const s of added) {
        const hit = chainPoint(chain, s);
        if (!hit) {
          short++;
          continue;
        }
        candidates.push({ iv: hit.iv, t0: hit.t, mandatory: false });
      }
    }
  }
  const repeatsWanted = candidates.length - mandatoryWanted;

  // Phase B: mandatory first, then higher networks, sign, edge, t.
  candidates.sort(
    (x, y) =>
      Number(y.mandatory) - Number(x.mandatory) ||
      x.iv.sign.rank - y.iv.sign.rank ||
      cmpStr(x.iv.key, y.iv.key) ||
      cmpStr(order[x.iv.edge]!.id, order[y.iv.edge]!.id) ||
      x.t0 - y.t0,
  );
  const half = o.clearanceMm / 2;
  const index = new BoxIndex();
  const placed: PlacedSign[] = [];
  const sameKey = new Map<string, number[]>();
  const steps = Math.floor(o.maxShiftMm / o.shiftStepMm + EPS);
  let mandatoryPlaced = 0;
  for (const c of candidates) {
    const iv = c.iv;
    const line = lines[iv.edge]!;
    const w = iv.sign.widthMm;
    const h = iv.sign.heightMm;
    const sameId = `${iv.edge}|${iv.key}`;
    const tryT = (t: number): PlacedSign | undefined => {
      if (t < iv.zlo - EPS || t > iv.zhi + EPS) return undefined;
      if (!c.mandatory) {
        for (const u of sameKey.get(sameId) ?? [])
          if (Math.abs(u - t) < o.minSameMm - EPS) return undefined;
      }
      const { x, y } = line.point(t);
      const box = { minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 };
      const grown: Obstacle = {
        minX: box.minX - half,
        minY: box.minY - half,
        maxX: box.maxX + half,
        maxY: box.maxY + half,
      };
      if (index.query(grown).length > 0) return undefined;
      index.add(grown);
      const list = sameKey.get(sameId);
      if (list) list.push(t);
      else sameKey.set(sameId, [t]);
      return {
        edgeId: order[iv.edge]!.id,
        key: iv.key,
        imageId: iv.sign.imageId,
        x,
        y,
        box,
        t,
        mandatory: c.mandatory,
      };
    };
    let result = tryT(c.t0);
    for (let n = 1; !result && n <= steps; n++) {
      const d = n * o.shiftStepMm;
      result = tryT(c.t0 + d) ?? tryT(c.t0 - d);
    }
    // Last resort for mandatory signs: the whole zone, outwards from the wanted place.
    if (!result && c.mandatory) {
      const most = Math.ceil(Math.max(c.t0 - iv.zlo, iv.zhi - c.t0) / o.shiftStepMm - EPS);
      for (let n = steps + 1; !result && n <= most; n++) {
        const d = n * o.shiftStepMm;
        result = tryT(c.t0 + d) ?? tryT(c.t0 - d);
      }
    }
    if (result) {
      placed.push(result);
      if (c.mandatory) mandatoryPlaced++;
    }
  }
  placed.sort((a, b) => cmpStr(a.edgeId, b.edgeId) || a.t - b.t);
  return {
    signs: placed,
    mandatory: { wanted: mandatoryWanted, placed: mandatoryPlaced },
    repeats: { wanted: repeatsWanted, placed: placed.length - mandatoryPlaced },
    short,
  };
}

function cmpCoords(a: readonly [number, number][], b: readonly [number, number][]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = a[i]![0] - b[i]![0] || a[i]![1] - b[i]![1];
    if (c !== 0) return c;
  }
  return a.length - b.length;
}
