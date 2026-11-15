// Symbol displacement for the fixed print scale (SPEC.md 4.4). Pure and deterministic.
//
// Every symbol is drawn. Items are placed one after another in priority order (lower value =
// more important, ties by id); each takes the free position closest to its true location within
// MAX_SHIFT_MM, searching rings of growing radius and, on each ring, the direction pointing away
// from what blocks it first. The most important symbol of a cluster therefore stays in place and
// the others give way. If no free position exists within the limit (extremely dense spots),
// the item takes the position with the least overlap: it is drawn overlapping rather than
// dropped. Items displaced so far that their own box no longer reaches the true location get a
// leader line from the true location to the box.
//
// Units are paper millimetres, y pointing down (screen convention). The algorithm knows nothing
// about MapLibre; collect.ts feeds it with projected features.

/** Box relative to the item's anchor (its true location). */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PlaceItem {
  /** Unique and stable (e.g. layer id + OSM id); breaks priority ties. */
  id: string;
  /** True location on paper (mm). */
  x: number;
  y: number;
  box: Box;
  /** Lower = more important = placed earlier = moves less. */
  priority: number;
  /** Never moves (e.g. peak dots); placed before everything else. */
  fixed?: boolean;
}

/** Already placed boxes (absolute mm), e.g. from a previous pass. */
export interface Obstacle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Placement {
  id: string;
  /** Displacement of the symbol (mm). */
  dx: number;
  dy: number;
  /** Leader from the true location (x, y) to this point on the displaced box, if any. */
  leader?: { x: number; y: number };
  /** Could not be placed without overlap within the limit. */
  overlapping: boolean;
}

export interface PlaceOptions {
  /** Largest displacement (mm). */
  maxShiftMm: number;
  /** Ring spacing of the candidate search (mm). */
  stepMm: number;
  /** Minimum clearance between two boxes (mm). */
  gapMm: number;
  /** Leader when the displaced box is at least this far from the true location (mm). */
  leaderGapMm: number;
  /** Boxes that are already taken. */
  obstacles?: readonly Obstacle[];
}

export const PLACE_DEFAULTS: PlaceOptions = {
  maxShiftMm: 4,
  stepMm: 0.25,
  gapMm: 0.15,
  leaderGapMm: 0.5,
};

const CELL_MM = 4;

/** Uniform grid over absolute boxes (also used by waymarks/plan.ts). */
export class BoxIndex {
  private readonly cells = new Map<string, Obstacle[]>();

  add(b: Obstacle): void {
    for (const key of this.keys(b)) {
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(b);
    }
  }

  /** Boxes intersecting `b` (may contain duplicates). */
  query(b: Obstacle): Obstacle[] {
    const out: Obstacle[] = [];
    for (const key of this.keys(b)) {
      const list = this.cells.get(key);
      if (list) for (const o of list) if (intersects(o, b)) out.push(o);
    }
    return out;
  }

  private *keys(b: Obstacle): Generator<string> {
    const x0 = Math.floor(b.minX / CELL_MM);
    const x1 = Math.floor(b.maxX / CELL_MM);
    const y0 = Math.floor(b.minY / CELL_MM);
    const y1 = Math.floor(b.maxY / CELL_MM);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) yield `${x},${y}`;
  }
}

function intersects(a: Obstacle, b: Obstacle): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function overlapArea(a: Obstacle, b: Obstacle): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Absolute box of an item shifted by (dx, dy), grown by `pad` on every side. */
function boxAt(item: PlaceItem, dx: number, dy: number, pad = 0): Obstacle {
  return {
    minX: item.x + dx + item.box.minX - pad,
    minY: item.y + dy + item.box.minY - pad,
    maxX: item.x + dx + item.box.maxX + pad,
    maxY: item.y + dy + item.box.maxY + pad,
  };
}

interface Ring {
  r: number;
  /** Unit directions, evenly spaced, starting east, clockwise on screen. */
  angles: number[];
}

function rings(opts: PlaceOptions): Ring[] {
  const out: Ring[] = [];
  const n = Math.floor(opts.maxShiftMm / opts.stepMm + 1e-9);
  for (let k = 1; k <= n; k++) {
    const r = k * opts.stepMm;
    const count = Math.max(8, 4 * Math.ceil((2 * Math.PI * r) / opts.stepMm / 4));
    out.push({ r, angles: Array.from({ length: count }, (_, i) => (2 * Math.PI * i) / count) });
  }
  return out;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** Deterministic placement order: fixed first, then priority, then id. */
export function placementOrder(a: PlaceItem, b: PlaceItem): number {
  if (!!a.fixed !== !!b.fixed) return a.fixed ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Closest point of an absolute box to (x, y). */
function closestPoint(b: Obstacle, x: number, y: number): { x: number; y: number } {
  return { x: Math.min(Math.max(x, b.minX), b.maxX), y: Math.min(Math.max(y, b.minY), b.maxY) };
}

export function placeSymbols(
  items: readonly PlaceItem[],
  options: Partial<PlaceOptions> = {},
): Placement[] {
  const opts = { ...PLACE_DEFAULTS, ...options };
  const half = opts.gapMm / 2;
  const index = new BoxIndex();
  for (const o of opts.obstacles ?? []) {
    index.add({
      minX: o.minX - half,
      minY: o.minY - half,
      maxX: o.maxX + half,
      maxY: o.maxY + half,
    });
  }
  const search = rings(opts);
  const sorted = [...items].sort(placementOrder);
  const out: Placement[] = [];

  for (const item of sorted) {
    let dx = 0;
    let dy = 0;
    let overlapping = false;
    const blockers = item.fixed ? [] : index.query(boxAt(item, 0, 0, half));
    if (blockers.length > 0) {
      // Preferred direction: away from the overlap-weighted centre of what blocks the spot.
      const own = boxAt(item, 0, 0, half);
      const ownCx = (own.minX + own.maxX) / 2;
      const ownCy = (own.minY + own.maxY) / 2;
      let wx = 0;
      let wy = 0;
      let wSum = 0;
      for (const b of blockers) {
        const w = overlapArea(own, b) + 1e-6;
        wx += w * ((b.minX + b.maxX) / 2);
        wy += w * ((b.minY + b.maxY) / 2);
        wSum += w;
      }
      const vx = ownCx - wx / wSum;
      const vy = ownCy - wy / wSum;
      const preferred = Math.hypot(vx, vy) < 1e-9 ? 0 : Math.atan2(vy, vx);

      let found = false;
      let best = { area: Infinity, dx: 0, dy: 0 };
      const consider = (cx: number, cy: number) => {
        const area = index
          .query(boxAt(item, cx, cy, half))
          .reduce((s, b) => s + overlapArea(boxAt(item, cx, cy, half), b), 0);
        if (area < best.area - 1e-9) best = { area, dx: cx, dy: cy };
      };
      consider(0, 0);
      for (const ring of search) {
        const order = [...ring.angles].sort(
          (a, b) => angleDiff(a, preferred) - angleDiff(b, preferred) || a - b,
        );
        for (const a of order) {
          // Round to 1e-6 mm so tiny float noise cannot change results between runs.
          const cx = Math.round(ring.r * Math.cos(a) * 1e6) / 1e6;
          const cy = Math.round(ring.r * Math.sin(a) * 1e6) / 1e6;
          if (index.query(boxAt(item, cx, cy, half)).length === 0) {
            dx = cx;
            dy = cy;
            found = true;
            break;
          }
          consider(cx, cy);
        }
        if (found) break;
      }
      if (!found) {
        dx = best.dx;
        dy = best.dy;
        overlapping = true;
      }
    }
    const placed = boxAt(item, dx, dy);
    index.add(boxAt(item, dx, dy, half));
    const p: Placement = { id: item.id, dx, dy, overlapping };
    const near = closestPoint(placed, item.x, item.y);
    if (Math.hypot(near.x - item.x, near.y - item.y) >= opts.leaderGapMm) p.leader = near;
    out.push(p);
  }
  return out;
}

/** Absolute boxes of placed items (for a follow-up pass). */
export function placedBoxes(
  items: readonly PlaceItem[],
  placements: readonly Placement[],
): Obstacle[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return placements.flatMap((p) => {
    const item = byId.get(p.id);
    return item ? [boxAt(item, p.dx, p.dy)] : [];
  });
}
