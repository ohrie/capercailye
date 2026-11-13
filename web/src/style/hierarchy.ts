// Importance hierarchy of the map symbols: the single source for who stays and who gives way.
//
// Smaller number = more important. A more important symbol keeps its place in the print
// placement (src/placement: a less important one is displaced around it) and is drawn on top of
// less important ones, across layers and sources (the merged icon layer of the placement sorts by
// this number, see placement/layers.ts). Tiers are the tens; within a tier the units order finer.
//
// Not in the table: summit dots and settlement names ("fixed", never moved) and the waymark signs
// (tier 0: layer `waymarks-line`, always on top and placed first, role "obstacle").
import type { PoiKind } from "../icons/registry";

/** Everything that has a rank: the tile kinds plus the GTFS bus stop (own source, no `kind`). */
export type RankedKey = PoiKind | "busstop";

export interface Tier {
  tier: number;
  /** German name (README, tests). */
  label: string;
  ranks: Partial<Record<RankedKey, number>>;
}

/** Waymark signs: above everything, handled by the layer order, not by a rank. */
export const WAYMARK_TIER = 0;

export const TIERS: readonly Tier[] = [
  { tier: WAYMARK_TIER, label: "Wegzeichen", ranks: {} },
  {
    tier: 1,
    label: "Anreise und Schutz",
    ranks: {
      railway_station: 10,
      railway_halt: 11,
      busstop: 12,
      alpine_hut: 13,
      wilderness_hut: 14,
      shelter: 14,
    },
  },
  { tier: 2, label: "Wasser", ranks: { drinking_water: 20, spring: 21 } },
  {
    tier: 3,
    label: "Ziele",
    ranks: {
      viewtower: 30,
      castle: 31,
      castle_ruins: 32,
      ruins: 33,
      cave_entrance: 34,
      waterfall: 35,
      viewpoint: 36,
    },
  },
  { tier: 4, label: "Einkehr", ranks: { restaurant: 40, cafe: 41 } },
  {
    tier: 5,
    label: "Wanderinfrastruktur",
    ranks: { parking: 50, guidepost: 51, toilets: 52, picnic_site: 53, bbq: 54 },
  },
  {
    tier: 6,
    label: "Übernachtung",
    ranks: { camp_site: 60, hostel: 61, caravan_site: 62, hotel: 63 },
  },
  {
    tier: 7,
    label: "Kirchen",
    ranks: { church: 70, chapel: 71, place_of_worship: 72, monument: 73 },
  },
  {
    tier: 8,
    label: "Kleine Landmarken",
    ranks: {
      tower: 80,
      communication_tower: 80,
      wind_turbine: 81,
      mast: 81,
      wayside_cross: 82,
      wayside_shrine: 82,
      memorial: 83,
      fountain: 83,
      rock: 84,
      stone: 84,
      sinkhole: 84,
      weir: 85,
    },
  },
];

/** Rank of every kind (and of the bus stop), flattened from TIERS. */
export const RANKS = Object.fromEntries(TIERS.flatMap((t) => Object.entries(t.ranks))) as Record<
  RankedKey,
  number
>;

/** Rank of the GTFS bus stop. */
export const BUSSTOP_PRIORITY = RANKS.busstop;

/** Unnamed guideposts are the last thing on the sheet: the first to give way. */
export const UNNAMED_GUIDEPOST_PRIORITY = 89;

/** Kinds the tiles may add later without a rank here: behind the churches, before the landmarks. */
export const FALLBACK_PRIORITY = 79;

/** Rank of every tile kind (without the bus stop): the `PRIORITY` table of style/poi.ts. */
export const KIND_RANKS = Object.fromEntries(
  Object.entries(RANKS).filter(([k]) => k !== "busstop"),
) as Record<PoiKind, number>;

/** Tier (tens digit) of a rank. */
export const tierOf = (rank: number): number => Math.floor(rank / 10);
