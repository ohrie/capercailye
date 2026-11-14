// Clipping of tile-local polylines to the exact tile area (no buffer). Pure.
//
// The vector tiles carry a buffer around the tile; the waymark pipeline wants every piece of a way
// exactly once, so each line is cut at the tile border [0, extent]² (Liang–Barsky per segment).

export const TILE_EXTENT = 4096;

type Pt = [number, number];

const EPS = 1e-9;

/** Snaps float noise at the border to the border itself. */
function snap(v: number, extent: number): number {
  if (Math.abs(v) < EPS) return 0;
  if (Math.abs(v - extent) < EPS) return extent;
  return v;
}

/** Liang–Barsky: parameter range [t0, t1] of segment a→b inside the square, or undefined. */
function clipSegment(a: Pt, b: Pt, extent: number): [number, number] | undefined {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a[0], extent - a[0], a[1], extent - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return undefined;
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) {
        if (r > t1) return undefined;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return undefined;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1 ? [t0, t1] : undefined;
}

/** Clips a tile-local polyline to [0, extent]², returns the inside parts (each ≥ 2 points). */
export function clipLineToTile(
  line: readonly [number, number][],
  extent = TILE_EXTENT,
): [number, number][][] {
  const pts: Pt[] = [];
  for (const p of line) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push([p[0], p[1]]);
  }
  const parts: Pt[][] = [];
  let cur: Pt[] | undefined;
  const flush = () => {
    if (cur && cur.length >= 2) parts.push(cur);
    cur = undefined;
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const range = clipSegment(a, b, extent);
    if (!range) {
      flush();
      continue;
    }
    const [t0, t1] = range;
    const at = (t: number): Pt => [
      snap(a[0] + (b[0] - a[0]) * t, extent),
      snap(a[1] + (b[1] - a[1]) * t, extent),
    ];
    const p = t0 === 0 ? a : at(t0);
    const q = t1 === 1 ? b : at(t1);
    if (p[0] === q[0] && p[1] === q[1]) {
      // Touches the square in one point only.
      flush();
      continue;
    }
    if (cur && t0 === 0) cur.push(q);
    else {
      flush();
      cur = [p, q];
    }
    if (t1 < 1) flush();
  }
  flush();
  return parts;
}
