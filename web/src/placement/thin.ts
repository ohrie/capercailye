// Thinning of urban restaurants/cafés, toilets and hotels by paper distance (PLAN.md 4a). Pure, no
// MapLibre.
//
// Three groups are thinned separately (THIN_GROUPS): gastro (restaurant + cafe together), toilets and
// hotels. Within a group the rule is greedy: the items are walked in descending rank (`outranks`:
// weight, then tag count, then id) and an item stays if no item of the same group that stayed before
// lies closer than the minimum distance. A hotel never displaces a toilet and so on. In a chain
// A – B – C (neighbours closer than the minimum, A > B > C) A and C stay, B drops out.
// Greedy depends on the whole neighbourhood, not only on what lies within the minimum distance, so
// the result is only reproducible on a fixed set of items: the app computes it ONCE per sheet
// layout from the tiles (waymarks/index.ts), and the preview and every export page use that same
// set. Without such a set (fallback) placement/collect.ts runs it over its own candidates.

/** Minimum distance between two urban items of the same group on paper (PLAN.md 4a). */
export const URBAN_THIN_MIN_MM = 8;
/** POI kinds per thinning group (when `urban`); every other kind never is thinned. */
export const THIN_GROUPS: Readonly<Record<string, readonly string[]>> = {
  gastro: ["restaurant", "cafe"],
  toilets: ["toilets"],
  hotel: ["hotel"],
};

/** Thinning group of a POI kind, or undefined if the kind is never thinned. */
export function thinGroup(kind: unknown): string | undefined {
  for (const [group, kinds] of Object.entries(THIN_GROUPS)) {
    if (kinds.includes(kind as string)) return group;
  }
  return undefined;
}

export interface ThinItem {
  id: string;
  /** Thinning group (see THIN_GROUPS); items of different groups never affect each other. */
  group: string;
  /** Global paper position in mm. */
  x: number;
  y: number;
  weight: number;
  tags: number;
}

/** Total order: higher weight wins, then more tags, then the lexicographically smaller id. */
export function outranks(a: ThinItem, b: ThinItem): boolean {
  if (a.weight !== b.weight) return a.weight > b.weight;
  if (a.tags !== b.tags) return a.tags > b.tags;
  return a.id < b.id;
}

/**
 * Ids of the items that stay (greedy per group, see above). Deterministic: independent of the
 * input order (the rank is a total order); every dropped item has a kept, higher-ranked neighbour
 * of its own group closer than `minMm`, and no two kept items of a group are closer than `minMm`.
 */
export function greedyThin(
  items: readonly ThinItem[],
  minMm: number = URBAN_THIN_MIN_MM,
): Set<string> {
  const byGroup = new Map<string, ThinItem[]>();
  for (const it of items) {
    const list = byGroup.get(it.group);
    if (list) list.push(it);
    else byGroup.set(it.group, [it]);
  }
  const kept = new Set<string>();
  for (const group of byGroup.values()) for (const id of thinOne(group, minMm)) kept.add(id);
  return kept;
}

/** The greedy rule on the items of one group. */
function thinOne(items: readonly ThinItem[], minMm: number): Set<string> {
  const cell = (v: number) => Math.floor(v / minMm);
  const order = [...items].sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0));
  const grid = new Map<string, ThinItem[]>();
  const kept = new Set<string>();
  for (const it of order) {
    const cx = cell(it.x);
    const cy = cell(it.y);
    let free = true;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(other.x - it.x, other.y - it.y) < minMm) {
            free = false;
            break search;
          }
        }
      }
    }
    if (!free) continue;
    kept.add(it.id);
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(it);
    else grid.set(key, [it]);
  }
  return kept;
}
