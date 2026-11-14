// Joins line pieces of the `routes` layer into edges between real forks. Pure.
//
// Input are pieces in global z12 tile units, already clipped to their tile (clip.ts), each with
// the sign keys of its visible routes (signs.ts; the caller translates relation ids, so routes with
// the same sign are one). Pieces of neighbouring tiles meet at the border within a few units and
// Planetiler merges ways with equal route sets across junctions, so the graph is built with
// tolerances:
//
//  1. piece endpoints closer than `snap` are one node (smallest point of the cluster),
//  2. a node lying on the inside of another piece (T junction) splits that piece there,
//  3. dead-end stubs shorter than `stub` hanging on a fork (tile seam leftovers) are dropped,
//  4. a node is a fork if at least three pieces (branches with visible signs) meet there; a node
//     with exactly two pieces is always a pass-through, even if the signs change there (end of a
//     route, gap, tile seam, parent/child relations with the same sign); a node with one piece is a
//     dead end,
//  5. edges run from fork/dead end to fork/dead end over pass-throughs; consecutive pieces with the
//     same sign set are merged into one part of the edge, so an edge knows which signs run on
//     which stretch of it. Pure rings (only pass-throughs) become one edge with `ring: true`,
//     starting at the smallest node where the sign set changes (else the smallest node).
//
// The result does not depend on the input order or the direction of the pieces.

type Pt = [number, number];

export interface Piece {
  coords: [number, number][];
  /** Sign keys of the visible routes (order does not matter). */
  keys: string[];
}

export interface EdgePart {
  /** The part ends at vertex index `end` of the edge (it starts where the previous part ends). */
  end: number;
  /** Sorted, distinct sign keys. */
  keys: string[];
}

export interface Edge {
  id: string;
  coords: [number, number][];
  /** Part i covers the vertices [parts[i-1].end ?? 0, parts[i].end]; the last `end` is coords.length-1. */
  parts: EdgePart[];
  ring: boolean;
  /** Node id (`x,y`) of a real fork, else null (dead end, ring). */
  start: string | null;
  end: string | null;
}

/** About 5 m at z12. */
export const SNAP_UNITS = 3;
/** Dead-end stubs shorter than this (about 16 m at z12) that hang on a fork are dropped. */
export const STUB_UNITS = 10;

const SEGMENT_CELL = 64;

interface Work {
  coords: Pt[];
  /** Sorted, distinct sign keys. */
  keys: string[];
  /** `keys` joined. */
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
        if (d.length >= 2) out.push({ coords: d, keys: w.keys, key: w.key });
        cur = [e.p];
      }
    });
    const d = dedupe(cur);
    if (d.length >= 2) out.push({ coords: d, keys: w.keys, key: w.key });
  });
  return out;
}

interface Attach {
  piece: number;
  end: 0 | 1;
}

function pathLength(coords: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += Math.hypot(coords[i]![0] - coords[i - 1]![0], coords[i]![1] - coords[i - 1]![1]);
  }
  return len;
}

/** Drops short dead-end pieces that hang on a fork (one pass, degrees of the input). */
function dropStubs(works: Work[], stub: number): Work[] {
  const deg = new Map<string, number>();
  const bump = (p: Pt) => deg.set(pointKey(p), (deg.get(pointKey(p)) ?? 0) + 1);
  for (const w of works) {
    bump(w.coords[0]!);
    bump(w.coords[w.coords.length - 1]!);
  }
  return works.filter((w) => {
    const d0 = deg.get(pointKey(w.coords[0]!))!;
    const d1 = deg.get(pointKey(w.coords[w.coords.length - 1]!))!;
    const hangs = (d0 === 1 && d1 >= 3) || (d0 >= 3 && d1 === 1);
    return !(hangs && pathLength(w.coords) < stub);
  });
}

interface RawEdge {
  coords: Pt[];
  parts: EdgePart[];
  ring: boolean;
  start: string | null;
  end: string | null;
}

export function buildEdges(pieces: readonly Piece[], snap = SNAP_UNITS, stub = STUB_UNITS): Edge[] {
  // 1. Clean input.
  let works: Work[] = [];
  for (const p of pieces) {
    const keys = [...new Set(p.keys)].sort();
    if (keys.length === 0) continue;
    const coords = dedupe(p.coords);
    if (coords.length < 2) continue;
    works.push({ coords, keys, key: keys.join(",") });
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

  // 3. T junctions, 4. stubs.
  works = dropStubs(splitAtNodes(works, snap), stub);
  if (works.length === 0) return [];

  // 5. Adjacency.
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
  const degree = (k: string): number => adj.get(k)!.list.length;
  const isFork = (k: string): boolean => degree(k) >= 3;

  const used = new Set<number>();
  const oriented = (piece: number, end: 0 | 1): Pt[] => {
    const c = works[piece]!.coords;
    return end === 0 ? c : c.slice().reverse();
  };

  interface Walk {
    coords: Pt[];
    /** Pieces in walking order with the vertex index where each ends. */
    steps: { piece: number; end: number }[];
    /** Node where each piece ends. */
    nodes: Pt[];
  }

  /** Walks from `start` over pass-throughs to the next fork or dead end (or back to `stopAt`). */
  const walk = (start: Attach, stopAt?: string): Walk => {
    let coords = oriented(start.piece, start.end).slice();
    const steps = [{ piece: start.piece, end: coords.length - 1 }];
    const nodes = [coords[coords.length - 1]!];
    let cur: Attach = start;
    for (;;) {
      const endNode = coords[coords.length - 1]!;
      const k = pointKey(endNode);
      if (k === stopAt || degree(k) !== 2) break;
      const list = adj.get(k)!.list;
      const reachedEnd: 0 | 1 = cur.end === 0 ? 1 : 0;
      const next = list.find((a) => !(a.piece === cur.piece && a.end === reachedEnd));
      if (!next || steps.some((s) => s.piece === next.piece)) break;
      coords = coords.concat(oriented(next.piece, next.end).slice(1));
      steps.push({ piece: next.piece, end: coords.length - 1 });
      nodes.push(coords[coords.length - 1]!);
      cur = next;
    }
    return { coords, steps, nodes };
  };

  /** Parts of a walk: consecutive pieces with equal sign sets are merged. */
  const partsOf = (w: Walk): EdgePart[] => {
    const parts: EdgePart[] = [];
    for (const s of w.steps) {
      const piece = works[s.piece]!;
      const last = parts[parts.length - 1];
      if (last && last.keys.join(",") === piece.key) last.end = s.end;
      else parts.push({ end: s.end, keys: piece.keys });
    }
    return parts;
  };

  const raw: RawEdge[] = [];
  const nodeKeys = [...adj.keys()].sort((a, b) =>
    comparePoints(adj.get(a)!.node, adj.get(b)!.node),
  );

  // 6. Edges between forks / dead ends.
  for (const k of nodeKeys) {
    if (degree(k) === 2) continue;
    for (const a of adj.get(k)!.list) {
      if (used.has(a.piece)) continue;
      const r = walk(a);
      for (const s of r.steps) used.add(s.piece);
      const endKey = pointKey(r.coords[r.coords.length - 1]!);
      raw.push({
        coords: r.coords,
        parts: partsOf(r),
        ring: false,
        start: isFork(k) ? k : null,
        end: isFork(endKey) ? endKey : null,
      });
    }
  }

  // 7. Rings: start at the smallest node where the sign set changes, else the smallest node.
  for (const k of nodeKeys) {
    for (const a of adj.get(k)!.list) {
      if (used.has(a.piece)) continue;
      const probe = walk(adj.get(k)!.list[0]!, k);
      let startKey = k;
      let startNode = adj.get(k)!.node;
      let found = false;
      probe.steps.forEach((s, i) => {
        const nextPiece = probe.steps[(i + 1) % probe.steps.length]!.piece;
        if (works[s.piece]!.key === works[nextPiece]!.key) return;
        const n = probe.nodes[i]!;
        if (!found || comparePoints(n, startNode) < 0) {
          found = true;
          startNode = n;
          startKey = pointKey(n);
        }
      });
      // Both directions from the start node; take the smaller sequence.
      const walks = adj.get(startKey)!.list.map((s) => walk(s, startKey));
      walks.sort((x, y) => compareCoords(x.coords, y.coords));
      const r = walks[0]!;
      for (const s of r.steps) used.add(s.piece);
      raw.push({ coords: r.coords, parts: partsOf(r), ring: true, start: null, end: null });
    }
  }

  // 8./9. Normalise direction, ids, sort.
  const items = raw.map((e) => {
    let { coords, parts, start, end } = e;
    if (!e.ring) {
      const rev = coords.slice().reverse();
      if (compareCoords(rev, coords) < 0) {
        const last = coords.length - 1;
        const startOf = (i: number) => (i === 0 ? 0 : parts[i - 1]!.end);
        const m = parts.length - 1;
        parts = parts.map((_, j) => ({
          end: last - startOf(m - j),
          keys: parts[m - j]!.keys,
        }));
        coords = rev;
        [start, end] = [end, start];
      }
    }
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    const base = `${parts.map((p) => p.keys.join(",")).join("/")}@${Math.round(first[0])},${Math.round(first[1])},${Math.round(last[0])},${Math.round(last[1])}`;
    return { base, coords, parts, ring: e.ring, start, end };
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
    return {
      id,
      coords: it.coords,
      parts: it.parts,
      ring: it.ring,
      start: it.start,
      end: it.end,
    };
  });
}
