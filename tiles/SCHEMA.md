# capercailye tile schema (0.3.1-m7; M1 base, bus stops removed in M2c)

Produced by `tiles/CapercailyeProfile.java` (Planetiler 0.10.2), zoom 0–14, PMTiles,
`$CAPERCAILYE_DATA/capercailye-<area>.pmtiles`. Rebuild: `tiles/build.sh [input.pbf] [area]`.
This file is the contract for the style (M2).

## Changes (0.3 → 0.3.1, not breaking)

1. **`routes.nets`:** the switch classes of the routes of a segment (`iwn|nwn|rwn|lwn`, deduplicated, in
   this order, joined with `|`; per route its own `network` if iwn/nwn/rwn, everything else including none
   is `lwn`; e.g. `networks="rwn||local"` → `nets="rwn|lwn"`). Always set. The app's network switches
   filter the band by it ("at least one route of the segment lies in a switched-on network") and size it
   by the highest switched-on network. `network` stays as it was.
2. **`hotel` and `toilets` carry `weight`, `tags` and (towns and cities only) `urban=true`**, like
   `restaurant` / `cafe`. The app thins urban restaurants/cafés, toilets and hotels by paper distance, each
   group on its own (see "Urban"). Nothing is thinned in the tiles; merging and `toilets` filtering are
   unchanged (`hotel` is still never merged). `hotel` is now collected in `finish()` like the other
   urban kinds (areas still via `pointOnSurface`, feature ids unchanged).
3. **`toilets`: indoor- or room-mapped toilets and toilets on institution grounds (university, hospital,
   school, …) without any evidence of being public are no longer written** (filter Q, see "Toilets
   filter"). Typical case: one area per WC room and floor on a campus. No new attributes.

## Breaking changes (M2c → 0.3)

1. **`routes`: every route of a segment individually.** No deduplication and no cap of 4 any more. New
   slot-aligned lists `ids` (relation ids) and `networks`; `symbols`, `refs`, `names`, `colours` now
   cover all routes. `count` is gone. `network` (highest network of the segment) is unchanged.
2. **POIs are merged at build time:** similar objects less than 75 m apart become one point with `count`
   (parking, guidepost, wayside_shrine, stone, rock, mast, toilets, fountain); picnic site, barbecue and
   shelter within 75 m become one rest-area point (`bbq=true`). See "Merging" under `poi`.
3. **Unnamed `viewpoint`s are no longer in the tiles** (only named ones).
4. **`restaurant` / `cafe` carry `weight`, `tags` and (towns and cities only) `urban=true`.** Nothing is
   thinned in the tiles; the app thins by paper distance (see "Urban"; since 0.3.1 `hotel` and `toilets`
   too).

## Breaking changes (M0 → M1)

All M0 layer names, attribute names and values still exist with the same meaning. Changed behaviour:

1. **`routes` minzoom 10 → 11.** At z10 there are no route features any more.
2. **Nested-route rules** (see `routes`): a child route with its own, different `osmc:symbol` is no
   longer hidden by a signed ancestor (same network); instead the ancestors with another symbol are
   hidden ("the most specific sign wins"). Within a network rank, routes belonging to a superroute
   are listed before plain local routes (in 0.3 the cap of 4 is gone, the order stays).
3. **`building` is complete at z12–z14:** no building is dropped for size (only degenerate ones
   < 0.05 px). Accepted budget: tiles may be up to ≈ 3 MB each (dense city tiles at z12).

## General rules (read first)

1. **Booleans are only present when true** (`bridge`, `tunnel`, `link`, `rail`, `intermittent`,
   `hiking`). Test with `["has", "bridge"]` or `["==", ["get", "bridge"], true]`, never `== false`.
2. **Every other optional attribute is missing instead of empty** (`name`, `ref`, `ele`, …).
   Exception: the `|`-joined route lists always exist and use empty slots.
3. `ele` is a number in metres rounded to 0.1, only when the tag is parseable.
4. Areas that become points (POIs, some places) yield **one** point on the polygon surface
   (`pointOnSurface`, guaranteed inside). One OSM object never yields two points. A node and a separate
   area for the same thing (e.g. a church node inside a church building polygon that also has
   `amenity=place_of_worship`) are two objects and give two points. Exception since 0.3: a **group** of
   similar OSM objects less than 75 m apart can become one point (merging, see `poi`).

## Zoom and detail

At z12–z14 lines use 0.1 px simplification (tile = 256 px) and no minimum length, so z12 tiles
contain every path, track and stream. Buildings keep anything ≥ 0.05 px at z12–z14 (i.e. all of them); landcover, water and protected areas ≥ 0.5 px (≈ 12 m at z12). Below z12 lines are merged
and simplified more (0.2 px, short lines < 0.5 px dropped), landcover is merged with neighbours.
Points (`poi`, `place`, `peak`) are not thinned by density: everything that passes the tag rules is in
the tile from its minzoom on. Exception (since 0.3): similar `poi` objects less than 75 m apart are merged
into one point (kinds, representative rules and the rest-area ensemble under `poi` / "Merging"). Merging
is done once globally at build time (not per tile), so tile borders do not matter. All point layers use a
64 px buffer.

## Layer overview

| layer | geometry | minzoom | content |
|---|---|---|---|
| `transport` | line | 6–12 | roads, paths, railways |
| `routes` | line | 11 | hiking routes per way segment |
| `landcover` | polygon | 7–11 | forest, open land, settlement areas |
| `protected_area` | polygon | 8 / 10 | national park, nature reserves, other nature protection |
| `water` | polygon | 6 | lakes, ponds, river areas |
| `waterway` | line | 8–12 | rivers, streams, ditches, weirs |
| `cliff` | line | 11 | cliffs, direction preserved |
| `building` | polygon | 12 | buildings |
| `place` | point | 5–12 | settlement and field names |
| `peak` | point | 10 / 12 | peaks and saddles |
| `poi` | point | 12 | all pictogram features (see kind table) |

## `transport` (lines)

| attr | values |
|---|---|
| `kind` | highway: `motorway trunk primary secondary tertiary unclassified residential service living_street pedestrian track path footway steps bridleway cycleway road`; railway: `rail light_rail narrow_gauge subway funicular monorail tram preserved disused` |
| `link` | `true` for `*_link` (kind is the base class, e.g. `primary`) |
| `rail` | `true` for railways |
| `service` | railways only: raw `service` tag (`siding`, `yard`, `spur`, `crossover`, …) |
| `tracktype` | `grade1`…`grade5` (raw); not set on `motorway trunk primary secondary` (incl. links) |
| `sac_scale` | not set on motorway…secondary; raw (`hiking`, `mountain_hiking`, `demanding_mountain_hiking`, `alpine_hiking`, …) |
| `trail_visibility` | not set on motorway…secondary; raw (`excellent`, `good`, `intermediate`, `bad`, `horrible`, `no`) |
| `surface` | raw; not set on `motorway trunk primary secondary` (incl. links) |
| `access` | only `private` or `no`; not set on `motorway trunk primary secondary` (incl. links) |
| `foot`, `bicycle` | only on `path footway cycleway bridleway`, only the values `designated`, `yes`, `no`. Use `bicycle=designated` to tell shared foot/cycle paths (`highway=path` + `bicycle=designated`) from hiking paths |
| `bridge`, `tunnel` | `true` (tunnel also for `covered=yes`) |
| `name`, `ref` | raw |

Minzoom: motorway/trunk 6, primary 8, secondary 9, tertiary 10, unclassified/residential 11,
everything else 12; `*_link` at least 10.
Adjacent ways of the same kind with identical attributes are merged into long lines (`transport` is
line-merged at every zoom); `surface`/`access`/`tracktype`/`sac_scale`/`trail_visibility` are omitted on
motorway/trunk/primary/secondary so that these roads only break at bridges, tunnels, link, name or ref changes. Rail 8 (with `service` 12), light_rail/narrow_gauge/
subway/funicular/monorail 10, tram 11, preserved/disused 12. `highway=* + area=yes` is skipped.
Stations and halts are in `poi`. Bus stops are not in these tiles at all (see the note under `poi`).

## `routes` (lines, minzoom 11)

One feature per way that is a member (directly or via superroutes) of a relation
`type=route|superroute`, `route=hiking|foot`, not `state=proposed`. All routes of the segment are listed
individually. Adjacent segments with identical attributes are merged.

| attr | meaning |
|---|---|
| `ids` | relation ids (decimal) joined with `\|`, one per route |
| `networks` | `network` of each route, lower-cased, joined with `\|`; empty slot if the route has none |
| `symbols` | raw `osmc:symbol` values joined with `\|`; empty slot if the route has none |
| `refs`, `names`, `colours` | `ref`, `name`, `colour` of the same routes, same order, empty slots aligned |
| `network` | highest network on the segment: `iwn` > `nwn` > `rwn` > `lwn`; missing if none of these |
| `nets` | (0.3.1) switch classes of the routes of the segment, deduplicated, in the order `iwn\|nwn\|rwn\|lwn`, joined with `\|`. Per route: its own `network` if `iwn`, `nwn` or `rwn`, everything else (incl. empty slot, `lwn`, `local`, …) is `lwn`. Example: `networks="rwn\|\|local"` → `nets="rwn\|lwn"`. Always set (every segment has at least one route). A pure function of `networks`, so it does not change which segments are merged |

All six lists are always present and slot-aligned (same number of entries, empty slots allowed). There is
no `count`; the number of routes is the number of `ids` entries.

**Nested routes** (two rules, evaluated per way segment; only ancestors in the *same* `network` take part,
ancestors of another network are never touched):

- *B, child hidden:* a route relation C is suppressed if some ancestor relation A (parent,
  grandparent, … via superroutes) has the same `network`, A has its own sign (`osmc:symbol` or `ref`),
  **and** C's `osmc:symbol` is empty or equal to A's. A parent without any sign never hides its children.
- *C, the most specific sign wins:* if an active (not suppressed by B) descendant C of the same network
  has its own, non-empty `osmc:symbol` that differs from the symbol of an ancestor A, then A is
  suppressed on this segment too (C's symbol is the one put up on site). Example E1 near Pforzheim:
  only the child's `black:black::X:white` remains, not its parent `black:black:white_x` and not the
  grandparent `green:blue::E1:yellow`. A child with an empty or equal symbol never triggers C.

Order of the entries in every list: 1. network rank (iwn, nwn, rwn, lwn, other/none),
2. within the same rank, routes **with superroute reference** before those without: a route that is
a `type=superroute` itself, or is member of a superroute / route hierarchy on this way (via the chain of
ancestors; ancestors count even if they are suppressed). `type=network` relations are not route
relations here (they are not read at all) and therefore do not count. 3. `ref`, 4. symbol,
5. relation id. Routes without `network` therefore always come after all routes with a network of
rank iwn…lwn, even if they belong to a superroute.
There is **no deduplication and no cap**: every active route of the segment is listed, in the order above
(routes with the same symbol appear several times, one entry per relation). A literal `|` inside a tag
value is replaced by `/`. `network` is lower-cased.

Because `ids` identifies the route set, line merging only joins neighbouring segments with the **same set
of routes in the same order**. A fork (or any change of the route set) is therefore exactly where
the `ids` value changes between two features.

Example: `ids="1234|5678|9012"`, `networks="nwn|nwn|lwn"`,
`symbols="blue:blue:shell_modern|green:blue::DZW|yellow:white:yellow_pointer"`, `refs="JW||"`,
`network="nwn"`.

## `landcover` (polygons)

| `kind` | source | minzoom |
|---|---|---|
| `forest` | `landuse=forest`, `natural=wood` | 7 |
| `residential` | `landuse=residential` | 8 |
| `commercial` | `landuse=commercial\|retail` | 10 |
| `industrial` | `landuse=industrial` | 10 |
| `meadow` | `landuse=meadow`, `natural=grassland` (z10); `landuse=grass\|village_green` (z11) | 10/11 |
| `farmland` | `landuse=farmland` | 10 |
| `orchard` | `landuse=orchard` | 10 |
| `vineyard` | `landuse=vineyard` | 10 |
| `heath` | `natural=heath` | 10 |
| `scrub` | `natural=scrub` | 10 |
| `wetland` | `natural=wetland`; attr `wetland` = raw subtype (`marsh`, `bog`, `swamp`, `reedbed`, `wet_meadow`, …) if tagged | 10 |
| `bare_rock` | `natural=bare_rock` | 10 |
| `scree` | `natural=scree` | 10 |
| `quarry` | `landuse=quarry` | 10 |

`landuse` is checked before `natural`. Polygons may overlap (e.g. wetland inside forest).

## `protected_area` (polygons)

Closed ways and multipolygon/boundary relations with `boundary=protected_area`,
`boundary=national_park` or `leisure=nature_reserve`. Draw the outline with a line layer on this
polygon source; the fill can be omitted.

| attr | values |
|---|---|
| `kind` | `national_park` (`boundary=national_park` or `protect_class=2`, minzoom 8); `nature_reserve` (`leisure=nature_reserve` or `protect_class=1a\|1b\|4`, i.e. NSG); `protected_area` (other nature classes, e.g. 5 = Landschaftsschutzgebiet / Naturpark, 7 = Naturdenkmal, 97–99 = international/biosphere). minzoom 10 |
| `name` | raw |
| `protect_class` | raw, if tagged |

`boundary=protected_area` with a non-nature class (11–29: water protection, heritage, …) is skipped.

## `water` (polygons, minzoom 6)

`natural=water`, `landuse=reservoir|basin`, `waterway=riverbank|dock`. Attrs: `name`,
`intermittent` (`true` for `intermittent=yes`).

## `waterway` (lines)

| attr | values |
|---|---|
| `kind` | `river` (z8), `canal` (z9), `stream` (z11), `ditch`, `drain`, `weir` (z12; `weir` = weir mapped as a line across the river) |
| `name` | raw |
| `tunnel` | `true` (also `covered=yes`) |
| `intermittent` | `true` for `intermittent=yes` |

Weirs and waterfalls mapped as nodes are in `poi`.

## `cliff` (lines, minzoom 11)

`natural=cliff` ways (also closed ones). Attrs: `kind=cliff`, `name`. **Direction is preserved**: OSM
draws cliffs with the lower side on the right of the way direction, so put the hachures/teeth on the
right side (`line-pattern`/`symbol` along the line, or offset). Segments are never merged (merging can
reverse lines).

## `building` (polygons, minzoom 12)

| attr | values |
|---|---|
| `industrial` | `true` if the building's interior point lies inside a `landcover` polygon of kind `industrial` or `commercial` (i.e. `landuse=industrial`, `commercial` or `retail`); missing otherwise |

Every building is kept at z12–z14; dense city tiles may reach ≈ 3 MB (accepted budget). `industrial` is
computed per tile against the `landcover` polygons of the same tile (buildings are only at z12–z14, where
landcover is unmerged and complete). Style hint: `["has", "industrial"]`. There is no `power` layer
(power lines are deliberately not part of the map); `power=generator` + wind still yields the POI `wind_turbine`.

## `place` (points)

| `kind` | minzoom |
|---|---|
| `city` | 5 |
| `town` | 8 |
| `village` | 10 |
| `hamlet`, `isolated_dwelling`, `farm`, `locality` (Flur-/Gewannnamen) | 12 |

Attrs: `name` (always present), `population` (integer, if parseable). From nodes; `isolated_dwelling`,
`farm` and `locality` also from areas (one point on the surface).

## `peak` (points)

`kind`: `peak` | `saddle`. Named from z10, unnamed from z12. Attrs: `name`, `ele`.
Features are sorted by `ele` descending.

## `poi` (points, minzoom 12)

One point per OSM node, closed way or multipolygon that matches the table below. If an object
matches several rows, the one with the **lowest rank** wins (e.g. `man_made=tower` +
`tower:type=observation` + `tourism=viewpoint` → `viewtower`; `tourism=hotel` + `amenity=restaurant`
→ `restaurant`). Within a tile features are ordered by rank, named before unnamed.

Common attrs: `kind`, `rank` (integer, lower = more important; use as `symbol-sort-key`), `name`,
`ele`. Extra attrs per kind are listed in the table. Since 0.3 one point can stand for several OSM
objects (merging, below).

`rank` tiers: **10** landmarks that structure a hike · **20** shelters, views, churches, natural
features · **30** food, water, guideposts, parking · **40** comfort and minor landmarks ·
**50** small orientation points.

| kind | rank | OSM source | extra attrs / notes |
|---|---|---|---|
| `railway_station` | 10 | `railway=station` | `station` (raw, e.g. `light_rail`, `subway`) |
| `viewtower` | 10 | `man_made=tower` + `tower:type=observation` | |
| `alpine_hut` | 10 | `tourism=alpine_hut` | |
| `castle` | 10 | `historic=castle` | |
| `castle_ruins` | 10 | `historic=castle` + `ruins=yes`, or `historic=ruins` + `ruins=castle` | |
| `wilderness_hut` | 20 | `tourism=wilderness_hut` | |
| `shelter` | 20 | `amenity=shelter` (not `shelter_type=public_transport\|field_shelter`) | `shelter_type` (raw: `weather_shelter`, `picnic_shelter`, `basic_hut`, `lean_to`, …); `count`, `bbq` (rest area, see Merging) |
| `viewpoint` | 20 | `tourism=viewpoint`, **only with `name`** (unnamed ones are dropped; an object that also matches another POI row falls back to that row) | |
| `railway_halt` | 20 | `railway=halt` | `station` |
| `waterfall` | 20 | `waterway=waterfall` (nodes only) | |
| `cave_entrance` | 20 | `natural=cave_entrance` | |
| `ruins` | 20 | `historic=ruins` (not castle ruins) | |
| `church` | 20 | `amenity=place_of_worship`, `religion=christian` or no religion, not a chapel | `religion` |
| `chapel` | 20 | `amenity=place_of_worship` + (`building=chapel` or `place_of_worship=chapel`); also `building=chapel` without amenity | `religion` |
| `camp_site` | 20 | `tourism=camp_site` | |
| `hostel` | 20 | `tourism=hostel` | |
| `restaurant` | 30 | `amenity=restaurant\|pub\|biergarten` | `weight`, `tags` (always), `urban` (towns/cities only), see Urban |
| `cafe` | 30 | `amenity=cafe` | `weight`, `tags` (always), `urban` (towns/cities only), see Urban |
| `spring` | 30 | `natural=spring` | `drinking_water` (raw, e.g. `yes`, `no`) |
| `drinking_water` | 30 | `amenity=drinking_water` | |
| `guidepost` | 30 | `information=guidepost` (with `tourism=information` or no `tourism`) | `count` (merged); names are signpost location names, label them |
| `parking` | 30 | `amenity=parking`, not `access=private\|no`, not `parking=underground\|street_side\|lane\|on_kerb\|half_on_kerb` | `access` (raw), `hiking` (`true` for `hiking=yes`; for a merged point `true` if **any** member has `hiking=yes` or a name containing `wanderparkplatz`), `area_m2` (integer, areas only; missing for nodes; of the representative), `count` (merged) |
| `monument` | 30 | `historic=monument` | |
| `picnic_site` | 40 | `tourism=picnic_site` | `count`, `bbq` (rest area, see Merging) |
| `bbq` | 40 | `amenity=bbq`, `leisure=firepit` | `count` (only when no shelter/picnic site within 75 m) |
| `hotel` | 40 | `tourism=hotel\|guest_house` | `weight`, `tags` (always), `urban` (towns/cities only), see Urban |
| `caravan_site` | 40 | `tourism=caravan_site` | |
| `toilets` | 40 | `amenity=toilets`, only if `access` is missing or `yes\|public` (all other values dropped: `customers`, `permit`, `permissive`, `private`, `no`, …), and not dropped by filter Q (indoor / room-mapped / institution-ground toilets without evidence of being public, see "Toilets filter") | `count` (merged); `weight`, `tags` (always, of the representative), `urban` (towns/cities only, tested at the representative's position after merging), see Urban |
| `fountain` | 40 | `amenity=fountain` | `drinking_water`, `count` (merged) |
| `memorial` | 40 | `historic=memorial`, not `memorial=stolperstein\|plaque\|blue_plaque` | |
| `communication_tower` | 40 | `man_made=communications_tower`, `man_made=tower` + `tower:type=communication` | |
| `tower` | 40 | other `man_made=tower` (not `tower:type=bell_tower`) | `tower_type` (raw `tower:type`) |
| `place_of_worship` | 40 | `amenity=place_of_worship` of a non-christian religion | `religion` |
| `wayside_cross` | 50 | `historic=wayside_cross` | |
| `wayside_shrine` | 50 | `historic=wayside_shrine` | `count` (merged, e.g. stations of the cross) |
| `rock` | 50 | `natural=rock` | `count` (merged) |
| `stone` | 50 | `natural=stone` | `count` (merged) |
| `sinkhole` | 50 | `natural=sinkhole` | |
| `mast` | 50 | `man_made=mast` | `count` (merged) |
| `wind_turbine` | 50 | `power=generator` + `generator:source=wind` | |
| `weir` | 50 | `waterway=weir` (nodes only; lines are in `waterway`) | |

Peaks and saddles are not in `poi` but in `peak`.

### Toilets filter (since 0.3.1)

Goal: the print shows publicly accessible toilets from outside, not the WC rooms of campuses, hospitals or
shopping centres. Filter Q applies to toilets that passed the `access` rule (missing, `yes` or `public`). A
toilet is **dropped** if all three conditions hold:

1. **No evidence of being public:** none of the tags `name`, `opening_hours`, `operator`, `brand`, `charge`,
   `centralkey`, `website`, `description` is present, and no key starts with `payment:`.
2. **No protecting surroundings:** the toilet point lies in none of `building=train_station|transportation|kiosk|toilets`,
   `leisure=park|garden`, `tourism=information|zoo|museum` (areas only; the toilet's own area never counts).
3. **At least one of:**
   - (a) **room mapping:** `indoor=room|area`; or `repeat_on` present; or the object is an area (not a node)
     with `ref`, without `name` and without `building`. Dropped even with `access=yes`.
   - (b) **indoor position or institution grounds, and `access` is not `yes`:** `indoor` present and not `no`;
     or `level` present and "not 0" (split at `;` and `,`, every part a number other than 0; unparseable
     values such as `1-4` count as not 0; `0`, `0.0`, `0;1` do not); or the point lies in
     `amenity=university|college|hospital|school|kindergarten|clinic|research_institute|prison`,
     `landuse=education`, `healthcare=hospital` or `building=university|college|hospital|school|kindergarten`.

Other buildings never count as surroundings. Order in the build: **filter Q → merge (75 m) → urban test.**
Q runs on the single candidates before grouping, so a room record cannot become the representative of a
merged point and hide a public toilet. No tile attribute is added; the build log has a `toilets filter Q`
line with the counts.

### Merging (since 0.3)

Similar `poi` objects less than **75 m** apart become one point (`CLUSTER_RADIUS_M`), computed once over the
whole input after reading it (so tile borders do not split a group). Merged: `parking`, `guidepost`,
`wayside_shrine`, `stone`, `rock`, `mast`, `toilets`, `fountain` (each kind on its own), plus the rest-area
ensemble `shelter` + `picnic_site` + `bbq` (one common group). Everything else is never merged
(`wayside_cross`, `church`, `chapel`, `spring`, `castle`, `railway_*`, `camp_site`, `wind_turbine`,
`communication_tower`, `viewpoint`, `hotel`, `restaurant`, `cafe`, …; `hotel` in particular is never merged).

- **Greedy leader, no chains:** candidates are ordered by priority; the best unassigned one becomes the
  representative and takes every unassigned candidate of its group within 75 m **of itself**. The
  representative keeps its own position (no centroid), its attributes and its feature id.
- **Priority:** named before unnamed, then more OSM tags, then lower id. `parking`: larger `area_m2`
  first (nodes count as 0), then the same. Rest area: kind order `shelter` < `picnic_site` < `bbq`
  first, then the same.
- **`count`** = number of merged objects including the representative; **missing when 1**.
- **Rest area:** the representative keeps its kind (shelter wins, else picnic site, else barbecue).
  If it is a `shelter` or `picnic_site` and any member is a `bbq`, it gets `bbq=true`. `count` counts all
  members of any kind.
- **`parking`:** parkings with `access` in `customers`, `permit`, `residents`, `delivery`, `agricultural`,
  `forestry`, `destination` (hidden by the style anyway) are never merged and written individually.
  The merged point gets `hiking=true` if any member (of at least two) has `hiking=yes` or a name containing
  `wanderparkplatz` (case-insensitive); `area_m2` is the representative's.

Feature ids: a merged point carries the id of its representative (`osm id * 10 + 1|2|3` for node, way,
relation, Planetiler's own encoding), so the tile-buffer duplicates of one point still share one id.

### Urban (towns and cities)

`restaurant`, `cafe`, `hotel` and `toilets` carry `urban=true` (missing otherwise) if they lie in a larger
place. The tiles do not thin anything; the app thins urban items by paper distance using `weight` (higher
wins) and `tags` (tie-breaker), in three groups that never affect each other: gastro (`restaurant` +
`cafe` together), `toilets`, `hotel`. Villages, hamlets and the countryside are never thinned.
`toilets` are merged first (75 m, see Merging); the urban test then runs at the position of the
**representative** of the merged point, and `weight` / `tags` are the representative's.

`weight` (integer, always set), `tags` (integer, always set: number of OSM tags of the object):

- `restaurant`, `cafe`: `amenity=biergarten` +3; `restaurant` or `pub` +1; `cafe` 0;
  `wikidata` or `wikipedia` +2; `outdoor_seating=yes` +1; `website` or `contact:website` +1;
  `opening_hours` +1; `brand` −3.
- `toilets`: `wheelchair=yes` +1; `fee=no` +1; `opening_hours` +1; `changing_table=yes` +1; otherwise 0.
- `hotel`: `tourism=hotel` +1 (`guest_house` 0); `stars` starting with a digit ≥ 3 +1;
  `wikidata` or `wikipedia` +2; `website` or `contact:website` +1; `brand` −3.

Definition of `urban` (administrative boundaries are deliberately **not** used; cities often contain
independent villages):

1. *Settlement polygons:* `landuse=residential|commercial|retail` areas (not industrial). Polygons
   less than 60 m apart form one **settlement area** (bridges streets, parks, rails).
2. *Place nodes:* named nodes with `place=city|town|village|hamlet`. Each is assigned to the settlement
   area of the nearest polygon within 100 m; without a polygon in 100 m it is ignored.
3. A settlement area is *urban* if at least one `town` or `city` node is assigned to it.
4. A restaurant/café/hotel/toilet is `urban` if the nearest settlement polygon within 60 m belongs to an urban
   area **and** the place node of this area with the smallest weighted distance (metres / weight; city 5,
   town 3, village 1, hamlet 0.5) is a `town` or `city`. So a village grown together with a town keeps a
   zone around its node where nothing is thinned. Doubtful cases are not urban (everything is shown).


**Bus stops are not in `poi`:** `highway=bus_stop` was mapped up to M1 and was removed in M2c
(`public_transport=platform` was never mapped). Bus stops come from the GTFS timetable data instead
(SPEC.md 5) as a separate small file `capercailye-busstops.pmtiles` (layer `bus_stop`, points,
z10–z14, attrs `name`, `sat`, `sun`, `min`; built by `transit/`), not by this profile.
Railway stations and halts (`railway=station|halt`) stay in `poi`.

### Densities (BW, z12, build 0.3.0-m7 of 2026-11-14)

Counted with GDAL from the z12 tiles (points inside the tile extent, merged points counted once). One A4
sheet at 1:25,000 covers ≈ 34 km², BW ≈ 35,750 km², so "per sheet" = count / 1050.
Before merging (M1 build, 2026-11-13): parking 70,428, guidepost 52,157, fountain 7,048, shelter 6,616,
wayside_shrine 6,066, viewpoint 5,477, mast 4,962, picnic_site 4,556, toilets 4,822, bbq 3,117,
stone 1,059, rock 746.

| kind | BW | per sheet | | kind | BW | per sheet |
|---|---|---|---|---|---|---|
| parking | 56,506 | 53.8 | | wind_turbine | 956 | 0.9 |
| guidepost | 41,035 | 39.1 | | communication_tower | 955 | 0.9 |
| restaurant | 19,190 | 18.3 | | railway_halt | 917 | 0.9 |
| wayside_cross | 13,905 | 13.2 | | ruins | 738 | 0.7 |
| church | 8,259 | 7.9 | | caravan_site | 716 | 0.7 |
| shelter | 6,312 | 6.0 | | castle | 673 | 0.6 |
| fountain | 6,014 | 5.7 | | railway_station | 560 | 0.5 |
| memorial | 5,374 | 5.1 | | rock | 547 | 0.5 |
| cafe | 4,505 | 4.3 | | camp_site | 511 | 0.5 |
| hotel | 4,266 | 4.1 | | cave_entrance | 493 | 0.5 |
| wayside_shrine | 4,011 | 3.8 | | waterfall | 452 | 0.4 |
| mast | 3,673 | 3.5 | | castle_ruins | 445 | 0.4 |
| toilets | 3,133 | 3.0 | | stone | 410 | 0.4 |
| picnic_site | 3,129 | 3.0 | | viewtower | 318 | 0.3 |
| chapel | 3,094 | 2.9 | | place_of_worship | 312 | 0.3 |
| spring | 2,837 | 2.7 | | hostel | 269 | 0.3 |
| drinking_water | 2,348 | 2.2 | | sinkhole | 233 | 0.2 |
| viewpoint | 1,636 | 1.6 | | monument | 160 | 0.2 |
| tower | 1,380 | 1.3 | | wilderness_hut | 73 | 0.1 |
| bbq | 1,281 | 1.2 | | alpine_hut | 61 | 0.1 |
| weir | 1,176 | 1.1 | |  |  |  |

Merging cut `stone` by ≈ 61 %, `wayside_shrine` by ≈ 34 %, `bbq` by ≈ 59 % (rest areas), `picnic_site`
by ≈ 31 %, `rock` ≈ 27 %, `mast` ≈ 26 %, `guidepost` ≈ 21 %, `parking` ≈ 20 % (16,000 parkings with
customer/permit/… access are written unmerged), `toilets` ≈ 20 %, `fountain` ≈ 15 %. `viewpoint` fell from
5,477 to 1,636 (named only); 4 towers and 3 wayside crosses reappear because their unnamed
`tourism=viewpoint` tag no longer wins.

Still too dense to show everything unfiltered at 1:25,000 (style must filter or rely on the app's
placement): `parking` (filter by `hiking`, `area_m2`, name), unnamed `guidepost`, `restaurant`/`cafe` in towns
(thinned in the app via `urban` and `weight`), `hotel`, `mast` (mostly mobile-phone masts in towns),
`memorial`.
