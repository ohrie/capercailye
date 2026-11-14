import { describe, expect, test } from "bun:test";
import { POI_CATEGORIES, poiCategoryLayers } from "../style/poi";
import { evaluateLayer, thinUrban, type SourceFeature } from "./collect";
import { managedLayers } from "./layers";
import { greedyThin, outranks, THIN_GROUPS, thinGroup, type ThinItem } from "./thin";

const item = (
  id: string,
  x: number,
  y: number,
  weight = 0,
  tags = 0,
  group = "gastro",
): ThinItem => ({
  id,
  group,
  x,
  y,
  weight,
  tags,
});
const sorted = (s: Set<string>) => [...s].sort();

describe("thinGroup", () => {
  test("restaurant and cafe share a group; toilets and hotel have their own; others none", () => {
    expect(thinGroup("restaurant")).toBe("gastro");
    expect(thinGroup("cafe")).toBe("gastro");
    expect(thinGroup("toilets")).toBe("toilets");
    expect(thinGroup("hotel")).toBe("hotel");
    for (const k of ["alpine_hut", "bench", "pub", "guest_house", undefined, 3])
      expect(thinGroup(k)).toBeUndefined();
    expect(Object.keys(THIN_GROUPS).sort()).toEqual(["gastro", "hotel", "toilets"]);
  });
});

describe("greedyThin", () => {
  test("groups are thinned separately: a toilet and a hotel 1 mm apart both stay", () => {
    const kept = greedyThin([
      item("t", 0, 0, 3, 0, "toilets"),
      item("h", 1, 0, 1, 0, "hotel"),
      item("g", 0.5, 0, 0, 0, "gastro"),
    ]);
    expect(sorted(kept)).toEqual(["g", "h", "t"]);
  });

  test("two toilets 5 mm apart: the higher-ranked stays", () => {
    const kept = greedyThin([item("a", 0, 0, 1, 0, "toilets"), item("b", 5, 0, 3, 0, "toilets")]);
    expect(sorted(kept)).toEqual(["b"]);
  });

  test("chains per group: A > B > C 6 mm apart keep A and C, in every group", () => {
    for (const group of ["gastro", "toilets", "hotel"]) {
      const kept = greedyThin([
        item("A", 0, 0, 5, 0, group),
        item("B", 6, 0, 3, 0, group),
        item("C", 12, 0, 1, 0, group),
      ]);
      expect(sorted(kept), group).toEqual(["A", "C"]);
    }
  });

  test("a heavy hotel does not displace a toilet in a chain of another group", () => {
    // Hotel B sits between toilets A and C; only toilets count against each other.
    const kept = greedyThin([
      item("A", 0, 0, 5, 0, "toilets"),
      item("H", 3, 0, 9, 0, "hotel"),
      item("C", 6, 0, 1, 0, "toilets"),
    ]);
    expect(sorted(kept)).toEqual(["A", "H"]);
  });

  test("two places 5 mm apart: the lower weight drops out", () => {
    expect(sorted(greedyThin([item("a", 0, 0, 3), item("b", 5, 0, 1)]))).toEqual(["a"]);
  });

  test("two places 9 mm apart: both stay; exactly 8 mm stays too", () => {
    expect(greedyThin([item("a", 0, 0, 3), item("b", 9, 0, 1)]).size).toBe(2);
    expect(greedyThin([item("a", 0, 0, 3), item("b", 8, 0, 1)]).size).toBe(2);
  });

  test("ties: more tags win, then the smaller id", () => {
    expect(sorted(greedyThin([item("a", 0, 0, 2, 1), item("b", 1, 0, 2, 5)]))).toEqual(["b"]);
    expect(sorted(greedyThin([item("x", 0, 0, 2, 4), item("a", 1, 0, 2, 4)]))).toEqual(["a"]);
    expect(outranks(item("a", 0, 0, 2, 4), item("b", 0, 0, 2, 4))).toBe(true);
    expect(outranks(item("b", 0, 0, 2, 4), item("a", 0, 0, 2, 4))).toBe(false);
  });

  test("chain A(5) - 6 mm - B(3) - 6 mm - C(1): A and C stay, B drops out (greedy)", () => {
    const kept = greedyThin([item("A", 0, 0, 5), item("B", 6, 0, 3), item("C", 12, 0, 1)]);
    expect(sorted(kept)).toEqual(["A", "C"]);
  });

  test("independent of the input order", () => {
    const items = randomItems(200);
    const expected = sorted(greedyThin(items));
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(items.length);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 5; run++) {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(sorted(greedyThin(shuffled))).toEqual(expected);
    }
  });

  test("keeps every place without a kept higher-ranked neighbour closer than 8 mm", () => {
    const items = randomItems(300);
    const kept = greedyThin(items);
    const near = (a: ThinItem, b: ThinItem) => Math.hypot(a.x - b.x, a.y - b.y) < 8;
    for (const it of items) {
      const blocker = items.some((o) => kept.has(o.id) && outranks(o, it) && near(o, it));
      // Stays exactly if no kept place of higher rank is within reach.
      expect(kept.has(it.id)).toBe(!blocker);
    }
    // No two kept places are closer than 8 mm.
    const keptItems = items.filter((i) => kept.has(i.id));
    for (const a of keptItems)
      for (const b of keptItems) if (a !== b) expect(near(a, b)).toBe(false);
  });

  test("random items of three groups: the result is the union of the per-group results", () => {
    const groups = ["gastro", "toilets", "hotel"];
    const items = randomItems(300).map((it, i) => ({ ...it, group: groups[i % 3]! }));
    const kept = greedyThin(items);
    const union = new Set<string>();
    for (const g of groups) {
      for (const id of greedyThin(items.filter((it) => it.group === g))) union.add(id);
    }
    expect(sorted(kept)).toEqual(sorted(union));
    expect(greedyThin([...items].reverse()).size).toBe(kept.size);
  });

  test("keeps more than the local rule would (denser result)", () => {
    const row = Array.from({ length: 40 }, (_, i) => item(`r${i}`, i * 3.1, 0, (i * 7) % 5));
    expect(greedyThin(row).size).toBeGreaterThan(40 / 8);
  });
});

function randomItems(n: number): ThinItem[] {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return Array.from({ length: n }, (_, i) =>
    item(`p${i}`, rnd() * 80, rnd() * 80, Math.floor(rnd() * 4), Math.floor(rnd() * 3)),
  );
}

describe("thinUrban", () => {
  const layers = managedLayers(
    ["food", "toilets", "lodging"].flatMap((id) =>
      poiCategoryLayers(POI_CATEGORIES.find((c) => c.id === id)!).map((l) => ({
        ...l,
        metadata: { "capercailye:placement": "displace" },
      })),
    ),
  );
  const ZOOM = 13;
  // Papier-mm along a row at the equator-ish latitude: choose lng/lat, then compare in mm.
  const feat = (id: number, dLng: number, props: Record<string, unknown>): SourceFeature => ({
    id,
    properties: props,
    lngLat: [9.2 + dLng, 48.4],
  });
  const cands = (features: SourceFeature[]) =>
    layers.flatMap((l) => evaluateLayer(l, features, ZOOM));
  const ids = (c: { feature: SourceFeature }[]) => c.map((x) => x.feature.id).sort();

  test("only urban restaurants/cafés are thinned; others stay even 1 mm from a heavier one", () => {
    const c = cands([
      feat(1, 0, { kind: "restaurant", name: "A", urban: true, weight: 9, tags: 5 }),
      feat(2, 0.00001, { kind: "cafe", name: "B", urban: true, weight: 1, tags: 1 }),
      feat(3, 0.00002, { kind: "restaurant", name: "C", weight: 1, tags: 1 }),
      feat(4, 0.00003, { kind: "alpine_hut", name: "D", urban: true, weight: 0 }),
      feat(5, 0.00004, { kind: "cafe", name: "E", urban: false, weight: 0 }),
    ]);
    expect(c).toHaveLength(5);
    expect(ids(thinUrban(c))).toEqual([1, 3, 4, 5]);
  });

  test("a toilet without urban is never removed; an urban hotel without a set thins among hotels", () => {
    const c = cands([
      feat(1, 0, { kind: "toilets", name: "T1", urban: true, weight: 1 }),
      feat(2, 0.00001, { kind: "toilets", name: "T2", weight: 0 }),
      feat(3, 0.00002, { kind: "hotel", name: "H1", urban: true, weight: 5 }),
      feat(4, 0.00003, { kind: "hotel", name: "H2", urban: true, weight: 1 }),
      feat(5, 0.00004, { kind: "hotel", name: "H3", weight: 9 }),
      feat(6, 0.00005, { kind: "restaurant", name: "R", urban: true, weight: 0 }),
    ]);
    expect(c).toHaveLength(6);
    // Toilet 2 (not urban) and hotel 5 (not urban) stay; the urban hotels thin among themselves
    // (H2 drops); the urban toilet and restaurant have no urban neighbour of their own group.
    expect(ids(thinUrban(c))).toEqual([1, 2, 3, 5, 6]);
  });

  test("independent of the input order, also across groups", () => {
    const features = [
      feat(1, 0, { kind: "restaurant", name: "A", urban: true, weight: 2 }),
      feat(2, 0.00001, { kind: "cafe", name: "B", urban: true, weight: 1 }),
      feat(3, 0.00002, { kind: "restaurant", name: "C", urban: true, weight: 0 }),
      feat(4, 0.1, { kind: "restaurant", name: "D", urban: true, weight: 0 }),
    ];
    const expected = ids(thinUrban(cands(features)));
    expect(expected).toEqual([1, 4]);
    expect(ids(thinUrban(cands([...features].reverse())))).toEqual(expected);
    expect(ids(thinUrban(cands([features[2]!, features[0]!, features[3]!, features[1]!])))).toEqual(
      expected,
    );
  });

  test("urban places farther apart than 8 mm stay; missing weight/tags count as 0", () => {
    const c = cands([
      feat(1, 0, { kind: "restaurant", name: "A", urban: true }),
      feat(2, 0.00001, { kind: "restaurant", name: "B", urban: true }),
      feat(3, 0.1, { kind: "restaurant", name: "C", urban: true }),
    ]);
    // Same weight and tags: the smaller candidate key wins, so id 1 stays, id 2 drops.
    expect(ids(thinUrban(c))).toEqual([1, 3]);
  });

  test("keeps the order of the remaining candidates", () => {
    const c = cands([
      feat(3, 0, { kind: "restaurant", name: "C", urban: true, weight: 1 }),
      feat(2, 0.1, { kind: "cafe", name: "B", urban: true, weight: 1 }),
      feat(1, 0.00001, { kind: "cafe", name: "A", urban: true, weight: 0 }),
    ]);
    expect(thinUrban(c).map((x) => x.feature.id)).toEqual([3, 2]);
  });

  test("a kept set decides inside its region; outside the candidates thin among themselves", () => {
    const c = cands([
      feat(1, 0, { kind: "restaurant", name: "A", urban: true, weight: 9 }),
      feat(2, 0.00001, { kind: "restaurant", name: "B", urban: true, weight: 1 }),
      feat(3, 0.00002, { kind: "cafe", name: "C", urban: true, weight: 0 }),
    ]);
    const [x, y] = [c[0]!.item.x, c[0]!.item.y];
    const region = { minX: x - 5, minY: y - 5, maxX: x + 5, maxY: y + 5 };
    // The set keeps only 2 (overriding the rank): 1 and 3 drop although 3 is ranked lowest.
    expect(ids(thinUrban(c, { ids: new Set(["2"]), region }))).toEqual([2]);
    // Region elsewhere: the three are outside, greedy over themselves keeps A only.
    const away = { minX: x + 100, minY: y, maxX: x + 110, maxY: y + 10 };
    expect(ids(thinUrban(c, { ids: new Set(["2"]), region: away }))).toEqual([1]);
  });
});
