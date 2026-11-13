// Map colours (M2). Own palette: pale open land, green forest as
// the dominant tone, rose settlements with red-brown buildings, cased roads, black way signatures
// and dark-red route bands. All colours live here; builders only reference keys.
export const COLORS = {
  // --- Background and landcover
  paper: "#fcfbf6",
  forest: "#c3dda2",
  forestEdge: "#93b977",
  meadow: "#edf4da",
  farmland: "#f8f5e6",
  orchard: "#dfecc2",
  vineyard: "#ece0e9",
  heath: "#eeebc6",
  scrub: "#d4e5b6",
  wetland: "#d6ebe3",
  wetlandOpen: "#dbeedd", // marsh, reedbed, wet_meadow: greener
  wetlandWooded: "#cfe3df", // bog, swamp, fen: bluer
  bareRock: "#e4e1dc",
  scree: "#ebe8e2",
  quarry: "#dfdad6",
  quarryLine: "#8f8780",
  residential: "#f3e0da",
  commercial: "#e7e0ea",
  industrial: "#e3dce6",

  // --- Protected areas
  protectedNational: "rgba(46, 125, 50, 0.45)",
  protectedReserve: "rgba(56, 142, 60, 0.38)",
  protectedOther: "rgba(76, 160, 80, 0.25)",
  protectedText: "#3c7d3f",

  // --- Water
  water: "#b3d8ef",
  waterIntermittent: "#d8eaf5",
  waterOutline: "#5b9fd0",
  waterway: "#3a8bcc",
  weir: "#24496b",
  waterText: "#1d64a8",

  // --- Terrain lines
  cliff: "#4a423b",
  // Contour lines (M4): opaque browns, index lines darker; the numbers sit on a white halo.
  contour: "#b5845c",
  contourIndex: "#9c6b45",
  contourText: "#8b5d38",

  // --- Buildings
  building: "#cf8b72",
  buildingOutline: "#8e4b37",
  // Buildings inside industrial/commercial areas: the grey-mauve of those areas, but darker.
  buildingIndustrial: "#b8b0bd",
  buildingIndustrialOutline: "#756c7c",

  // --- Roads
  roadCasing: "#4f4640",
  roadCasingMajor: "#7c2e1c",
  bridgeCasing: "#111111",
  roadMotorway: "#e05a3c",
  roadTrunk: "#ec7b40",
  roadPrimary: "#f5a650",
  roadSecondary: "#fbd45e",
  roadTertiary: "#fde99c",
  roadMinor: "#ffffff",
  roadPedestrian: "#efedea",

  // --- Tracks, paths, rail
  track: "#2a2420",
  path: "#1a1a1a",
  pathFaint: "#5c5c5c",
  pathPrivate: "#9b9b9b",
  pathAlpine: "#c2410c",
  cycleway: "#5b3fb0",
  cycleShared: "rgba(110, 80, 200, 0.28)",
  bridleway: "#87562a",
  bridgeGap: "#fcfbf6",
  rail: "#1e1e1e",
  railMinor: "#3a3a3a",
  railDash: "#ffffff",

  // --- Routes
  route: "#be2230",
  // GPX track (M6): magenta, the overprint colour of orienteering maps; distinct from the route
  // red, the cycleway violet, water blue and forest green.
  gpx: "#d4007f",

  // --- Labels
  text: "#1f1f1f",
  textPlace: "#111111",
  textLocality: "#6e5a46",
  textRoad: "#3a3a3a",
  halo: "rgba(255, 255, 255, 0.88)",
  peak: "#2c2219",
  refMotorway: "#2a5ba8",
  refFederal: "#f2c200",
  // Road shields (shields.ts): Autobahn blue / white, Bundesstrasse yellow / black.
  shieldMotorway: "#0b57a4",
  shieldMotorwayRing: "#ffffff",
  shieldMotorwayEdge: "#0a2d59",
  shieldMotorwayText: "#ffffff",
  shieldFederal: "#f7c600",
  shieldFederalRing: "#1a1a1a",
  shieldFederalText: "#111111",
} as const;
