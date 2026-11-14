// Joins line pieces of the `routes` layer into stretches between forks. Pure.
//
// Input are pieces in global z12 tile units, already clipped to their tile (clip.ts), each with
// the ids of its visible routes. Pieces of neighbouring tiles meet at the border within a few
// units and Planetiler merges ways with equal route sets across junctions, so the graph is built
// with tolerances:
//
//  1. piece endpoints closer than `snap` are one node (smallest point of the cluster),
//  2. a node lying on the inside of another piece (T junction) splits that piece there,
//  3. a node is a pass-through if exactly two pieces with the same route set meet; everything
//     else (route change, branch, dead end) is a fork,
//  4. stretches run from fork to fork over pass-throughs; pure rings (only pass-throughs) become
//     one stretch with `ring: true`.
//
// The result does not depend on the input order or the direction of the pieces.

type Pt = [number, number];

export interface Piece {
  coords: [number, number][];
  /** Ids of the visible routes in tile order. */
  routes: string[];
}

export interface Stretch {
  id: string;
  coords: [number, number][];
  routes: string[];
  ring: boolean;
}

/** About 5 m at z12. */
export const SNAP_UNITS = 3;

const SEGMENT_CELL = 64;

interface Work {
  coords: Pt[];
  routes: string[];
  key: string;
}

const pointKey = (p: Pt): string => `${p[0]},${p[1]}`;

function comparePoints(a: Pt, b: Pt): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** Lexicographic order of two coordinate lists. */
function compareCoords(a: readonly Pt[], b: readonly Pt[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = comparePoints(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

function dedupe(coords: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of coords) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  return out;
}

/** Union-find over the endpoints; returns a map from point key to its cluster node. */
function snapEndpoints(works: Work[], snap: number): Map<string, Pt> {
  const pts: Pt[] = [];
  const seen = new Set<string>();
  for (const w of works) {
    for (const p of [w.coords[0]!, w.coords[w.coords.length - 1]!]) {
      const k = pointKey(p);
      if (!seen.has(k)) {
        seen.add(k);
        pts.push(p);
      }
    }
  }
  pts.sort(comparePoints);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / snap);
  pts.forEach((p, i) => {
    const cx = cell(p[0]);
    const cy = cell(p[1]);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(p[0] - pts[j]![0], p[1] - pts[j]![1]) <= snap) {
            const a = find(i);
            const b = find(j);
            if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
          }
        }
      }
    }
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  // Sorted input: the root (smallest index) is the smallest point of its cluster.
  const node = new Map<string, Pt>();
  pts.forEach((p, i) => node.set(pointKey(p), pts[find(i)]!));
  return node;
}

interface Cut {
  /** Position along the piece: vertex index k, or segment index + t (0 < t < 1). */
  pos: number;
  node: Pt;
  dist: number;
}

/** Splits pieces at nodes lying on their inside (T junctions). */
function splitAtNodes(works: Work[], snap: number): Work[] {
  const nodes = new Map<string, Pt>();
  for (const w of works) {
    nodes.set(pointKey(w.coords[0]!), w.coords[0]!);
    nodes.set(pointKey(w.coords[w.coords.length - 1]!), w.coords[w.coords.length - 1]!);
  }
  // Segment index.
  const grid = new Map<string, [number, number][]>();
  works.forEach((w, wi) => {
    for (let si = 0; si + 1 < w.coords.length; si++) {
      const a = w.coords[si]!;
      const b = w.coords[si + 1]!;
      const x0 = Math.floor((Math.min(a[0], b[0]) - snap) / SEGMENT_CELL);
      const x1 = Math.floor((Math.max(a[0], b[0]) + snap) / SEGMENT_CELL);
      const y0 = Math.floor((Math.min(a[1], b[1]) - snap) / SEGMENT_CELL);
      const y1 = Math.floor((Math.max(a[1], b[1]) + snap) / SEGMENT_CELL);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const list = grid.get(key);
          if (list) list.push([wi, si]);
          else grid.set(key, [[wi, si]]);
        }
      }
    }
  });

  const cuts = new Map<number, Map<string, Cut>>();
  const addCut = (wi: number, c: Cut) => {
    let m = cuts.get(wi);
    if (!m) cuts.set(wi, (m = new Map()));
    const k = pointKey(c.node);
    const old = m.get(k);
    if (!old || c.dist < old.dist) m.set(k, c);
  };
  for (const node of [...nodes.values()].sort(comparePoints)) {
    const list = grid.get(
      `${Math.floor(node[0] / SEGMENT_CELL)},${Math.floor(node[1] / SEGMENT_CELL)}`,
    );
    if (!list) continue;
    for (const [wi, si] of list) {
      const w = works[wi]!;
      const first = w.coords[0]!;
      const last = w.coords[w.coords.length - 1]!;
      if (comparePoints(first, node) === 0 || comparePoints(last, node) === 0) continue;
      const a = w.coords[si]!;
      const b = w.coords[si + 1]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((node[0] - a[0]) * dx + (node[1] - a[1]) * dy) / len2));
      const px = a[0] + t * dx;
      const py = a[1] + t * dy;
      const dist = Math.hypot(node[0] - px, node[1] - py);
      if (dist > snap) continue;
      const segLen = Math.sqrt(len2);
      if (t * segLen > snap && (1 - t) * segLen > snap) {
        addCut(wi, { pos: si + t, node, dist });
      } else {
        // Close to a vertex: only inner vertices count; the vertex is replaced by the node.
        for (const k of [si, si + 1]) {
          if (k < 1 || k > w.coords.length - 2) continue;
          const v = w.coords[k]!;
          const d = Math.hypot(node[0] - v[0], node[1] - v[1]);
          if (d <= snap) addCut(wi, { pos: k, node, dist: d });
        }
      }
    }
  }
  if (cuts.size === 0) return works;

  const out: Work[] = [];
  works.forEach((w, wi) => {
    const m = cuts.get(wi);
    if (!m) {
      out.push(w);
      return;
    }
    const list = [...m.values()].sort((a, b) => a.pos - b.pos || comparePoints(a.node, b.node));
    // Expanded polyline with flagged cut nodes.
    const exp: { p: Pt; cut: boolean }[] = [];
    let ci = 0;
    for (let j = 0; j < w.coords.length; j++) {
      let vertexCut: Cut | undefined;
      while (ci < list.length && list[ci]!.pos <= j) {
        if (list[ci]!.pos === j) vertexCut = list[ci]!;
        ci++;
      }
      if (vertexCut) exp.push({ p: vertexCut.node, cut: true });
      else exp.push({ p: w.coords[j]!, cut: false });
      const between: Cut[] = [];
      while (ci < list.length && list[ci]!.pos < j + 1) between.push(list[ci++]!);
      for (const c of between) exp.push({ p: c.node, cut: true });
    }
    let cur: Pt[] = [];
    exp.forEach((e, i) => {
      cur.push(e.p);
      if (e.cut && i > 0 && i < exp.length - 1) {
        const d = dedupe(cur);
        if (d.length >= 2) out.push({ coords: d, routes: w.routes, key: w.key });
        cur = [e.p];
      }
    });
    const d = dedupe(cur);
    if (d.length >= 2) out.push({ coords: d, routes: w.routes, key: w.key });
  });
  return out;
}

interface Attach {
  piece: number;
  end: 0 | 1;
}

export function buildStretches(pieces: readonly Piece[], snap = SNAP_UNITS): Stretch[] {
  // 1. Clean input.
  let works: Work[] = [];
  for (const p of pieces) {
    if (p.routes.length === 0) continue;
    const coords = dedupe(p.coords);
    if (coords.length < 2) continue;
    works.push({ coords, routes: p.routes, key: [...p.routes].sort().join(",") });
  }

  // 2. Snap endpoints.
  if (works.length === 0) return [];
  const node = snapEndpoints(works, snap);
  works = works.flatMap((w) => {
    const coords = w.coords.slice();
    coords[0] = node.get(pointKey(coords[0]!))!;
    coords[coords.length - 1] = node.get(pointKey(coords[coords.length - 1]!))!;
    const d = dedupe(coords);
    return d.length >= 2 ? [{ ...w, coords: d }] : [];
  });

  // 3. T junctions.
  works = splitAtNodes(works, snap);

  // 4. Adjacency.
  const adj = new Map<string, { node: Pt; list: Attach[] }>();
  const attach = (p: Pt, a: Attach) => {
    const k = pointKey(p);
    let e = adj.get(k);
    if (!e) adj.set(k, (e = { node: p, list: [] }));
    e.list.push(a);
  };
  works.forEach((w, i) => {
    attach(w.coords[0]!, { piece: i, end: 0 });
    attach(w.coords[w.coords.length - 1]!, { piece: i, end: 1 });
  });

  // 5. Fork or pass-through.
  const isFork = (k: string): boolean => {
    const e = adj.get(k)!;
    if (e.list.length !== 2) return true;
    return works[e.list[0]!.piece]!.key !== works[e.list[1]!.piece]!.key;
  };

  const used = new Set<number>();
  const oriented = (piece: number, end: 0 | 1): Pt[] => {
    const c = works[piece]!.coords;
    return end === 0 ? c : c.slice().reverse();
  };

  /** Walks from `start` over pass-throughs to the next fork (or back to `stopAt`). */
  const walk = (start: Attach, stopAt?: string): { coords: Pt[]; pieces: number[] } => {
    const pieces = [start.piece];
    let coords = oriented(start.piece, start.end).slice();
    let cur: Attach = start;
    for (;;) {
      const endNode = coords[coords.length - 1]!;
      const k = pointKey(endNode);
      if (k === stopAt || isFork(k)) break;
      const list = adj.get(k)!.list;
      const reachedEnd: 0 | 1 = cur.end === 0 ? 1 : 0;
      const next = list.find((a) => !(a.piece === cur.piece && a.end === reachedEnd));
      if (!next || pieces.includes(next.piece)) break;
      pieces.push(next.piece);
      coords = coords.concat(oriented(next.piece, next.end).slice(1));
      cur = next;
    }
    return { coords, pieces };
  };

  const raw: { coords: Pt[]; routes: string[]; key: string; ring: boolean }[] = [];
  const nodeKeys = [...adj.keys()].sort((a, b) =>
    comparePoints(adj.get(a)!.node, adj.get(b)!.node),
  );

  // 6. Stretches between forks.
  for (const k of nodeKeys) {
    if (!isFork(k)) continue;
    for (const a of adj.get(k)!.list) {
      if (used.has(a.piece)) continue;
      const r = walk(a);
      for (const p of r.pieces) used.add(p);
      raw.push({
        coords: r.coords,
        routes: works[a.piece]!.routes,
        key: works[a.piece]!.key,
        ring: false,
      });
    }
  }

  // 7. Rings.
  for (const k of nodeKeys) {
    for (const a of adj.get(k)!.list) {
      if (used.has(a.piece)) continue;
      const list = adj.get(k)!.list;
      // Both directions from the smallest node; take the smaller sequence.
      const walks = list.map((s) => walk(s, k));
      walks.sort((x, y) => compareCoords(x.coords, y.coords));
      const r = walks[0]!;
      for (const p of r.pieces) used.add(p);
      raw.push({
        coords: r.coords,
        routes: works[a.piece]!.routes,
        key: works[a.piece]!.key,
        ring: true,
      });
    }
  }

  // 8./9. Normalise direction, ids, sort.
  const items = raw.map((s) => {
    let coords = s.coords;
    if (!s.ring) {
      const rev = coords.slice().reverse();
      if (compareCoords(rev, coords) < 0) coords = rev;
    }
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    const base = `${s.key}@${Math.round(first[0])},${Math.round(first[1])},${Math.round(last[0])},${Math.round(last[1])}`;
    return { base, coords, routes: s.routes, ring: s.ring };
  });
  items.sort((a, b) =>
    a.base < b.base ? -1 : a.base > b.base ? 1 : compareCoords(a.coords, b.coords),
  );
  const count = new Map<string, number>();
  for (const it of items) count.set(it.base, (count.get(it.base) ?? 0) + 1);
  const seq = new Map<string, number>();
  return items.map((it) => {
    let id = it.base;
    if (count.get(it.base)! > 1) {
      const n = (seq.get(it.base) ?? 0) + 1;
      seq.set(it.base, n);
      id = `${it.base}#${n}`;
    }
    return { id, coords: it.coords, routes: it.routes, ring: it.ring };
  });
}
