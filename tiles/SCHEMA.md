# capercailye tile schema (M1, bus stops removed in M2c)

Produced by `tiles/CapercailyeProfile.java` (Planetiler 0.10.2), zoom 0–14, PMTiles,
`$CAPERCAILYE_DATA/capercailye-<area>.pmtiles`. Rebuild: `tiles/build.sh [input.pbf] [area]`.
This file is the contract for the style (M2).

## Breaking changes (M0 → M1)

All M0 layer names, attribute names and values still exist with the same meaning. Changed behaviour:

1. **`routes` minzoom 10 → 11.** At z10 there are no route features any more.
2. **Nested-route rules** (see `routes`): a child route with its own, different `osmc:symbol` is no
   longer hidden by a signed ancestor (same network); instead the ancestors with another symbol are
   hidden ("the most specific sign wins"). Within a network rank, routes belonging to a superroute
   are listed before plain local routes, so the cap of 4 keeps the main trails.
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
   `amenity=place_of_worship`) are two objects and give two points.

## Zoom and detail

At z12–z14 lines use 0.1 px simplification (tile = 256 px) and no minimum length, so z12 tiles
contain every path, track and stream. Buildings keep anything ≥ 0.05 px at z12–z14 (i.e. all of them); landcover, water and protected areas ≥ 0.5 px (≈ 12 m at z12). Below z12 lines are merged
and simplified more (0.2 px, short lines < 0.5 px dropped), landcover is merged with neighbours.
Points (`poi`, `place`, `peak`) are never thinned by density: everything that passes the tag rules is in
the tile from its minzoom on. All point layers use a 64 px buffer.

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
`type=route|superroute`, `route=hiking|foot`, not `state=proposed`. Adjacent segments with
identical attributes are merged.

| attr | meaning |
|---|---|
| `symbols` | raw `osmc:symbol` values joined with `\|`; empty slot if the route has none |
| `refs`, `names`, `colours` | `ref`, `name`, `colour` of the same routes, same order, empty slots aligned |
| `network` | highest network on the segment: `iwn` > `nwn` > `rwn` > `lwn`; missing if none of these |
| `count` | number of (non-suppressed) routes on the segment, before deduplication and capping |

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

Order (this decides which signs survive the cap): 1. network rank (iwn, nwn, rwn, lwn, other/none),
2. within the same rank, routes **with superroute reference** before those without: a route that is
a `type=superroute` itself, or is member of a superroute / route hierarchy on this way (via the chain of
ancestors; ancestors count even if they are suppressed). `type=network` relations are not route
relations here (they are not read at all) and therefore do not count. 3. `ref`, 4. symbol,
5. relation id. Routes without `network` therefore always come after all routes with a network of
rank iwn…lwn, even if they belong to a superroute.
Deduplication: routes with the same non-empty symbol appear once (first wins); routes without
symbol are deduplicated by `ref`+`name`. At most 4 entries (the first 4 after ordering and
deduplication). A literal `|` inside a tag value is replaced by `/`. `network` is lower-cased.

Example: `symbols="blue:blue:shell_modern|green:blue::DZW|yellow:white:yellow_pointer"`,
`refs="JW||"`, `network="nwn"`, `count=3`.

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
`ele`. Extra attrs per kind are listed in the table.

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
| `shelter` | 20 | `amenity=shelter` (not `shelter_type=public_transport\|field_shelter`) | `shelter_type` (raw: `weather_shelter`, `picnic_shelter`, `basic_hut`, `lean_to`, …) |
| `viewpoint` | 20 | `tourism=viewpoint` | |
| `railway_halt` | 20 | `railway=halt` | `station` |
| `waterfall` | 20 | `waterway=waterfall` (nodes only) | |
| `cave_entrance` | 20 | `natural=cave_entrance` | |
| `ruins` | 20 | `historic=ruins` (not castle ruins) | |
| `church` | 20 | `amenity=place_of_worship`, `religion=christian` or no religion, not a chapel | `religion` |
| `chapel` | 20 | `amenity=place_of_worship` + (`building=chapel` or `place_of_worship=chapel`); also `building=chapel` without amenity | `religion` |
| `camp_site` | 20 | `tourism=camp_site` | |
| `hostel` | 20 | `tourism=hostel` | |
| `restaurant` | 30 | `amenity=restaurant\|pub\|biergarten` | |
| `cafe` | 30 | `amenity=cafe` | |
| `spring` | 30 | `natural=spring` | `drinking_water` (raw, e.g. `yes`, `no`) |
| `drinking_water` | 30 | `amenity=drinking_water` | |
| `guidepost` | 30 | `information=guidepost` (with `tourism=information` or no `tourism`) | names are signpost location names, label them |
| `parking` | 30 | `amenity=parking`, not `access=private\|no`, not `parking=underground\|street_side\|lane\|on_kerb\|half_on_kerb` | `access` (raw), `hiking` (`true` for `hiking=yes`), `area_m2` (integer, areas only; missing for nodes) |
| `monument` | 30 | `historic=monument` | |
| `picnic_site` | 40 | `tourism=picnic_site` | |
| `bbq` | 40 | `amenity=bbq`, `leisure=firepit` | |
| `hotel` | 40 | `tourism=hotel\|guest_house` | |
| `caravan_site` | 40 | `tourism=caravan_site` | |
| `toilets` | 40 | `amenity=toilets`, not `access=private\|no` | |
| `fountain` | 40 | `amenity=fountain` | `drinking_water` |
| `memorial` | 40 | `historic=memorial`, not `memorial=stolperstein\|plaque\|blue_plaque` | |
| `communication_tower` | 40 | `man_made=communications_tower`, `man_made=tower` + `tower:type=communication` | |
| `tower` | 40 | other `man_made=tower` (not `tower:type=bell_tower`) | `tower_type` (raw `tower:type`) |
| `place_of_worship` | 40 | `amenity=place_of_worship` of a non-christian religion | `religion` |
| `wayside_cross` | 50 | `historic=wayside_cross` | |
| `wayside_shrine` | 50 | `historic=wayside_shrine` | |
| `rock` | 50 | `natural=rock` | |
| `stone` | 50 | `natural=stone` | |
| `sinkhole` | 50 | `natural=sinkhole` | |
| `mast` | 50 | `man_made=mast` | |
| `wind_turbine` | 50 | `power=generator` + `generator:source=wind` | |
| `weir` | 50 | `waterway=weir` (nodes only; lines are in `waterway`) | |

Peaks and saddles are not in `poi` but in `peak`.

**Bus stops are not in `poi`:** `highway=bus_stop` was mapped up to M1 and was removed in M2c
(`public_transport=platform` was never mapped). Bus stops come from the GTFS timetable data instead
(PLAN.md 4c) as a separate small file `capercailye-busstops.pmtiles` (layer `bus_stop`, points,
z10–z14, attrs `name`, `sat`, `sun`, `min`; built by `transit/`), not by this profile.
Railway stations and halts (`railway=station|halt`) stay in `poi`.

### Densities (BW, z12, M1 build of 2026-11-13)

Counted from the z12 tiles (point inside tile extent). One A4 sheet at 1:25,000 covers ≈ 34 km²,
BW ≈ 35,750 km², so "per sheet" = count / 1050.

| kind | BW | per sheet | | kind | BW | per sheet |
|---|---|---|---|---|---|---|
| parking | 70,428 | 67 | | spring | 2,835 | 2.7 |
| guidepost | 52,157 (22,061 named) | 50 | | drinking_water | 2,347 | 2.2 |
| restaurant | 19,180 | 18 | | tower | 1,375 | 1.3 |
| wayside_cross | 13,895 | 13 | | weir | 1,174 | 1.1 |
| church | 8,256 | 7.9 | | stone | 1,059 | 1.0 |
| fountain | 7,048 | 6.7 | | wind_turbine | 956 | 0.9 |
| shelter | 6,616 | 6.3 | | communication_tower | 955 | 0.9 |
| wayside_shrine | 6,066 | 5.8 | | railway_halt | 917 | 0.9 |
| viewpoint | 5,477 | 5.2 | | rock | 746 | 0.7 |
| memorial | 5,369 | 5.1 | | ruins | 736 | 0.7 |
| mast | 4,962 | 4.7 | | caravan_site | 716 | 0.7 |
| toilets | 4,822 | 4.6 | | castle | 672 | 0.6 |
| picnic_site | 4,556 | 4.3 | | railway_station | 560 | 0.5 |
| cafe | 4,503 | 4.3 | | camp_site | 511 | 0.5 |
| hotel | 4,265 | 4.1 | | cave_entrance | 493 | 0.5 |
| bbq | 3,117 | 3.0 | | waterfall | 451 | 0.4 |
| chapel | 3,093 | 2.9 | | castle_ruins | 445 | 0.4 |
|  |  |  | | viewtower | 318 | 0.3 |
|  |  |  | | place_of_worship | 312 | 0.3 |
|  |  |  | | hostel | 269 | 0.3 |
|  |  |  | | sinkhole | 233 | 0.2 |
|  |  |  | | monument | 160 | 0.2 |
|  |  |  | | wilderness_hut | 73 | 0.1 |
|  |  |  | | alpine_hut | 61 | 0.1 |

Too dense to show unfiltered at 1:25,000 (style must filter or rely on collision): `parking` (filter
by `hiking`, `area_m2`, name), unnamed `guidepost`, `restaurant`/`cafe`/`hotel` in towns,
`mast` (mostly mobile-phone masts in towns), `fountain`, `memorial`, `toilets`.
