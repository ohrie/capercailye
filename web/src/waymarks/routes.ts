// Routes of a `routes` tile feature and which routes show signs. Pure.
//
// The tiles (tiles/SCHEMA.md) list every route of a way segment individually in slot-aligned
// |-joined lists (`ids`, `networks`, `symbols`, `refs`, `names`, `colours`). Waymarks belong to the
// routes (PLAN.md 4a): a route shows its sign exactly if the group "Wanderrouten" is on AND the
// switch of its OWN network is on (iwn -> net-iwn, nwn -> net-nwn, rwn -> net-rwn, everything else
// incl. no network -> net-lwn); missing switches count as on. The band (style/routes.ts) uses the
// same rule per segment through the tile attribute `nets` (the same mapping per route, built by the
// profile): a segment gets a band if at least one of its routes is visible, so a sign never sits on
// a band that is not drawn.

export interface RouteInfo {
  /** Relation id. */
  id: string;
  /** Own network of the route (lower-case), empty if it has none. */
  network: string;
  osmc?: string;
  ref?: string;
  colour?: string;
  name?: string;
}

/**
 * Network switch group of a route network (iwn/nwn/rwn own, everything else including none and
 * unknown values net-lwn). Must be exactly the mapping of the profile attribute `nets`
 * (tiles/CapercailyeProfile.java `netSwitches`); the band filter in style/routes.ts relies on it.
 */
export function networkGroup(network: string): "net-iwn" | "net-nwn" | "net-rwn" | "net-lwn" {
  switch (network) {
    case "iwn":
      return "net-iwn";
    case "nwn":
      return "net-nwn";
    case "rwn":
      return "net-rwn";
    default:
      return "net-lwn";
  }
}

/** Whether the group "Wanderrouten" is on (missing counts as on). */
export function routesOn(visibility: Readonly<Record<string, boolean>>): boolean {
  return visibility["routes"] !== false;
}

/**
 * Whether a route shows its sign: "Wanderrouten" is on and the switch of the route's own network
 * is on (missing switches count as on).
 */
export function routeVisible(r: RouteInfo, visibility: Readonly<Record<string, boolean>>): boolean {
  return routesOn(visibility) && visibility[networkGroup(r.network)] !== false;
}

function slots(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  return String(v).split("|");
}

/** Splits the |-lists of a routes feature into RouteInfo (slot-aligned; empty slots → undefined). */
export function routesFromProperties(p: Record<string, unknown>): RouteInfo[] {
  const ids = slots(p["ids"]);
  const networks = slots(p["networks"]);
  const symbols = slots(p["symbols"]);
  const refs = slots(p["refs"]);
  const colours = slots(p["colours"]);
  const names = slots(p["names"]);
  const out: RouteInfo[] = [];
  ids.forEach((raw, i) => {
    const id = raw.trim();
    if (!id) return;
    const r: RouteInfo = { id, network: (networks[i] ?? "").trim().toLowerCase() };
    const field = (list: string[]): string | undefined => {
      const v = list[i]?.trim();
      return v ? v : undefined;
    };
    const osmc = field(symbols);
    const ref = field(refs);
    const colour = field(colours);
    const name = field(names);
    if (osmc) r.osmc = osmc;
    if (ref) r.ref = ref;
    if (colour) r.colour = colour;
    if (name) r.name = name;
    out.push(r);
  });
  return out;
}
