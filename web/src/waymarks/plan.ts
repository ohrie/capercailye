// Placement of waymark signs along stretches (PLAN.md 3 / 4a). Pure and deterministic.
//
// Input are stretches in global paper millimetres (y down) with the distinct signs of their routes.
// Signs stand upright (axis-parallel w × h boxes) at points of the line.
//
// Phase A works in one dimension per stretch (arc length t):
//   * End blocks: right after each fork (both ends of the stretch) all signs stand one behind the
//     other along the line, s1 closest to the fork, so every branch shows the signs of the routes
//     that continue there.
//   * Too short for two blocks: one centred block; if even that does not fit, the longest prefix
//     of the signs that fits, possibly none (the routes continue in the neighbouring stretches).
//   * Inside: the signs take turns (s1, s2, …), evenly spread; the number is the smallest one that
//     keeps every sign at most `spacingMm` from its previous occurrence.
// Phase B works in two dimensions over all stretches: signs are placed one after another (end
// blocks first, then inside signs; more important networks first) and shift along their line, away
// from the fork, until their box is free. A sign without a free place within `maxShiftMm` is
// dropped: signs never overlap.
import { BoxIndex, type Obstacle } from "../placement/displace";
import type { SignSpec } from "./signs";

export interface PlanStretch {
  id: string;
  coords: [number, number][];
  signs: SignSpec[];
  ring: boolean;
}

export interface PlacedSign {
  stretchId: string;
  key: string;
  imageId: string;
  /** Centre (mm). */
  x: number;
  y: number;
  /** Absolute box, without clearance. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** Arc length on the stretch (mm). */
  t: number;
  /** Belongs to an end block (sign at a fork). */
  end: boolean;
}

export interface PlanOptions {
  /** Largest distance of two equal signs on a stretch. */
  spacingMm: number;
  /** Distance stretch end → edge of the first sign. */
  endGapMm: number;
  /** Distance between two signs of a block (edge to edge, along the line). */
  gapMm: number;
  /** A centre must be at least this far from the stretch end. */
  minEndMm: number;
  /** Minimum distance of two boxes (of any stretches). */
  clearanceMm: number;
  /** Largest shift along the line when giving way. */
  maxShiftMm: number;
  shiftStepMm: number;
}

/** A sign of every route at least every 6 cm on paper. */
export const WAYMARK_SPACING_MM = 60;

export const PLAN_DEFAULTS: PlanOptions = {
  spacingMm: WAYMARK_SPACING_MM,
  endGapMm: 1.5,
  gapMm: 0.8,
  minEndMm: 0.5,
  clearanceMm: 0.4,
  maxShiftMm: 6,
  shiftStepMm: 0.5,
};

const MAX_INNER = 10_000;
const EPS = 1e-9;

/** A stretch prepared for planning: positive-length segments with cumulative arc length. */
class Line {
  readonly cum: number[] = [0];
  readonly segs: { x0: number; y0: number; x1: number; y1: number; len: number }[] = [];
  readonly length: number;

  constructor(coords: readonly [number, number][]) {
    for (let i = 0; i + 1 < coords.length; i++) {
      const [x0, y0] = coords[i]!;
      const [x1, y1] = coords[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len <= 0) continue;
      this.segs.push({ x0, y0, x1, y1, len });
      this.cum.push(this.cum[this.cum.length - 1]! + len);
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

/**
 * Centres of a block of signs one behind the other. `lead` is the leading edge (the first sign's
 * near edge); signs follow in direction `dir` (+1 increasing t, −1 decreasing). Half extents are
 * evaluated at provisional positions; two passes suffice.
 */
function block(
  line: Line,
  signs: readonly SignSpec[],
  lead: number,
  dir: 1 | -1,
  gap: number,
): { t: number[]; len: number } {
  let e = signs.map((s) => line.half(s, lead + (dir * s.widthMm) / 2));
  let t: number[] = [];
  let len = 0;
  for (let pass = 0; pass < 2; pass++) {
    t = [];
    let off = 0;
    signs.forEach((_, i) => {
      t.push(lead + dir * (off + e[i]!));
      off += 2 * e[i]! + gap;
    });
    len = off - gap;
    if (pass === 0) e = signs.map((s, i) => line.half(s, t[i]!));
  }
  return { t, len };
}

interface Candidate {
  stretch: number;
  sign: SignSpec;
  t0: number;
  /** Direction away from the fork (+1 / −1). */
  away: 1 | -1;
  end: boolean;
  /** Order inside the stretch: block index (0 start / 1 end / 2 inside), then sign index / t. */
  block: number;
  order: number;
}

/** Phase A: wanted arc lengths of the signs of one stretch. */
function phaseA(index: number, st: PlanStretch, line: Line, o: PlanOptions): Candidate[] {
  const signs = st.signs;
  const L = line.length;
  const k = signs.length;
  const out: Candidate[] = [];
  const push = (s: SignSpec, i: number, t0: number, away: 1 | -1, end: boolean, blk: number) =>
    out.push({ stretch: index, sign: s, t0, away, end, block: blk, order: blk === 2 ? t0 : i });

  const startBlock = block(line, signs, o.endGapMm, 1, o.gapMm);
  const endBlock = block(line, signs, L - o.endGapMm, -1, o.gapMm);
  const B = Math.max(startBlock.len, endBlock.len);

  if (L >= 2 * (o.endGapMm + B) + o.gapMm) {
    signs.forEach((s, i) => push(s, i, startBlock.t[i]!, 1, true, 0));
    signs.forEach((s, i) => push(s, i, endBlock.t[i]!, -1, true, 1));
    const a = startBlock.t[k - 1]!;
    const z = endBlock.t[k - 1]!;
    const maxW = Math.max(...signs.map((s) => s.widthMm));
    const pMin = maxW + o.gapMm;
    const nCap = Math.max(0, Math.min(MAX_INNER, Math.floor((z - a) / pMin + EPS) - 1));
    let n = 0;
    for (; n < nCap; n++) if (spacingOk(n, a, z, k, startBlock.t, endBlock.t, o.spacingMm)) break;
    const p = (z - a) / (n + 1);
    for (let j = 1; j <= n; j++) push(signs[(j - 1) % k]!, j, a + j * p, 1, false, 2);
    return out;
  }

  // One centred block, or its longest prefix that fits.
  const room = L - 2 * o.minEndMm;
  let j = k;
  while (j > 0 && block(line, signs.slice(0, j), L / 2, 1, o.gapMm).len > room + EPS) j--;
  if (j === 0) return out;
  const prefix = signs.slice(0, j);
  let lead = L / 2 - block(line, prefix, L / 2, 1, o.gapMm).len / 2;
  for (let pass = 0; pass < 2; pass++) {
    lead = L / 2 - block(line, prefix, lead, 1, o.gapMm).len / 2;
  }
  const b = block(line, prefix, lead, 1, o.gapMm);
  prefix.forEach((s, i) => push(s, i, b.t[i]!, 1, true, 0));
  return out;
}

/** Whether N inside signs keep every sign within `spacing` of its previous occurrence. */
function spacingOk(
  n: number,
  a: number,
  z: number,
  k: number,
  ts: readonly number[],
  te: readonly number[],
  spacing: number,
): boolean {
  const p = (z - a) / (n + 1);
  const last = ts.slice();
  for (let j = 1; j <= n; j++) {
    const i = (j - 1) % k;
    const t = a + j * p;
    if (t - last[i]! > spacing + EPS) return false;
    last[i] = t;
  }
  for (let i = 0; i < k; i++) if (te[i]! - last[i]! > spacing + EPS) return false;
  return true;
}

export function planWaymarks(
  stretches: readonly PlanStretch[],
  opts: Partial<PlanOptions> = {},
): PlacedSign[] {
  return planWithStats(stretches, opts).signs;
}

/** Like planWaymarks, plus the number of signs phase A asked for (placed + dropped). */
export function planWithStats(
  stretches: readonly PlanStretch[],
  opts: Partial<PlanOptions> = {},
): { signs: PlacedSign[]; wanted: number } {
  const o = { ...PLAN_DEFAULTS, ...opts };
  const order = [...stretches]
    .filter((s) => s.signs.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : cmpCoords(a.coords, b.coords)));
  const lines = order.map((s) => new Line(s.coords));

  // Phase A.
  const candidates: Candidate[] = [];
  order.forEach((s, i) => {
    if (lines[i]!.length > 0) candidates.push(...phaseA(i, s, lines[i]!, o));
  });

  // Phase B order: end blocks first, then inside; stretches by importance.
  const importance = order.map((s) => ({
    rank: Math.min(...s.signs.map((x) => x.rank)),
    count: s.signs.length,
  }));
  const stretchOrder = order.map((_, i) => i);
  stretchOrder.sort((a, b) => {
    const x = importance[a]!;
    const y = importance[b]!;
    return x.rank - y.rank || y.count - x.count || a - b;
  });
  const stretchPos = new Map(stretchOrder.map((s, i) => [s, i]));
  candidates.sort((a, b) => {
    if (a.end !== b.end) return a.end ? -1 : 1;
    return (
      stretchPos.get(a.stretch)! - stretchPos.get(b.stretch)! ||
      a.block - b.block ||
      a.order - b.order
    );
  });

  const half = o.clearanceMm / 2;
  const index = new BoxIndex();
  const placed: PlacedSign[] = [];
  const steps = Math.floor(o.maxShiftMm / o.shiftStepMm + EPS);
  for (const c of candidates) {
    const line = lines[c.stretch]!;
    const L = line.length;
    const w = c.sign.widthMm;
    const h = c.sign.heightMm;
    const tryT = (t: number): PlacedSign | undefined => {
      if (t < o.minEndMm - EPS || t > L - o.minEndMm + EPS) return undefined;
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
      return {
        stretchId: order[c.stretch]!.id,
        key: c.sign.key,
        imageId: c.sign.imageId,
        x,
        y,
        box,
        t,
        end: c.end,
      };
    };
    let result = tryT(c.t0);
    for (let n = 1; !result && n <= steps; n++) {
      const d = n * o.shiftStepMm;
      result = tryT(c.t0 + c.away * d) ?? tryT(c.t0 - c.away * d);
    }
    if (result) placed.push(result);
  }
  placed.sort((a, b) =>
    a.stretchId < b.stretchId ? -1 : a.stretchId > b.stretchId ? 1 : a.t - b.t,
  );
  return { signs: placed, wanted: candidates.length };
}

function cmpCoords(a: readonly [number, number][], b: readonly [number, number][]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = a[i]![0] - b[i]![0] || a[i]![1] - b[i]![1];
    if (c !== 0) return c;
  }
  return a.length - b.length;
}
