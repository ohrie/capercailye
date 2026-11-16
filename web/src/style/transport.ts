// Roads, tracks, paths and railways (tile layer `transport`): A1–A9.
//
// Drawn in three levels (tunnel → ground → bridge). Within a level: bridge outlines (bridge level
// only), tracks, paths, road casings, road fills, railways. Paths therefore stop at road casings
// at grade, and every bridge lies above everything on the ground.
//
// Sizes are paper mm (units.ts). Every path and track must stay clearly visible at 1:25 000:
// the narrowest way signature is 0.25 mm black.
import type { ExpressionSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { all, any, attrIn, cases, flag, kindIn, matchAttr, not } from "./expr";
import { COLORS } from "./palette";
import { OSM_SOURCE } from "./sources";
import { iconSizeByScale } from "./sizes";
import { dashes, dots, lineWidth, mm } from "./units";

type Level = "tunnel" | "ground" | "bridge";
type Filter = ExpressionSpecification;

const isRail = flag("rail");
const tunnel = flag("tunnel");
const bridge = flag("bridge");
const link = flag("link");
const privateAccess = attrIn("access", "private", "no");

const LEVEL_FILTER: Record<Level, Filter> = {
  tunnel,
  ground: all(not(tunnel), not(bridge)),
  bridge: all(bridge, not(tunnel)),
};
/** Tunnels: everything faded. */
const LEVEL_OPACITY: Record<Level, number> = { tunnel: 0.4, ground: 1, bridge: 1 };

function line(
  level: Level,
  name: string,
  filter: Filter,
  layout: Record<string, unknown>,
  paint: Record<string, unknown>,
  minzoom = 11,
): LayerSpecification {
  return {
    id: `transport-${level}-${name}`,
    type: "line",
    source: OSM_SOURCE,
    "source-layer": "transport",
    filter: all(LEVEL_FILTER[level], filter),
    minzoom,
    layout: { "line-join": "round", ...layout },
    paint,
  } as LayerSpecification;
}

// ---------------------------------------------------------------------------------------------
// Roads

interface RoadClass {
  kinds: string[];
  /** Total width in paper mm, casing included. */
  width: number;
  fill: string;
  casing: string;
  rank: number;
}

const ROADS: RoadClass[] = [
  {
    kinds: ["motorway"],
    width: 1.5,
    fill: COLORS.roadMotorway,
    casing: COLORS.roadCasingMajor,
    rank: 9,
  },
  {
    kinds: ["trunk"],
    width: 1.35,
    fill: COLORS.roadTrunk,
    casing: COLORS.roadCasingMajor,
    rank: 8,
  },
  {
    kinds: ["primary"],
    width: 1.2,
    fill: COLORS.roadPrimary,
    casing: COLORS.roadCasingMajor,
    rank: 7,
  },
  {
    kinds: ["secondary"],
    width: 1.05,
    fill: COLORS.roadSecondary,
    casing: COLORS.roadCasing,
    rank: 6,
  },
  {
    kinds: ["tertiary"],
    width: 0.95,
    fill: COLORS.roadTertiary,
    casing: COLORS.roadCasing,
    rank: 5,
  },
  {
    kinds: ["unclassified", "residential", "road"],
    width: 0.75,
    fill: COLORS.roadMinor,
    casing: COLORS.roadCasing,
    rank: 4,
  },
  {
    kinds: ["living_street"],
    width: 0.7,
    fill: COLORS.roadMinor,
    casing: COLORS.roadCasing,
    rank: 3,
  },
  {
    kinds: ["pedestrian"],
    width: 0.65,
    fill: COLORS.roadPedestrian,
    casing: COLORS.roadCasing,
    rank: 2,
  },
  { kinds: ["service"], width: 0.5, fill: COLORS.roadMinor, casing: COLORS.roadCasing, rank: 1 },
];
const ROAD_KINDS = ROADS.flatMap((r) => r.kinds);
const CASING_MM = 0.13;
const BRIDGE_CASING_MM = 0.2;
const LINK_FACTOR = 0.75;

function byRoad<T>(value: (r: RoadClass) => T): ExpressionSpecification {
  return matchAttr(
    "kind",
    ROADS.map((r) => [r.kinds, value(r)]),
    value(ROADS[ROADS.length - 1]!),
  );
}

/** Total road width in mm; links narrower. */
const roadWidth: ExpressionSpecification = [
  "*",
  byRoad((r) => r.width),
  ["case", link, LINK_FACTOR, 1],
];
const roadSort = byRoad((r) => r.rank);
const roadFilter = all(not(isRail), kindIn(...ROAD_KINDS));

function roadLayers(level: Level): LayerSpecification[] {
  const casingExtra = level === "bridge" ? 2 * (BRIDGE_CASING_MM - CASING_MM) : 0;
  return [
    line(
      level,
      "road-casing",
      roadFilter,
      { "line-cap": level === "ground" ? "round" : "butt", "line-sort-key": roadSort },
      {
        "line-color": level === "bridge" ? COLORS.bridgeCasing : byRoad((r) => r.casing),
        "line-width": lineWidth(casingExtra ? ["+", roadWidth, casingExtra] : roadWidth),
        "line-opacity": LEVEL_OPACITY[level],
        ...(level === "tunnel" ? { "line-dasharray": [2.5, 1.5] } : {}),
      },
      8,
    ),
    line(
      level,
      "road-fill",
      roadFilter,
      { "line-cap": "round", "line-sort-key": roadSort },
      {
        "line-color": byRoad((r) => r.fill),
        "line-width": lineWidth(["-", roadWidth, 2 * CASING_MM]),
        "line-opacity": level === "tunnel" ? 0.6 : 1,
      },
      8,
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Tracks (highway=track by tracktype)

const TRACK_MM = 0.35;
const track = all(not(isRail), kindIn("track"));
const trackColor = [
  "case",
  privateAccess,
  COLORS.pathPrivate,
  COLORS.track,
] as ExpressionSpecification;

function trackLayers(level: Level): LayerSpecification[] {
  const opacity = LEVEL_OPACITY[level];
  const grade = (...g: string[]) => all(track, attrIn("tracktype", ...g));
  return [
    // grade1: paved/solid track as a narrow double line (dark edges, white core).
    line(
      level,
      "track-grade1-casing",
      grade("grade1"),
      { "line-cap": "butt" },
      { "line-color": trackColor, "line-width": lineWidth(0.6), "line-opacity": opacity },
    ),
    line(
      level,
      "track-grade1-core",
      grade("grade1"),
      { "line-cap": "butt" },
      { "line-color": COLORS.roadMinor, "line-width": lineWidth(0.3), "line-opacity": opacity },
    ),
    // grade2: solid, a little thinner than the grade1 double line.
    line(
      level,
      "track-grade2",
      grade("grade2"),
      { "line-cap": "butt" },
      { "line-color": trackColor, "line-width": lineWidth(TRACK_MM), "line-opacity": opacity },
    ),
    // grade3 and untagged: long dashes.
    line(
      level,
      "track-grade3",
      all(track, not(attrIn("tracktype", "grade1", "grade2", "grade4", "grade5"))),
      { "line-cap": "butt" },
      {
        "line-color": trackColor,
        "line-width": lineWidth(TRACK_MM),
        "line-dasharray": dashes(TRACK_MM, 2.2, 0.55),
        "line-opacity": opacity,
      },
    ),
    // grade4/5: short dashes.
    line(
      level,
      "track-grade45",
      grade("grade4", "grade5"),
      { "line-cap": "butt" },
      {
        "line-color": trackColor,
        "line-width": lineWidth(0.3),
        "line-dasharray": dashes(0.3, 0.9, 0.5),
        "line-opacity": opacity,
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Paths, footways, bridleways, cycleways, steps

const PATH_KINDS = ["path", "footway", "bridleway", "cycleway"];
const pathLike = all(not(isRail), kindIn(...PATH_KINDS));
const footAllowed = attrIn("foot", "designated", "yes");

/** Cycleway without foot access: violet signature. */
const cycleOnly = all(kindIn("cycleway"), not(footAllowed));
/** Shared foot + cycle path: black path signature on a pale violet underlay. */
const sharedCycle = any(
  all(kindIn("cycleway"), footAllowed),
  all(kindIn("path", "footway"), attrIn("bicycle", "designated"), not(attrIn("foot", "no"))),
);

const ALPINE = ["alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"];
const DEMANDING = ["mountain_hiking", "demanding_mountain_hiking", ...ALPINE];
const faint = attrIn("trail_visibility", "bad", "horrible", "no");
const demanding = attrIn("sac_scale", ...DEMANDING);

const pathColor = cases(
  [
    [privateAccess, COLORS.pathPrivate],
    [attrIn("sac_scale", ...ALPINE), COLORS.pathAlpine],
    [cycleOnly, COLORS.cycleway],
    [kindIn("bridleway"), COLORS.bridleway],
    [faint, COLORS.pathFaint],
  ],
  COLORS.path,
);

/** Width of a standard path signature in paper mm (also the legend symbol). */
export const PATH_MM = 0.25;
/** Dotted signature of sac_scale T2 and above (also the legend symbols). */
export const DOT_MM = 0.34;
export const DOT_PITCH_MM = 0.7;
/** Dash pattern (dash, gap, offset) of a standard path in paper mm. */
export const PATH_DASH_MM = [1.2, 0.45] as const;
const SHARED_UNDERLAY_MM = 0.75;

function pathLayers(level: Level): LayerSpecification[] {
  const opacity = LEVEL_OPACITY[level];
  return [
    line(
      level,
      "path-shared-underlay",
      all(pathLike, sharedCycle),
      { "line-cap": "round" },
      {
        "line-color": COLORS.cycleShared,
        "line-width": lineWidth(SHARED_UNDERLAY_MM),
        "line-opacity": opacity,
      },
    ),
    // Standard path: dashes.
    line(
      level,
      "path",
      all(pathLike, not(faint), not(demanding)),
      { "line-cap": "butt" },
      {
        "line-color": pathColor,
        "line-width": lineWidth(PATH_MM),
        "line-dasharray": dashes(PATH_MM, ...PATH_DASH_MM),
        "line-opacity": opacity,
      },
    ),
    // sac_scale T2 and above: dotted (alpine grades in the warning colour via pathColor).
    line(
      level,
      "path-demanding",
      all(pathLike, not(faint), demanding),
      { "line-cap": "round" },
      {
        "line-color": pathColor,
        "line-width": lineWidth(DOT_MM),
        "line-dasharray": dots(DOT_MM, DOT_PITCH_MM),
        "line-opacity": opacity,
      },
    ),
    // Bad trail visibility: lighter and sparser.
    line(
      level,
      "path-faint",
      all(pathLike, faint),
      { "line-cap": "butt" },
      {
        "line-color": pathColor,
        "line-width": lineWidth(PATH_MM),
        "line-dasharray": dashes(PATH_MM, 0.6, 0.9),
        "line-opacity": opacity,
      },
    ),
    // Steps: dense ticks across the way.
    line(
      level,
      "steps",
      all(not(isRail), kindIn("steps")),
      { "line-cap": "butt" },
      {
        "line-color": ["case", privateAccess, COLORS.pathPrivate, COLORS.path],
        "line-width": lineWidth(0.65),
        "line-dasharray": dashes(0.65, 0.13, 0.2),
        "line-opacity": opacity,
      },
      12,
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Railways

const RAIL_MAIN_MM = 0.6;
const RAIL_MINOR_MM = 0.42;
const mainRail = all(isRail, kindIn("rail"), not(["has", "service"]));
const minorRail = all(
  isRail,
  kindIn("light_rail", "narrow_gauge", "preserved", "funicular", "monorail"),
);
const thinRail = any(
  all(isRail, kindIn("rail"), ["has", "service"]),
  all(isRail, kindIn("tram", "subway")),
);
const disusedRail = all(isRail, kindIn("disused"));

function railLayers(level: Level): LayerSpecification[] {
  const opacity = LEVEL_OPACITY[level];
  const layers: LayerSpecification[] = [
    line(
      level,
      "rail-main",
      mainRail,
      { "line-cap": "butt" },
      {
        "line-color": COLORS.rail,
        "line-width": lineWidth(RAIL_MAIN_MM),
        "line-opacity": opacity,
        ...(level === "tunnel" ? { "line-dasharray": dashes(RAIL_MAIN_MM, 2, 1) } : {}),
      },
      8,
    ),
    line(
      level,
      "rail-minor",
      minorRail,
      { "line-cap": "butt" },
      {
        "line-color": COLORS.rail,
        "line-width": lineWidth(RAIL_MINOR_MM),
        "line-opacity": opacity,
        ...(level === "tunnel" ? { "line-dasharray": dashes(RAIL_MINOR_MM, 1.5, 0.8) } : {}),
      },
      10,
    ),
    line(
      level,
      "rail-thin",
      thinRail,
      { "line-cap": "butt" },
      {
        "line-color": COLORS.railMinor,
        "line-width": lineWidth(0.28),
        "line-opacity": opacity,
        ...(level === "tunnel" ? { "line-dasharray": dashes(0.28, 1.5, 0.8) } : {}),
      },
    ),
    line(
      level,
      "rail-disused",
      disusedRail,
      { "line-cap": "butt" },
      {
        "line-color": COLORS.pathPrivate,
        "line-width": lineWidth(0.3),
        "line-dasharray": dashes(0.3, 1.2, 0.8),
        "line-opacity": opacity,
      },
      12,
    ),
  ];
  if (level !== "tunnel") {
    // Classic "Eisenbahn" signature: white dashes inside the black line.
    layers.push(
      line(
        level,
        "rail-main-dash",
        mainRail,
        { "line-cap": "butt" },
        {
          "line-color": COLORS.railDash,
          "line-width": lineWidth(0.32),
          "line-dasharray": dashes(0.32, 2.5, 2.5),
        },
        11,
      ),
      line(
        level,
        "rail-minor-dash",
        minorRail,
        { "line-cap": "butt" },
        {
          "line-color": COLORS.railDash,
          "line-width": lineWidth(0.2),
          "line-dasharray": dashes(0.2, 1.6, 1.6),
        },
        12,
      ),
    );
  }
  return layers;
}

// ---------------------------------------------------------------------------------------------
// Bridge outlines for everything that is not a road (roads get a black casing instead)

/** Approximate signature width in mm of non-road ways, for the bridge outline. */
const nonRoadWidth = cases(
  [
    [mainRail, RAIL_MAIN_MM],
    [minorRail, RAIL_MINOR_MM],
    [isRail, 0.3],
    [all(kindIn("track"), attrIn("tracktype", "grade1")), 0.6],
    [kindIn("track"), TRACK_MM],
    [kindIn("steps"), 0.65],
  ],
  PATH_MM,
);
const nonRoad = any(isRail, kindIn("track", "steps", ...PATH_KINDS));

function bridgeOutlineLayers(): LayerSpecification[] {
  return [
    line(
      "bridge",
      "outline",
      nonRoad,
      { "line-cap": "butt" },
      { "line-color": COLORS.bridgeCasing, "line-width": lineWidth(["+", nonRoadWidth, 0.55]) },
      12,
    ),
    line(
      "bridge",
      "gap",
      nonRoad,
      { "line-cap": "butt" },
      { "line-color": COLORS.bridgeGap, "line-width": lineWidth(["+", nonRoadWidth, 0.3]) },
      12,
    ),
  ];
}

// ---------------------------------------------------------------------------------------------

function levelLayers(level: Level): LayerSpecification[] {
  return [
    ...(level === "bridge" ? bridgeOutlineLayers() : []),
    ...trackLayers(level),
    ...pathLayers(level),
    ...roadLayers(level),
    ...railLayers(level),
  ];
}

/** No-entry sign repeated along private ways (grey line + sign, also in the legend). */
const NO_ENTRY_SPACING_MM = 25;
function privateSigns(): LayerSpecification {
  return {
    id: "transport-private-no-entry",
    type: "symbol",
    source: OSM_SOURCE,
    "source-layer": "transport",
    filter: all(
      not(isRail),
      privateAccess,
      kindIn("track", "path", "footway", "cycleway", "bridleway", "steps", "service"),
    ),
    minzoom: 12,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": mm(NO_ENTRY_SPACING_MM),
      "icon-image": "poi:no_entry",
      "icon-size": iconSizeByScale,
      "icon-rotation-alignment": "viewport",
      "icon-padding": mm(1),
    },
  } as LayerSpecification;
}

export function transportLayers(): LayerSpecification[] {
  return [
    ...levelLayers("tunnel"),
    ...levelLayers("ground"),
    ...levelLayers("bridge"),
    privateSigns(),
  ];
}

/** Road kinds that get a name label (labels.ts); minor streets only when zoomed in on screen. */
export const NAMED_ROAD_KINDS = ["primary", "secondary", "tertiary"];
export const NAMED_STREET_KINDS = ["unclassified", "residential", "living_street", "pedestrian"];
export { ROAD_KINDS };
