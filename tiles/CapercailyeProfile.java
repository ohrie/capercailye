/*
 * capercailye – Planetiler profile for a printable 1:25,000 hiking map.
 * SPDX-License-Identifier: MIT
 *
 * WHAT IT DOES
 *   Turns an OpenStreetMap extract (.osm.pbf) into vector tiles (PMTiles, zoom 0–14) that a MapLibre
 *   style renders as a hiking map. The layers and attributes produced are the contract with the style:
 *   see SCHEMA.md.
 *
 * RUN (single file, no Maven; planetiler.jar supplies the classpath)
 *   java -cp planetiler.jar CapercailyeProfile.java --input=bw.osm.pbf --output=out.pmtiles
 *   Normally via tiles/build.sh, which downloads the jar and sets the standard flags.
 *
 * PIPELINE (order of the code below)
 *   1. Tables       Tag → kind / minzoom (roads, rails, waterways, places) and the POI table
 *                   (key=value → kind + rank; lower rank = more important for hikers).
 *   2. Routes       preprocessOsmRelation collects hiking route relations first, so each way segment
 *                   later knows which routes (symbol, network, ref, colour) run along it.
 *   3. Features     processFeature maps every OSM object to a layer: transport, routes, landcover,
 *                   water, waterway, cliff, protected_area, building, place, peak, poi.
 *   4. POI cleanup  finish() runs once after all features: filters toilets (public only), merges
 *                   similar POIs closer than 75 m into one point, flags urban ones. Needs the whole
 *                   dataset at once, so it cannot happen per feature.
 *   5. Per tile     postProcessLayerFeatures merges line segments with identical attributes;
 *                   postProcessTileFeatures marks industrial buildings from the landcover of the tile.
 *
 * DESIGN DECISIONS
 *   - Print quality: from zoom 12 (PRINT_ZOOM) on, almost nothing is simplified or dropped; below it,
 *     lines are merged and thinned. Tiles at z12 may be large (up to a few MB in cities).
 *   - Points are not thinned by density in the tiles; the app thins them by paper distance.
 *   - Booleans are only present when true; empty optional attributes are omitted.
 *
 * Structure loosely follows Planetiler's Apache-2.0 example BikeRouteOverlay.java.
 */

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.geo.GeoUtils;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.geo.TileCoord;
import com.onthegomap.planetiler.reader.SimpleFeature;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmReader;
import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Consumer;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.CoordinateXY;
import org.locationtech.jts.geom.Envelope;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.prep.PreparedGeometry;
import org.locationtech.jts.geom.prep.PreparedGeometryFactory;
import org.locationtech.jts.index.strtree.STRtree;
import org.locationtech.jts.simplify.DouglasPeuckerSimplifier;

public class CapercailyeProfile implements Profile {

  // ---------------------------------------------------------------------------------------------
  // Global detail settings. MapLibre prints at z≈12.9 using z12 tiles (512 px source), so from
  // PRINT_ZOOM on everything is kept with almost no simplification.
  // ---------------------------------------------------------------------------------------------
  static final int PRINT_ZOOM = 12;
  static final double PRINT_TOLERANCE = 0.1; // px (tile = 256 px); 1 px at z12 ≈ 25 m at 48° N
  static final int ROUTES_MINZOOM = 11;

  /** Applies print-quality simplification and size limits to a feature from PRINT_ZOOM upwards. */
  static FeatureCollector.Feature printDetail(FeatureCollector.Feature f, double minSizeLow, double minSizePrint) {
    return f
      .setPixelToleranceBelowZoom(PRINT_ZOOM - 1, 0.2)
      .setPixelTolerance(PRINT_TOLERANCE)
      .setMinPixelSizeBelowZoom(PRINT_ZOOM - 1, minSizeLow)
      .setMinPixelSize(minSizePrint);
  }

  // ---------------------------------------------------------------------------------------------
  // Tag → kind / minzoom tables
  // ---------------------------------------------------------------------------------------------
  record Kind(String kind, int minZoom) {}

  static final Map<String, Integer> HIGHWAY_MINZOOM = new HashMap<>();
  static {
    put(HIGHWAY_MINZOOM, 6, "motorway", "trunk");
    put(HIGHWAY_MINZOOM, 8, "primary");
    put(HIGHWAY_MINZOOM, 9, "secondary");
    put(HIGHWAY_MINZOOM, 10, "tertiary");
    put(HIGHWAY_MINZOOM, 11, "unclassified", "residential");
    put(HIGHWAY_MINZOOM, 12, "service", "living_street", "pedestrian", "track", "path", "footway", "steps",
      "bridleway", "cycleway", "road");
  }

  /** Highway kinds that carry `foot` / `bicycle` (to tell shared foot/cycle paths from hiking paths). */
  /** Road classes without surface/access/tracktype/sac_scale/trail_visibility attributes (see processHighway). */
  static final Set<String> MAJOR_ROAD_KINDS = Set.of("motorway", "trunk", "primary", "secondary");
  static final Set<String> FOOT_BICYCLE_KINDS = Set.of("path", "footway", "cycleway", "bridleway");
  static final Set<String> FOOT_BICYCLE_VALUES = Set.of("designated", "yes", "no");

  static final Map<String, Integer> RAILWAY_MINZOOM = new HashMap<>();
  static {
    put(RAILWAY_MINZOOM, 8, "rail");
    put(RAILWAY_MINZOOM, 10, "light_rail", "narrow_gauge", "subway", "funicular", "monorail");
    put(RAILWAY_MINZOOM, 11, "tram");
    put(RAILWAY_MINZOOM, 12, "preserved", "disused");
  }

  static final Map<String, Kind> LANDCOVER = new HashMap<>();
  static {
    LANDCOVER.put("landuse=forest", new Kind("forest", 7));
    LANDCOVER.put("natural=wood", new Kind("forest", 7));
    LANDCOVER.put("landuse=meadow", new Kind("meadow", 10));
    LANDCOVER.put("landuse=grass", new Kind("meadow", 11));
    LANDCOVER.put("landuse=village_green", new Kind("meadow", 11));
    LANDCOVER.put("natural=grassland", new Kind("meadow", 10));
    LANDCOVER.put("landuse=farmland", new Kind("farmland", 10));
    LANDCOVER.put("landuse=orchard", new Kind("orchard", 10));
    LANDCOVER.put("landuse=vineyard", new Kind("vineyard", 10));
    LANDCOVER.put("natural=heath", new Kind("heath", 10));
    LANDCOVER.put("natural=scrub", new Kind("scrub", 10));
    LANDCOVER.put("natural=wetland", new Kind("wetland", 10));
    LANDCOVER.put("natural=bare_rock", new Kind("bare_rock", 10));
    LANDCOVER.put("natural=scree", new Kind("scree", 10));
    LANDCOVER.put("landuse=quarry", new Kind("quarry", 10));
    LANDCOVER.put("landuse=residential", new Kind("residential", 8));
    LANDCOVER.put("landuse=commercial", new Kind("commercial", 10));
    LANDCOVER.put("landuse=retail", new Kind("commercial", 10));
    LANDCOVER.put("landuse=industrial", new Kind("industrial", 10));
  }

  static final Map<String, Integer> WATERWAY_MINZOOM = new HashMap<>();
  static {
    put(WATERWAY_MINZOOM, 8, "river");
    put(WATERWAY_MINZOOM, 9, "canal");
    put(WATERWAY_MINZOOM, 11, "stream");
    put(WATERWAY_MINZOOM, 12, "ditch", "drain", "weir");
  }

  static final Map<String, Integer> PLACE_MINZOOM = new HashMap<>();
  static {
    put(PLACE_MINZOOM, 5, "city");
    put(PLACE_MINZOOM, 8, "town");
    put(PLACE_MINZOOM, 10, "village");
    put(PLACE_MINZOOM, 12, "hamlet", "isolated_dwelling", "farm", "locality");
  }
  /** Place kinds that are also taken from areas (as one point on the surface). */
  static final Set<String> PLACE_AREA_KINDS = Set.of("isolated_dwelling", "farm", "locality");

  /** protect_class values that are nature protection (1–7, 97–99); resource/social classes (11–29) are skipped. */
  static final Set<String> NATURE_PROTECT_CLASSES =
    Set.of("1", "1a", "1b", "2", "3", "4", "5", "6", "7", "97", "98", "99");

  static void put(Map<String, Integer> map, int zoom, String... keys) {
    for (String k : keys) {
      map.put(k, zoom);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POI table: "key=value" → kind + rank (lower rank = more important for hikers).
  // If an object matches several entries, the lowest rank wins; one OSM object yields one point.
  // ---------------------------------------------------------------------------------------------
  /** @param areas whether areas (closed ways, multipolygons) also yield a point (on the surface). */
  record Poi(String kind, int rank, boolean areas) {}

  static final int POI_MINZOOM = 12;
  static final Map<String, Poi> POI = new HashMap<>();
  static final List<String> POI_KEYS = List.of(
    "man_made", "power", "railway", "highway", "historic", "tourism", "information", "amenity", "leisure",
    "natural", "waterway", "building");

  static void poi(int rank, String kind, String... tags) {
    poi(rank, kind, true, tags);
  }

  static void poi(int rank, String kind, boolean areas, String... tags) {
    for (String t : tags) {
      POI.put(t, new Poi(kind, rank, areas));
    }
  }

  static {
    // rank 10: landmarks that structure a hike
    poi(10, "railway_station", "railway=station");
    poi(10, "viewtower", "man_made=tower"); // refined: only tower:type=observation stays viewtower
    poi(10, "alpine_hut", "tourism=alpine_hut");
    poi(10, "castle", "historic=castle");
    // rank 20: shelters, views, notable natural features, churches
    poi(20, "wilderness_hut", "tourism=wilderness_hut");
    poi(20, "shelter", "amenity=shelter");
    poi(20, "viewpoint", "tourism=viewpoint");
    poi(20, "railway_halt", "railway=halt");
    poi(20, "waterfall", false, "waterway=waterfall");
    poi(20, "cave_entrance", "natural=cave_entrance");
    poi(20, "ruins", "historic=ruins");
    poi(20, "church", "amenity=place_of_worship"); // refined: church / chapel / place_of_worship
    poi(20, "camp_site", "tourism=camp_site");
    poi(20, "hostel", "tourism=hostel");
    // rank 30: food, water, guideposts, parking
    poi(30, "restaurant", "amenity=restaurant", "amenity=pub", "amenity=biergarten");
    poi(30, "cafe", "amenity=cafe");
    poi(30, "spring", "natural=spring");
    poi(30, "drinking_water", "amenity=drinking_water");
    poi(30, "guidepost", "information=guidepost");
    poi(30, "parking", "amenity=parking");
    poi(30, "monument", "historic=monument");
    poi(30, "chapel", "building=chapel"); // chapels mapped only as building
    // rank 40: comfort and minor landmarks
    poi(40, "picnic_site", "tourism=picnic_site");
    poi(40, "bbq", "amenity=bbq", "leisure=firepit");
    poi(40, "hotel", "tourism=hotel", "tourism=guest_house");
    poi(40, "caravan_site", "tourism=caravan_site");
    poi(40, "toilets", "amenity=toilets");
    poi(40, "fountain", "amenity=fountain");
    poi(40, "memorial", "historic=memorial");
    poi(40, "communication_tower", "man_made=communications_tower");
    // rank 50: small orientation points
    poi(50, "wayside_cross", "historic=wayside_cross");
    poi(50, "wayside_shrine", "historic=wayside_shrine");
    poi(50, "rock", "natural=rock");
    poi(50, "stone", "natural=stone");
    poi(50, "sinkhole", "natural=sinkhole");
    poi(50, "mast", "man_made=mast");
    poi(50, "wind_turbine", "power=generator"); // refined: wind only
    poi(50, "weir", false, "waterway=weir");
  }

  static final Set<String> SKIP_MEMORIALS = Set.of("stolperstein", "plaque", "blue_plaque");
  static final Set<String> SKIP_PARKING = Set.of("underground", "street_side", "lane", "on_kerb", "half_on_kerb");
  static final Set<String> SKIP_SHELTERS = Set.of("public_transport", "field_shelter");

  /**
   * Kind-specific refinement of a table match: returns the (possibly changed) POI, or null to drop the candidate.
   */
  static Poi refine(Poi p, SourceFeature sf) {
    return switch (p.kind()) {
      case "viewtower" -> refineTower(p, sf);
      case "church" -> refineWorship(p, sf);
      case "castle" -> sf.hasTag("ruins", "yes") ? new Poi("castle_ruins", 10, true) : p;
      case "ruins" -> sf.hasTag("ruins", "castle") ? new Poi("castle_ruins", 10, true) : p;
      case "viewpoint" -> sf.hasTag("name") ? p : null; // only named viewpoints (PLAN 4a)
      case "memorial" -> SKIP_MEMORIALS.contains(sf.getString("memorial", "")) ? null : p;
      case "parking" -> sf.hasTag("access", "private", "no") ||
        SKIP_PARKING.contains(sf.getString("parking", "")) ? null : p;
      case "toilets" -> refineToilets(p, sf);
      case "shelter" -> SKIP_SHELTERS.contains(sf.getString("shelter_type", "")) ? null : p;
      case "wind_turbine" -> sf.hasTag("generator:source", "wind") ? p : null;
      case "guidepost" -> sf.hasTag("tourism", "information") || !sf.hasTag("tourism") ? p : null;
      default -> p;
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Toilets: all toilet-specific rules live here; nothing else in this file filters toilets.
  // refineToilets is the access filter. Filter Q (PLAN 4a, from the Karlsruhe analysis: indoor room mapping
  // of campuses, hospitals, shopping centres) keeps only publicly reachable toilets; it runs in finish() on
  // the single candidates, before the 75 m merge and the urban test, see dropReason.
  // ---------------------------------------------------------------------------------------------

  /** Only publicly accessible toilets stay (access missing, yes or public); customers/permit/... drop out. */
  static Poi refineToilets(Poi p, SourceFeature sf) {
    return !sf.hasTag("access") || sf.hasTag("access", "yes", "public") ? p : null;
  }

  /** Tag part of filter Q for one toilet object (the surroundings part is looked up in finish()). */
  record ToiletTags(boolean evidence, boolean roomMapped, boolean indoorish, boolean accessYes) {}

  static final Set<String> TOILET_EVIDENCE_TAGS = Set.of("name", "opening_hours", "operator", "brand", "charge",
    "centralkey", "website", "description");
  /** Surroundings that protect a toilet from Q (condition 2). */
  static final Set<String> TOILET_PROTECT_BUILDING = Set.of("train_station", "transportation", "kiosk", "toilets");
  static final Set<String> TOILET_PROTECT_LEISURE = Set.of("park", "garden");
  static final Set<String> TOILET_PROTECT_TOURISM = Set.of("information", "zoo", "museum");
  /** Institution grounds (condition 3b). */
  static final Set<String> TOILET_INSTITUTION_AMENITY =
    Set.of("university", "college", "hospital", "school", "kindergarten", "clinic", "research_institute", "prison");
  static final Set<String> TOILET_INSTITUTION_BUILDING =
    Set.of("university", "college", "hospital", "school", "kindergarten");

  static ToiletTags toiletTags(SourceFeature sf) {
    boolean evidence = false;
    for (String k : sf.tags().keySet()) {
      if (TOILET_EVIDENCE_TAGS.contains(k) || k.startsWith("payment:")) {
        evidence = true;
        break;
      }
    }
    boolean roomMapped = sf.hasTag("indoor", "room", "area") || sf.hasTag("repeat_on") ||
      (!sf.isPoint() && sf.hasTag("ref") && !sf.hasTag("name") && !sf.hasTag("building"));
    boolean indoorish = (sf.hasTag("indoor") && !sf.hasTag("indoor", "no")) || levelNotZero(sf.getString("level"));
    return new ToiletTags(evidence, roomMapped, indoorish, sf.hasTag("access", "yes"));
  }

  /**
   * True if `level` is present and "not 0": split at `;` and `,`, every part is a number other than 0 (an
   * unparseable part such as `1-4` counts as not 0). `0`, `0.0` and `0;1` are not "not 0".
   */
  static boolean levelNotZero(String level) {
    if (level == null) {
      return false;
    }
    boolean any = false;
    for (String part : level.split("[;,]")) {
      String t = part.trim();
      if (t.isEmpty()) {
        continue;
      }
      any = true;
      try {
        if (Double.parseDouble(t) == 0) {
          return false;
        }
      } catch (NumberFormatException e) {
        // not parseable: counts as not 0
      }
    }
    return any;
  }

  /** Surroundings of a toilet that matter for Q; collected from areas in processFeature. */
  record ToiletArea(Geometry geometry, long id) {}

  /** Collects the protecting areas and institution areas for filter Q (other buildings are deliberately not collected). */
  void collectToiletContext(SourceFeature sf) {
    String building = sf.getString("building", "");
    boolean protect = TOILET_PROTECT_BUILDING.contains(building) ||
      TOILET_PROTECT_LEISURE.contains(sf.getString("leisure", "")) ||
      TOILET_PROTECT_TOURISM.contains(sf.getString("tourism", ""));
    boolean institution = TOILET_INSTITUTION_AMENITY.contains(sf.getString("amenity", "")) ||
      sf.hasTag("landuse", "education") || sf.hasTag("healthcare", "hospital") ||
      TOILET_INSTITUTION_BUILDING.contains(building);
    if (!protect && !institution) {
      return;
    }
    try {
      Geometry g = sf.polygon(); // not simplified: buildings are small
      if (g == null || g.isEmpty()) {
        return;
      }
      ToiletArea a = new ToiletArea(g, sf.vectorTileFeatureId(10, sf.isPoint()));
      if (protect) {
        toiletProtectAreas.add(a);
      }
      if (institution) {
        toiletInstitutionAreas.add(a);
      }
    } catch (GeometryException e) {
      // skip unusable areas
    }
  }

  /** Spatial index over areas for the point-in-polygon test of filter Q. */
  static class ToiletAreaIndex {
    final STRtree tree = new STRtree();
    final List<PreparedGeometry> prepared = new ArrayList<>();
    final List<Long> ids = new ArrayList<>();

    ToiletAreaIndex(List<ToiletArea> areas) {
      for (ToiletArea a : areas) {
        tree.insert(a.geometry().getEnvelopeInternal(), prepared.size());
        prepared.add(PreparedGeometryFactory.prepare(a.geometry()));
        ids.add(a.id());
      }
      tree.build();
    }

    /** True if the point lies in an area other than the object `selfId` itself. */
    @SuppressWarnings("unchecked")
    boolean covers(double x, double y, long selfId) {
      Point pt = GeoUtils.point(x, y);
      for (int i : (List<Integer>) tree.query(new Envelope(x, x, y, y))) {
        if (ids.get(i) != selfId && prepared.get(i).covers(pt)) {
          return true;
        }
      }
      return false;
    }
  }

  /**
   * Filter Q. A toilet that passed the access filter is dropped if all three hold: (1) no evidence of being public
   * (`evidence`), (2) not in a protecting area (`protectedCtx`), (3a) room-mapped, or (3b) indoor/level or on
   * institution grounds (`institution`) while `access` is not `yes`. Returns the reason (exclusive, in the order
   * room, institution, indoor) or null if the toilet stays.
   */
  static String dropReason(ToiletTags t, boolean protectedCtx, boolean institution) {
    if (t.evidence() || protectedCtx) {
      return null;
    }
    if (t.roomMapped()) {
      return "room";
    }
    if (t.accessYes()) {
      return null;
    }
    if (institution) {
      return "institution";
    }
    return t.indoorish() ? "indoor" : null;
  }

  static boolean dropToilet(ToiletTags t, boolean protectedCtx, boolean institution) {
    return dropReason(t, protectedCtx, institution) != null;
  }

  /** Weight of a toilet for the urban thinning in the app (higher = more important). */
  static int toiletWeight(SourceFeature sf) {
    int w = 0;
    if (sf.hasTag("wheelchair", "yes")) {
      w += 1;
    }
    if (sf.hasTag("fee", "no")) {
      w += 1;
    }
    if (sf.hasTag("opening_hours")) {
      w += 1;
    }
    if (sf.hasTag("changing_table", "yes")) {
      w += 1;
    }
    return w;
  }

  static Poi refineTower(Poi p, SourceFeature sf) {
    String type = sf.getString("tower:type", "");
    return switch (type) {
      case "observation" -> p;
      case "communication" -> new Poi("communication_tower", 40, true);
      case "bell_tower" -> null; // church steeples: the church POI already marks them
      default -> new Poi("tower", 40, true);
    };
  }

  static Poi refineWorship(Poi p, SourceFeature sf) {
    if (sf.hasTag("building", "chapel") || sf.hasTag("place_of_worship", "chapel")) {
      return new Poi("chapel", 20, true);
    }
    return sf.hasTag("religion", "christian") || !sf.hasTag("religion") ? p : new Poi("place_of_worship", 40, true);
  }

  // ---------------------------------------------------------------------------------------------
  // Hiking routes: relation preprocessing
  // ---------------------------------------------------------------------------------------------
  static final List<String> NETWORK_RANK = List.of("iwn", "nwn", "rwn", "lwn");

  record RouteInfo(long id, String symbol, String ref, String name, String colour, String network,
    boolean superroute) implements OsmRelationInfo {

    int rank() {
      int i = NETWORK_RANK.indexOf(network);
      return i < 0 ? NETWORK_RANK.size() : i;
    }

    boolean hasOwnSign() {
      return !symbol.isEmpty() || !ref.isEmpty();
    }

    /**
     * A child of a signed ancestor (same network) is hidden unless it shows a different symbol (rule B).
     * Rule C (the most specific sign wins) is applied in {@link #processRoutes}.
     */
    boolean hiddenBy(RouteInfo ancestor) {
      return id != ancestor.id && network.equals(ancestor.network) && ancestor.hasOwnSign() &&
        (symbol.isEmpty() || symbol.equals(ancestor.symbol));
    }
  }

  @Override
  public List<OsmRelationInfo> preprocessOsmRelation(OsmElement.Relation rel) {
    String type = rel.getString("type");
    if (("route".equals(type) || "superroute".equals(type)) &&
      rel.hasTag("route", "hiking", "foot") &&
      !rel.hasTag("state", "proposed")) {
      return List.of(new RouteInfo(
        rel.id(),
        str(rel.getString("osmc:symbol")),
        str(rel.getString("ref")),
        str(rel.getString("name")),
        str(rel.getString("colour")),
        str(rel.getString("network")).toLowerCase(),
        "superroute".equals(type)
      ));
    }
    return null;
  }

  static String str(String s) {
    return s == null ? "" : s.trim();
  }

  void processRoutes(SourceFeature sf, FeatureCollector features) {
    // includeSuperRelations=true: also returns superroutes, with the path of child relations.
    List<OsmReader.RelationMember<RouteInfo>> members = sf.relationInfo(RouteInfo.class, true);
    if (members.isEmpty()) {
      return;
    }
    Map<Long, RouteInfo> routes = new LinkedHashMap<>();
    for (var m : members) {
      RouteInfo r = m.relation();
      routes.putIfAbsent(r.id(), r);
    }
    // Rule B: a child is hidden by a signed ancestor of the same network if its symbol is empty or equal.
    Set<Long> suppressed = new HashSet<>();
    // Routes that are, or belong to, a superroute / route hierarchy on this way (for the cap order).
    Set<Long> superRelated = new HashSet<>();
    for (var m : members) {
      if (m.relation().superroute()) {
        superRelated.add(m.relation().id());
      }
      if (!m.isSuperRelation()) {
        continue;
      }
      RouteInfo ancestor = m.relation();
      superRelated.add(ancestor.id());
      for (long childId : m.parentRelationPath()) {
        superRelated.add(childId);
        RouteInfo child = routes.get(childId);
        if (child != null && child.hiddenBy(ancestor)) {
          suppressed.add(childId);
        }
      }
    }
    // Rule C (the most specific sign wins): an ancestor of the same network with a different symbol is
    // hidden if an active descendant has its own symbol, because that one is the sign put up on site.
    Set<Long> overridden = new HashSet<>();
    for (var m : members) {
      if (!m.isSuperRelation()) {
        continue;
      }
      RouteInfo ancestor = m.relation();
      for (long childId : m.parentRelationPath()) {
        RouteInfo child = routes.get(childId);
        if (child != null && !suppressed.contains(childId) && !child.symbol().isEmpty() &&
          child.id() != ancestor.id() && child.network().equals(ancestor.network()) &&
          !child.symbol().equals(ancestor.symbol())) {
          overridden.add(ancestor.id());
        }
      }
    }
    List<RouteInfo> active = new ArrayList<>();
    for (RouteInfo r : routes.values()) {
      if (!suppressed.contains(r.id()) && !overridden.contains(r.id())) {
        active.add(r);
      }
    }
    if (active.isEmpty()) {
      return;
    }
    // Order: network rank, then routes with superroute relation first, then ref, symbol, id.
    active.sort(Comparator
      .comparingInt(RouteInfo::rank)
      .thenComparing((RouteInfo r) -> superRelated.contains(r.id()) ? 0 : 1)
      .thenComparing(RouteInfo::ref)
      .thenComparing(RouteInfo::symbol)
      .thenComparingLong(RouteInfo::id));

    // All active routes individually, in sort order: no deduplication, no cap (PLAN 3). All lists are
    // slot-aligned and always present (empty slots); `ids` makes the route set of a segment unambiguous, so
    // line merging only joins neighbours with the same routes.
    var f = features.line("routes")
      .setMinZoom(ROUTES_MINZOOM)
      .setAttr("ids", join(active, r -> Long.toString(r.id())))
      .setAttr("networks", join(active, RouteInfo::network))
      .setAttr("symbols", join(active, RouteInfo::symbol))
      .setAttr("refs", join(active, RouteInfo::ref))
      .setAttr("names", join(active, RouteInfo::name))
      .setAttr("colours", join(active, RouteInfo::colour));
    String network = active.getFirst().rank() < NETWORK_RANK.size() ? active.getFirst().network() : null;
    f.setAttr("network", network);
    f.setAttr("nets", netSwitches(active));
    printDetail(f, 0.5, 0);
  }

  /**
   * Switch classes of the routes of a segment (`nets`): per route its own network if iwn / nwn / rwn, everything
   * else (incl. none) is lwn; deduplicated, in the order iwn|nwn|rwn|lwn, joined with '|'. The app's network
   * switches (web/src/waymarks/routes.ts `networkGroup`) use exactly this mapping.
   */
  static String netSwitches(List<RouteInfo> routes) {
    StringBuilder sb = new StringBuilder();
    for (String net : List.of("iwn", "nwn", "rwn", "lwn")) {
      boolean present = false;
      for (RouteInfo r : routes) {
        String n = r.network();
        String cls = n.equals("iwn") || n.equals("nwn") || n.equals("rwn") ? n : "lwn";
        if (cls.equals(net)) {
          present = true;
          break;
        }
      }
      if (present) {
        if (sb.length() > 0) {
          sb.append('|');
        }
        sb.append(net);
      }
    }
    return sb.toString();
  }

  static String join(List<RouteInfo> list, java.util.function.Function<RouteInfo, String> fn) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < list.size(); i++) {
      if (i > 0) {
        sb.append('|');
      }
      sb.append(fn.apply(list.get(i)).replace('|', '/'));
    }
    return sb.toString();
  }

  // ---------------------------------------------------------------------------------------------
  // Feature processing
  // ---------------------------------------------------------------------------------------------
  @Override
  public void processFeature(SourceFeature sf, FeatureCollector features) {
    if (sf.canBeLine()) {
      if (sf.hasRelationInfo()) {
        processRoutes(sf, features);
      }
      if (sf.hasTag("highway")) {
        processHighway(sf, features);
      }
      if (sf.hasTag("railway")) {
        processRailway(sf, features);
      }
      if (sf.hasTag("waterway")) {
        processWaterway(sf, features);
      }
      if (sf.hasTag("natural", "cliff")) {
        processCliff(sf, features);
      }
    }
    if (sf.canBePolygon()) {
      processLandcover(sf, features);
      collectSettlementArea(sf);
      collectToiletContext(sf);
      processWater(sf, features);
      processProtectedArea(sf, features);
      if (sf.hasTag("building") && !sf.hasTag("building", "no")) {
        processBuilding(sf, features);
      }
    }
    if (sf.isPoint() || sf.canBePolygon()) {
      if (sf.hasTag("place")) {
        processPlace(sf, features);
        collectPlaceNode(sf);
      }
      processPoi(sf, features);
    }
    if (sf.isPoint() && sf.hasTag("natural", "peak", "saddle")) {
      processPeak(sf, features);
    }
  }

  void processHighway(SourceFeature sf, FeatureCollector features) {
    String hw = sf.getString("highway");
    boolean link = hw.endsWith("_link");
    String kind = link ? hw.substring(0, hw.length() - 5) : hw;
    Integer minZoom = HIGHWAY_MINZOOM.get(kind);
    if (minZoom == null || sf.hasTag("area", "yes")) {
      return;
    }
    if (link) {
      minZoom = Math.max(minZoom, 10);
    }
    var f = features.line("transport")
      .setMinZoom(minZoom)
      .setAttr("kind", kind)
      .setAttr("link", link ? Boolean.TRUE : null)
      .setAttr("name", sf.getString("name"))
      .setAttr("ref", sf.getString("ref"))
      .setSortKey(sf.getWayZorder());
    if (!MAJOR_ROAD_KINDS.contains(kind)) {
      // Major roads omit these so that adjacent ways with the same bridge/tunnel/name/ref state merge into
      // long lines (the style draws road labels once per feature); the style does not use them for roads.
      f.setAttr("tracktype", sf.getString("tracktype"))
        .setAttr("sac_scale", sf.getString("sac_scale"))
        .setAttr("trail_visibility", sf.getString("trail_visibility"))
        .setAttr("surface", sf.getString("surface"))
        .setAttr("access", sf.hasTag("access", "private", "no") ? sf.getString("access") : null);
    }
    if (FOOT_BICYCLE_KINDS.contains(kind)) {
      f.setAttr("foot", oneOf(sf.getString("foot"), FOOT_BICYCLE_VALUES))
        .setAttr("bicycle", oneOf(sf.getString("bicycle"), FOOT_BICYCLE_VALUES));
    }
    bridgeTunnel(sf, f);
    printDetail(f, 0.5, 0);
  }

  void processRailway(SourceFeature sf, FeatureCollector features) {
    String kind = sf.getString("railway");
    Integer minZoom = RAILWAY_MINZOOM.get(kind);
    if (minZoom == null) {
      return;
    }
    if (sf.hasTag("service")) { // siding, yard, spur, crossover
      minZoom = Math.max(minZoom, 12);
    }
    var f = features.line("transport")
      .setMinZoom(minZoom)
      .setAttr("kind", kind)
      .setAttr("rail", true)
      .setAttr("service", sf.getString("service"))
      .setAttr("name", sf.getString("name"))
      .setSortKey(sf.getWayZorder());
    bridgeTunnel(sf, f);
    printDetail(f, 0.5, 0);
  }

  static void bridgeTunnel(SourceFeature sf, FeatureCollector.Feature f) {
    if (sf.hasTag("bridge") && !sf.hasTag("bridge", "no")) {
      f.setAttr("bridge", true);
    }
    if (isTunnel(sf)) {
      f.setAttr("tunnel", true);
    }
  }

  static boolean isTunnel(SourceFeature sf) {
    return (sf.hasTag("tunnel") && !sf.hasTag("tunnel", "no")) || sf.hasTag("covered", "yes");
  }

  static Boolean intermittent(SourceFeature sf) {
    return sf.hasTag("intermittent", "yes") ? Boolean.TRUE : null;
  }

  void processWaterway(SourceFeature sf, FeatureCollector features) {
    String kind = sf.getString("waterway");
    Integer minZoom = WATERWAY_MINZOOM.get(kind);
    if (minZoom == null) {
      return;
    }
    var f = features.line("waterway")
      .setMinZoom(minZoom)
      .setAttr("kind", kind)
      .setAttr("name", sf.getString("name"))
      .setAttr("tunnel", isTunnel(sf) ? Boolean.TRUE : null)
      .setAttr("intermittent", intermittent(sf));
    printDetail(f, 0.5, 0);
  }

  /** Cliffs keep their way direction (OSM: the lower side is on the right); they are never merged. */
  void processCliff(SourceFeature sf, FeatureCollector features) {
    var f = features.line("cliff")
      .setMinZoom(11)
      .setAttr("kind", "cliff")
      .setAttr("name", sf.getString("name"));
    printDetail(f, 0.5, 0);
  }

  void processLandcover(SourceFeature sf, FeatureCollector features) {
    Kind k = lookup(sf, LANDCOVER, "landuse", "natural");
    if (k == null) {
      return;
    }
    var f = features.polygon("landcover")
      .setMinZoom(k.minZoom())
      .setAttr("kind", k.kind());
    if ("wetland".equals(k.kind())) {
      f.setAttr("wetland", sf.getString("wetland"));
    }
    printDetail(f, 2, 0.5);
  }

  void processWater(SourceFeature sf, FeatureCollector features) {
    if (sf.hasTag("natural", "water") || sf.hasTag("landuse", "reservoir", "basin") ||
      sf.hasTag("waterway", "riverbank", "dock")) {
      var f = features.polygon("water")
        .setMinZoom(6)
        .setAttr("name", sf.getString("name"))
        .setAttr("intermittent", intermittent(sf));
      printDetail(f, 2, 0.5);
    }
  }

  void processProtectedArea(SourceFeature sf, FeatureCollector features) {
    String kind = protectedAreaKind(sf);
    if (kind == null) {
      return;
    }
    var f = features.polygon("protected_area")
      .setMinZoom("national_park".equals(kind) ? 8 : 10)
      .setAttr("kind", kind)
      .setAttr("name", sf.getString("name"))
      .setAttr("protect_class", sf.getString("protect_class"));
    printDetail(f, 2, 0.5);
  }

  static String protectedAreaKind(SourceFeature sf) {
    String pc = sf.getString("protect_class");
    if (sf.hasTag("boundary", "national_park") || "2".equals(pc)) {
      return "national_park";
    }
    if (sf.hasTag("leisure", "nature_reserve")) {
      return "nature_reserve";
    }
    if (!sf.hasTag("boundary", "protected_area") || (pc != null && !NATURE_PROTECT_CLASSES.contains(pc))) {
      return null;
    }
    return "4".equals(pc) || "1a".equals(pc) || "1b".equals(pc) ? "nature_reserve" : "protected_area";
  }

  void processBuilding(SourceFeature sf, FeatureCollector features) {
    var f = features.polygon("building").setMinZoom(PRINT_ZOOM);
    printDetail(f, 1, 0.05);
  }

  void processPlace(SourceFeature sf, FeatureCollector features) {
    String kind = sf.getString("place");
    Integer minZoom = PLACE_MINZOOM.get(kind);
    String name = sf.getString("name");
    if (minZoom == null || name == null || (!sf.isPoint() && !PLACE_AREA_KINDS.contains(kind))) {
      return;
    }
    Long population = parseLong(sf.getString("population"));
    var f = sf.isPoint() ? features.point("place") : features.pointOnSurface("place");
    f.setMinZoom(minZoom)
      .setAttr("kind", kind)
      .setAttr("name", name)
      .setAttr("population", population)
      .setSortKeyDescending(population == null ? 0 : (int) Math.min(population, Integer.MAX_VALUE / 2))
      .setBufferPixels(64);
  }

  void processPeak(SourceFeature sf, FeatureCollector features) {
    Double ele = parseEle(sf.getString("ele"));
    features.point("peak")
      .setMinZoom(sf.hasTag("name") ? 10 : 12)
      .setAttr("kind", sf.getString("natural"))
      .setAttr("name", sf.getString("name"))
      .setAttr("ele", ele)
      .setSortKeyDescending(ele == null ? 0 : ele.intValue())
      .setBufferPixels(64);
  }

  /** Finds the best (lowest rank) POI match over all POI keys of this object. */
  static Poi matchPoi(SourceFeature sf) {
    Poi best = null;
    for (String key : POI_KEYS) {
      Object v = sf.getTag(key);
      Poi p = v == null ? null : POI.get(key + "=" + v);
      if (p != null && (sf.isPoint() || p.areas())) {
        p = refine(p, sf);
        if (p != null && (best == null || p.rank() < best.rank())) {
          best = p;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------
  // POI candidates. Kinds that are merged (CLUSTER_*) or need the urban test (restaurant, cafe, hotel) are
  // collected in processPoi and written in finish(); all other kinds are written directly as before.
  // ---------------------------------------------------------------------------------------------
  /** Merge radius for similar POIs (metres), PLAN 4a. */
  static final double CLUSTER_RADIUS_M = 75;
  /**
   * Settlement polygons closer than this belong to the same settlement area (bridges streets, parks, rails), metres.
   * 60 instead of 30: with 30 m, Karlsruhe's centre falls apart into many small areas (only ~50 % of its
   * restaurants became urban); 60 m gives ~90 %.
   */
  static final double SETTLEMENT_BRIDGE_M = 60;
  /** A place node is assigned to the settlement area of the nearest polygon within this distance, metres. */
  static final double PLACE_SNAP_M = 100;
  /** A restaurant/cafe/hotel/toilet belongs to a settlement area if a polygon is within this distance (60 instead of 30: unmapped pedestrian zones), metres. */
  static final double POI_IN_SETTLEMENT_M = 60;
  /** Weights for the weighted distance (metres / weight) to place nodes within a settlement area. */
  static final Map<String, Double> PLACE_WEIGHT = Map.of("city", 5.0, "town", 3.0, "village", 1.0, "hamlet", 0.5);
  /** Kinds merged per kind. */
  static final Set<String> CLUSTER_KINDS =
    Set.of("parking", "guidepost", "wayside_shrine", "stone", "rock", "mast", "toilets", "fountain");
  /** Rest-area ensemble: merged into one group, ranked in this order (best first). */
  static final List<String> ENSEMBLE_KINDS = List.of("shelter", "picnic_site", "bbq");
  /**
   * Kinds that get weight / tags / urban and are never merged (collected for the urban test; thinned in the app).
   * toilets are merged first (CLUSTER_KINDS) and then get the same attributes, see finish().
   */
  static final Set<String> URBAN_KINDS = Set.of("restaurant", "cafe", "hotel");
  /** Parking access values the style hides anyway; such parkings are written individually, never merged. */
  static final Set<String> PARKING_NO_CLUSTER_ACCESS =
    Set.of("customers", "permit", "residents", "delivery", "agricultural", "forestry", "destination");
  static final String ENSEMBLE_GROUP = "rastplatz";

  /**
   * A POI before output. `x`, `y` are world coordinates (NaN for directly written kinds). `attrs` holds all
   * non-null attributes written to the tile.
   */
  record PoiCandidate(long id, String kind, int rank, double x, double y, String name, Map<String, Object> attrs,
    int tagCount, double areaM2, boolean hikingHint, String access, ToiletTags toilet) {

    PoiCandidate withAttrs(Map<String, Object> newAttrs) {
      return new PoiCandidate(id, kind, rank, x, y, name, newAttrs, tagCount, areaM2, hikingHint, access, toilet);
    }
  }

  final ConcurrentLinkedQueue<PoiCandidate> poiCandidates = new ConcurrentLinkedQueue<>();
  /** Areas that protect a toilet from filter Q / institution grounds (world coordinates, not simplified). */
  final ConcurrentLinkedQueue<ToiletArea> toiletProtectAreas = new ConcurrentLinkedQueue<>();
  final ConcurrentLinkedQueue<ToiletArea> toiletInstitutionAreas = new ConcurrentLinkedQueue<>();
  /** Settlement polygons (landuse residential/commercial/retail), world coordinates, simplified. */
  final ConcurrentLinkedQueue<Geometry> settlements = new ConcurrentLinkedQueue<>();
  /** Place nodes (city, town, village, hamlet) with a name. */
  final ConcurrentLinkedQueue<PlaceNode> places = new ConcurrentLinkedQueue<>();

  record PlaceNode(String kind, double x, double y) {}

  /** Distance of a world-coordinate pair in metres (Web Mercator is conformal: same scale in x and y). */
  static double metersBetween(double ax, double ay, double bx, double by) {
    double lat = Math.toRadians(GeoUtils.getWorldLat((ay + by) / 2));
    return Math.hypot(ax - bx, ay - by) * GeoUtils.WORLD_CIRCUMFERENCE_METERS * Math.cos(lat);
  }

  /** Length in world units that corresponds to `meters` at world y coordinate `y`. */
  static double metersToWorld(double meters, double y) {
    return meters / (GeoUtils.WORLD_CIRCUMFERENCE_METERS * Math.cos(Math.toRadians(GeoUtils.getWorldLat(y))));
  }

  static boolean isCollected(String kind, SourceFeature sf) {
    if ("parking".equals(kind)) {
      return !PARKING_NO_CLUSTER_ACCESS.contains(sf.getString("access", ""));
    }
    return CLUSTER_KINDS.contains(kind) || ENSEMBLE_KINDS.contains(kind) || URBAN_KINDS.contains(kind);
  }

  void processPoi(SourceFeature sf, FeatureCollector features) {
    Poi p = matchPoi(sf);
    if (p == null) {
      return;
    }
    boolean collected = isCollected(p.kind(), sf);
    double x = Double.NaN;
    double y = Double.NaN;
    if (collected) {
      try {
        Coordinate c = (sf.isPoint() ? sf.worldGeometry() : sf.pointOnSurface()).getCoordinate();
        x = c.x;
        y = c.y;
      } catch (GeometryException e) {
        return; // as a direct write would: no usable point, no POI
      }
    }
    PoiCandidate c = buildCandidate(sf, p, x, y);
    if (collected) {
      poiCandidates.add(c);
    } else {
      applyPoi(sf.isPoint() ? features.point("poi") : features.pointOnSurface("poi"), c);
    }
  }

  PoiCandidate buildCandidate(SourceFeature sf, Poi p, double x, double y) {
    String name = sf.getString("name");
    Map<String, Object> attrs = new LinkedHashMap<>();
    attrs.put("kind", p.kind());
    attrs.put("rank", p.rank());
    putIfNotNull(attrs, "name", name);
    putIfNotNull(attrs, "ele", parseEle(sf.getString("ele")));
    double areaM2 = 0;
    boolean hikingHint = false;
    String access = null;
    ToiletTags toilet = null;
    switch (p.kind()) {
      case "church", "chapel", "place_of_worship" -> putIfNotNull(attrs, "religion", sf.getString("religion"));
      case "shelter" -> putIfNotNull(attrs, "shelter_type", sf.getString("shelter_type"));
      case "tower" -> putIfNotNull(attrs, "tower_type", sf.getString("tower:type"));
      case "railway_station", "railway_halt" -> putIfNotNull(attrs, "station", sf.getString("station"));
      case "spring", "fountain" -> putIfNotNull(attrs, "drinking_water", sf.getString("drinking_water"));
      case "parking" -> {
        access = sf.getString("access");
        putIfNotNull(attrs, "access", access);
        if (sf.hasTag("hiking", "yes")) {
          attrs.put("hiking", Boolean.TRUE);
        }
        if (!sf.isPoint()) {
          try {
            long area = Math.round(sf.areaMeters());
            attrs.put("area_m2", area);
            areaM2 = area;
          } catch (GeometryException e) {
            // leave area_m2 missing
          }
        }
        hikingHint = sf.hasTag("hiking", "yes") || sf.getString("name", "").toLowerCase().contains("wanderparkplatz");
      }
      case "restaurant", "cafe" -> {
        attrs.put("weight", gastroWeight(sf));
        attrs.put("tags", sf.tags().size());
      }
      case "hotel" -> {
        attrs.put("weight", hotelWeight(sf));
        attrs.put("tags", sf.tags().size());
      }
      case "toilets" -> {
        attrs.put("weight", toiletWeight(sf));
        attrs.put("tags", sf.tags().size());
        toilet = toiletTags(sf); // helper values for filter Q, not an attribute (attrs go into the tiles)
      }
      default -> {
      }
    }
    long id = sf.vectorTileFeatureId(10, sf.isPoint()); // same encoding as Planetiler's default (id*10+type)
    return new PoiCandidate(id, p.kind(), p.rank(), x, y, name, attrs, sf.tags().size(), areaM2, hikingHint,
      access, toilet);
  }

  static void putIfNotNull(Map<String, Object> m, String key, Object value) {
    if (value != null) {
      m.put(key, value);
    }
  }

  /** Weight of a restaurant/cafe for later thinning in the app (higher = more important). */
  static int gastroWeight(SourceFeature sf) {
    int w = 0;
    switch (sf.getString("amenity", "")) {
      case "biergarten" -> w += 3;
      case "restaurant", "pub" -> w += 1;
      default -> {
      }
    }
    if (sf.hasTag("wikidata") || sf.hasTag("wikipedia")) {
      w += 2;
    }
    if (sf.hasTag("outdoor_seating", "yes")) {
      w += 1;
    }
    if (sf.hasTag("website") || sf.hasTag("contact:website")) {
      w += 1;
    }
    if (sf.hasTag("opening_hours")) {
      w += 1;
    }
    if (sf.hasTag("brand")) {
      w -= 3;
    }
    return w;
  }

  /** Weight of a hotel / guest house for the urban thinning in the app (higher = more important). */
  static int hotelWeight(SourceFeature sf) {
    int w = 0;
    if (sf.hasTag("tourism", "hotel")) {
      w += 1;
    }
    String stars = sf.getString("stars", "");
    if (!stars.isEmpty() && Character.isDigit(stars.charAt(0)) && stars.charAt(0) >= '3') {
      w += 1;
    }
    if (sf.hasTag("wikidata") || sf.hasTag("wikipedia")) {
      w += 2;
    }
    if (sf.hasTag("website") || sf.hasTag("contact:website")) {
      w += 1;
    }
    if (sf.hasTag("brand")) {
      w -= 3;
    }
    return w;
  }

  /** Sets min zoom, attributes, sort key, buffer and id of a POI feature (geometry is set by the caller). */
  static void applyPoi(FeatureCollector.Feature f, PoiCandidate c) {
    f.setMinZoom(POI_MINZOOM)
      .setSortKey(c.rank() * 2 + (c.name() == null ? 1 : 0))
      .setBufferPixels(64)
      .setId(c.id());
    for (var e : c.attrs().entrySet()) {
      f.setAttr(e.getKey(), e.getValue());
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Collecting data for the global steps in finish()
  // ---------------------------------------------------------------------------------------------
  void collectSettlementArea(SourceFeature sf) {
    if (!sf.hasTag("landuse", "residential", "commercial", "retail")) {
      return;
    }
    try {
      // polygon() instead of worldGeometry(): for closed ways worldGeometry() is the ring, polygon() the area.
      Geometry g = sf.polygon();
      if (g == null || g.isEmpty()) {
        return;
      }
      Envelope env = g.getEnvelopeInternal();
      Geometry simple = DouglasPeuckerSimplifier.simplify(g, metersToWorld(5, (env.getMinY() + env.getMaxY()) / 2));
      if (!simple.isEmpty()) {
        settlements.add(simple);
      }
    } catch (GeometryException e) {
      // skip unusable areas
    }
  }

  void collectPlaceNode(SourceFeature sf) {
    String kind = sf.getString("place");
    if (!sf.isPoint() || !PLACE_WEIGHT.containsKey(kind) || !sf.hasTag("name")) {
      return;
    }
    try {
      Coordinate c = sf.worldGeometry().getCoordinate();
      places.add(new PlaceNode(kind, c.x, c.y));
    } catch (GeometryException e) {
      // skip
    }
  }

  // ---------------------------------------------------------------------------------------------
  // finish(): runs once after the OSM source was read, before tiles are written. Merges POIs, decides
  // urban (restaurant, cafe, hotel, toilets), writes the collected POIs.
  // ---------------------------------------------------------------------------------------------
  record Cluster(PoiCandidate rep, List<PoiCandidate> members) {}

  @Override
  public void finish(String sourceName, FeatureCollector.Factory factory,
    Consumer<FeatureCollector.Feature> emit) {
    if (!"osm".equals(sourceName)) {
      return;
    }
    long start = System.currentTimeMillis();
    List<PoiCandidate> collected = new ArrayList<>(poiCandidates);
    poiCandidates.clear();
    List<PoiCandidate> all = filterToilets(collected);
    // deterministic order independent of thread scheduling
    all.sort(Comparator.comparingLong(PoiCandidate::id)
      .thenComparingDouble(PoiCandidate::x).thenComparingDouble(PoiCandidate::y));

    // Groups: one per merged kind, one rest-area ensemble; restaurant/cafe/hotel are never merged.
    Map<String, List<PoiCandidate>> groups = new TreeMap<>();
    List<PoiCandidate> urbanKinds = new ArrayList<>();
    for (PoiCandidate c : all) {
      if (URBAN_KINDS.contains(c.kind())) {
        urbanKinds.add(c);
      } else if (ENSEMBLE_KINDS.contains(c.kind())) {
        groups.computeIfAbsent(ENSEMBLE_GROUP, k -> new ArrayList<>()).add(c);
      } else {
        groups.computeIfAbsent(c.kind(), k -> new ArrayList<>()).add(c);
      }
    }

    // Urban test (restaurant, cafe, hotel, toilets): flag only, nothing thinned here. Built before the merge,
    // because toilets are tested at the position of their representative after merging.
    UrbanIndex urban = buildSettlementAreas();
    Map<String, int[]> urbanStats = new TreeMap<>();

    int written = 0;
    for (var entry : groups.entrySet()) {
      String key = entry.getKey();
      List<Cluster> clusters = clusterGroup(entry.getValue(), priority(key));
      Map<String, int[]> perKind = new TreeMap<>();
      for (Cluster cl : clusters) {
        PoiCandidate rep = cl.rep().withAttrs(mergedAttrs(cl));
        if ("toilets".equals(rep.kind())) {
          rep = withUrbanFlag(rep, urban, urbanStats);
        }
        emitPoint(factory, emit, rep);
        written++;
      }
      if (ENSEMBLE_GROUP.equals(key)) {
        for (PoiCandidate c : entry.getValue()) {
          perKind.computeIfAbsent(c.kind(), k -> new int[2])[0]++;
        }
        for (Cluster cl : clusters) {
          perKind.computeIfAbsent(cl.rep().kind(), k -> new int[2])[1]++;
        }
        StringBuilder sb = new StringBuilder();
        perKind.forEach((k, v) -> sb.append(' ').append(k).append(' ').append(v[0]).append('→').append(v[1]));
        System.out.println("[capercailye] merge " + key + ": " + entry.getValue().size() + " → " +
          clusters.size() + " (" + sb.toString().trim() + ")");
      } else {
        System.out.println("[capercailye] merge " + key + ": " + entry.getValue().size() + " → " + clusters.size());
      }
    }

    for (PoiCandidate c : urbanKinds) {
      emitPoint(factory, emit, withUrbanFlag(c, urban, urbanStats));
      written++;
    }
    StringBuilder sb = new StringBuilder();
    urbanStats.forEach((k, v) -> sb.append(' ').append(k).append(' ').append(v[1]).append('/').append(v[0]));
    System.out.println("[capercailye] urban:" + sb + " (toilets after merge)");
    System.out.println("[capercailye] finish: " + collected.size() + " collected POIs → " + written + " written, " +
      (System.currentTimeMillis() - start) + " ms");
  }

  /**
   * Filter Q on the single toilet candidates (before they are grouped, so that a room record cannot become the
   * representative and hide a public toilet). Logs the counts; the other kinds pass unchanged.
   */
  List<PoiCandidate> filterToilets(List<PoiCandidate> in) {
    ToiletAreaIndex protect = new ToiletAreaIndex(new ArrayList<>(toiletProtectAreas));
    ToiletAreaIndex institution = new ToiletAreaIndex(new ArrayList<>(toiletInstitutionAreas));
    toiletProtectAreas.clear();
    toiletInstitutionAreas.clear();
    List<PoiCandidate> out = new ArrayList<>(in.size());
    int before = 0;
    int room = 0;
    int inst = 0;
    int indoor = 0;
    int savedEvidence = 0;
    int savedContext = 0;
    for (PoiCandidate c : in) {
      ToiletTags t = c.toilet();
      if (t == null) {
        out.add(c);
        continue;
      }
      before++;
      boolean prot = protect.covers(c.x(), c.y(), c.id());
      boolean instn = institution.covers(c.x(), c.y(), c.id());
      String reason = dropReason(t, prot, instn);
      if (reason == null) {
        out.add(c);
        // saved by: would be dropped without this reason
        if (t.evidence() && dropToilet(new ToiletTags(false, t.roomMapped(), t.indoorish(), t.accessYes()), prot, instn)) {
          savedEvidence++;
        }
        if (prot && dropToilet(t, false, instn)) {
          savedContext++;
        }
      } else {
        switch (reason) {
          case "room" -> room++;
          case "institution" -> inst++;
          default -> indoor++;
        }
      }
    }
    System.out.println("[capercailye] toilets filter Q: " + before + " → " + (before - room - inst - indoor) +
      " (dropped: room " + room + ", institution " + inst + ", indoor/level " + indoor + "; saved by evidence " +
      savedEvidence + ", by context " + savedContext + ")");
    return out;
  }

  /** The candidate with `urban=true` if its position lies in a larger settlement; counts it in `stats` (kind → [all, urban]). */
  static PoiCandidate withUrbanFlag(PoiCandidate c, UrbanIndex urban, Map<String, int[]> stats) {
    boolean isUrban = urban.isUrban(c.x(), c.y());
    int[] st = stats.computeIfAbsent(c.kind(), k -> new int[2]);
    st[0]++;
    st[1] += isUrban ? 1 : 0;
    if (!isUrban) {
      return c;
    }
    Map<String, Object> attrs = new LinkedHashMap<>(c.attrs());
    attrs.put("urban", Boolean.TRUE);
    return c.withAttrs(attrs);
  }

  static void emitPoint(FeatureCollector.Factory factory, Consumer<FeatureCollector.Feature> emit,
    PoiCandidate c) {
    Point pt = GeoUtils.point(c.x(), c.y());
    FeatureCollector fc = factory.get(SimpleFeature.fromWorldGeometry(pt, c.id()));
    applyPoi(fc.point("poi"), c);
    for (var feature : fc) {
      emit.accept(feature);
    }
  }

  static Comparator<PoiCandidate> named() {
    return Comparator.comparingInt((PoiCandidate c) -> c.name() == null ? 1 : 0);
  }

  /** Representative priority within a group (best first); last tie-breaker is the id. */
  static Comparator<PoiCandidate> priority(String group) {
    Comparator<PoiCandidate> byTags = Comparator.comparingInt(PoiCandidate::tagCount).reversed();
    if ("parking".equals(group)) {
      return Comparator.comparingDouble(PoiCandidate::areaM2).reversed()
        .thenComparing(named()).thenComparing(byTags).thenComparingLong(PoiCandidate::id);
    }
    if (ENSEMBLE_GROUP.equals(group)) {
      return Comparator.comparingInt((PoiCandidate c) -> ENSEMBLE_KINDS.indexOf(c.kind()))
        .thenComparing(named()).thenComparing(byTags).thenComparingLong(PoiCandidate::id);
    }
    return named().thenComparing(byTags).thenComparingLong(PoiCandidate::id);
  }

  /**
   * Greedy leader clustering: candidates in priority order; an unassigned candidate becomes representative and
   * takes all unassigned candidates within CLUSTER_RADIUS_M of itself (not of other members, so no chains).
   */
  @SuppressWarnings("unchecked")
  static List<Cluster> clusterGroup(List<PoiCandidate> group, Comparator<PoiCandidate> priority) {
    List<PoiCandidate> sorted = new ArrayList<>(group);
    sorted.sort(priority);
    STRtree tree = new STRtree();
    for (int i = 0; i < sorted.size(); i++) {
      PoiCandidate c = sorted.get(i);
      tree.insert(new Envelope(c.x(), c.x(), c.y(), c.y()), i);
    }
    tree.build();
    boolean[] taken = new boolean[sorted.size()];
    List<Cluster> out = new ArrayList<>();
    for (int i = 0; i < sorted.size(); i++) {
      if (taken[i]) {
        continue;
      }
      taken[i] = true;
      PoiCandidate rep = sorted.get(i);
      double d = metersToWorld(CLUSTER_RADIUS_M, rep.y());
      List<Integer> near = new ArrayList<>(
        tree.query(new Envelope(rep.x() - d, rep.x() + d, rep.y() - d, rep.y() + d)));
      near.sort(null);
      List<PoiCandidate> members = new ArrayList<>();
      members.add(rep);
      for (int j : near) {
        PoiCandidate o = sorted.get(j);
        if (!taken[j] && metersBetween(rep.x(), rep.y(), o.x(), o.y()) <= CLUSTER_RADIUS_M) {
          taken[j] = true;
          members.add(o);
        }
      }
      out.add(new Cluster(rep, members));
    }
    return out;
  }

  /** Attributes of the representative plus `count` (>= 2 members), `bbq` (rest area) and `hiking` (parking). */
  static Map<String, Object> mergedAttrs(Cluster cl) {
    Map<String, Object> attrs = new LinkedHashMap<>(cl.rep().attrs());
    if (cl.members().size() < 2) {
      return attrs;
    }
    attrs.put("count", cl.members().size());
    String kind = cl.rep().kind();
    if ("shelter".equals(kind) || "picnic_site".equals(kind)) {
      if (cl.members().stream().anyMatch(m -> "bbq".equals(m.kind()))) {
        attrs.put("bbq", Boolean.TRUE);
      }
    }
    if ("parking".equals(kind) && cl.members().stream().anyMatch(PoiCandidate::hikingHint)) {
      attrs.put("hiking", Boolean.TRUE);
    }
    return attrs;
  }

  // ---------------------------------------------------------------------------------------------
  // Urban areas: the contiguous settlement area that contains a town/city node, minus the zone that is
  // closer (weighted) to a village/hamlet node. Administrative boundaries are deliberately not used.
  // ---------------------------------------------------------------------------------------------
  /** Settlement areas with their place nodes; answers {@link #isUrban}. */
  static class UrbanIndex {
    Geometry[] polys = new Geometry[0];
    STRtree tree = new STRtree();
    int[] area; // polygon index → settlement area id (union-find root)
    boolean[] cityArea; // area id → contains a town/city node
    Map<Integer, List<PlaceNode>> areaPlaces = new HashMap<>();

    @SuppressWarnings("unchecked")
    boolean isUrban(double x, double y) {
      if (polys.length == 0) {
        return false;
      }
      double d = metersToWorld(POI_IN_SETTLEMENT_M, y);
      int best = -1;
      double bestDist = Double.MAX_VALUE;
      Point pt = GeoUtils.point(x, y);
      List<Integer> cand = new ArrayList<>(tree.query(new Envelope(x - d, x + d, y - d, y + d)));
      cand.sort(null);
      for (int j : cand) {
        double dist = polys[j].distance(pt);
        if (dist <= d && dist < bestDist) {
          best = j;
          bestDist = dist;
        }
      }
      if (best < 0) {
        return false;
      }
      int a = area[best];
      if (!cityArea[a]) {
        return false;
      }
      PlaceNode nearest = null;
      double nearestScore = Double.MAX_VALUE;
      for (PlaceNode n : areaPlaces.getOrDefault(a, List.of())) {
        double score = metersBetween(x, y, n.x(), n.y()) / PLACE_WEIGHT.get(n.kind());
        if (score < nearestScore) {
          nearest = n;
          nearestScore = score;
        }
      }
      return nearest != null && ("town".equals(nearest.kind()) || "city".equals(nearest.kind()));
    }
  }

  /** Builds settlement areas (union-find over polygons ≤ SETTLEMENT_BRIDGE_M apart) and assigns place nodes. */
  @SuppressWarnings("unchecked")
  UrbanIndex buildSettlementAreas() {
    long start = System.currentTimeMillis();
    UrbanIndex idx = new UrbanIndex();
    List<Geometry> polyList = new ArrayList<>(settlements);
    settlements.clear();
    polyList.sort(Comparator.<Geometry>comparingDouble(g -> g.getEnvelopeInternal().getMinX())
      .thenComparingDouble(g -> g.getEnvelopeInternal().getMinY())
      .thenComparingDouble(g -> g.getEnvelopeInternal().getMaxX())
      .thenComparingDouble(g -> g.getEnvelopeInternal().getMaxY()));
    List<PlaceNode> placeList = new ArrayList<>(places);
    places.clear();
    placeList.sort(Comparator.comparingDouble(PlaceNode::x).thenComparingDouble(PlaceNode::y)
      .thenComparing(PlaceNode::kind));
    int n = polyList.size();
    idx.polys = polyList.toArray(new Geometry[0]);
    for (int i = 0; i < n; i++) {
      idx.tree.insert(idx.polys[i].getEnvelopeInternal(), i);
    }
    idx.tree.build();

    int[] parent = new int[n];
    for (int i = 0; i < n; i++) {
      parent[i] = i;
    }
    for (int i = 0; i < n; i++) {
      Envelope e = idx.polys[i].getEnvelopeInternal();
      double d = metersToWorld(SETTLEMENT_BRIDGE_M, (e.getMinY() + e.getMaxY()) / 2);
      Envelope q = new Envelope(e);
      q.expandBy(d);
      for (Object o : idx.tree.query(q)) {
        int j = (Integer) o;
        if (j > i && find(parent, i) != find(parent, j) && idx.polys[i].isWithinDistance(idx.polys[j], d)) {
          parent[find(parent, j)] = find(parent, i);
        }
      }
    }
    idx.area = new int[n];
    for (int i = 0; i < n; i++) {
      idx.area[i] = find(parent, i);
    }
    idx.cityArea = new boolean[n];

    int snapped = 0;
    for (PlaceNode pl : placeList) {
      double d = metersToWorld(PLACE_SNAP_M, pl.y());
      Point pt = GeoUtils.point(pl.x(), pl.y());
      List<Integer> cand = new ArrayList<>(idx.tree.query(new Envelope(pl.x() - d, pl.x() + d, pl.y() - d, pl.y() + d)));
      cand.sort(null);
      int best = -1;
      double bestDist = Double.MAX_VALUE;
      for (int j : cand) {
        double dist = idx.polys[j].distance(pt);
        if (dist <= d && dist < bestDist) {
          best = j;
          bestDist = dist;
        }
      }
      if (best >= 0) {
        int a = idx.area[best];
        idx.areaPlaces.computeIfAbsent(a, k -> new ArrayList<>()).add(pl);
        if ("town".equals(pl.kind()) || "city".equals(pl.kind())) {
          idx.cityArea[a] = true;
        }
        snapped++;
      }
    }
    int cityAreas = 0;
    int roots = 0;
    for (int i = 0; i < n; i++) {
      if (idx.area[i] == i) {
        roots++;
        cityAreas += idx.cityArea[i] ? 1 : 0;
      }
    }
    System.out.println("[capercailye] settlements: " + n + " polygons → " + roots + " areas, " + cityAreas +
      " urban; place nodes " + placeList.size() + ", assigned " + snapped + " (" +
      (System.currentTimeMillis() - start) + " ms)");
    return idx;
  }

  static int find(int[] parent, int i) {
    while (parent[i] != i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  static String oneOf(String value, Set<String> allowed) {
    return value != null && allowed.contains(value) ? value : null;
  }

  static Kind lookup(SourceFeature sf, Map<String, Kind> table, String... keys) {
    for (String key : keys) {
      Object v = sf.getTag(key);
      if (v != null) {
        Kind k = table.get(key + "=" + v);
        if (k != null) {
          return k;
        }
      }
    }
    return null;
  }

  static Long parseLong(String s) {
    if (s == null) {
      return null;
    }
    try {
      return Long.parseLong(s.replaceAll("[\\s.,']", ""));
    } catch (NumberFormatException e) {
      return null;
    }
  }

  static Double parseEle(String s) {
    if (s == null) {
      return null;
    }
    try {
      double d = Double.parseDouble(s.replace(',', '.').replaceAll("\\s*m$", "").trim());
      return Math.round(d * 10) / 10.0;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Post-processing: merge line segments with identical attributes
  // ---------------------------------------------------------------------------------------------
  @Override
  public List<VectorTile.Feature> postProcessLayerFeatures(String layer, int zoom, List<VectorTile.Feature> items)
    throws GeometryException {
    boolean print = zoom >= PRINT_ZOOM;
    return switch (layer) {
      // minLength 0 at print zooms: nothing may be dropped, merging only joins segments.
      // `cliff` is deliberately not merged: line merging may reverse direction.
      case "routes", "transport", "waterway" ->
        FeatureMerge.mergeLineStrings(items, print ? 0 : 0.5, print ? PRINT_TOLERANCE : 0.2, 4);
      case "landcover" -> print ? items : FeatureMerge.mergeNearbyPolygons(items, 2, 2, 0.5, 0.5);
      default -> items;
    };
  }

  /**
   * Marks buildings with `industrial=true` when their interior point lies in a `landcover` polygon of kind
   * industrial or commercial (landuse=industrial/commercial/retail) of the same tile. Done per tile because
   * Planetiler processes OSM features in a single pass: at z12–z14 `landcover` is unmerged and unthinned
   * (all areas >= 0.5 px, tile buffer included), so the tile contains every relevant area.
   */
  @Override
  public Map<String, List<VectorTile.Feature>> postProcessTileFeatures(TileCoord tile,
    Map<String, List<VectorTile.Feature>> layers) throws GeometryException {
    List<VectorTile.Feature> buildings = layers.get("building");
    List<VectorTile.Feature> landcover = layers.get("landcover");
    if (tile.z() < PRINT_ZOOM || buildings == null || buildings.isEmpty() || landcover == null) {
      return layers;
    }
    List<PreparedGeometry> zones = new ArrayList<>();
    for (VectorTile.Feature lc : landcover) {
      Object kind = lc.attrs().get("kind");
      if ("industrial".equals(kind) || "commercial".equals(kind)) {
        zones.add(PreparedGeometryFactory.prepare(lc.geometry().decode()));
      }
    }
    if (zones.isEmpty()) {
      return layers;
    }
    List<VectorTile.Feature> marked = new ArrayList<>(buildings.size());
    for (VectorTile.Feature b : buildings) {
      Geometry g = b.geometry().decode();
      Point p = g.getInteriorPoint();
      boolean inside = false;
      for (PreparedGeometry z : zones) {
        if (z.intersects(p)) {
          inside = true;
          break;
        }
      }
      marked.add(inside ? b.copyWithExtraAttrs(Map.of("industrial", Boolean.TRUE)) : b);
    }
    Map<String, List<VectorTile.Feature>> out = new HashMap<>(layers);
    out.put("building", marked);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Metadata and entry point
  // ---------------------------------------------------------------------------------------------
  @Override
  public String name() {
    return "capercailye";
  }

  @Override
  public String description() {
    return "Hiking map tiles (1:25,000 print) with hiking routes per way segment";
  }

  @Override
  public String attribution() {
    return OSM_ATTRIBUTION;
  }

  @Override
  public String version() {
    return "0.3.1-m7";
  }

  public static void main(String[] args) {
    Arguments arguments = Arguments.fromArgsOrConfigFile(args);
    Path input = arguments.inputFile("input", "OSM .osm.pbf input file",
      Path.of(System.getenv().getOrDefault("CAPERCAILYE_DATA", System.getProperty("user.home") + "/.local/share/capercailye"), "baden-wuerttemberg-latest.osm.pbf"));
    Path output = arguments.file("output", "output .pmtiles file",
      Path.of(System.getenv().getOrDefault("CAPERCAILYE_DATA", System.getProperty("user.home") + "/.local/share/capercailye"), "capercailye-bw.pmtiles"));
    Planetiler.create(arguments)
      .setProfile(new CapercailyeProfile())
      .addOsmSource("osm", input)
      .overwriteOutput(output)
      .run();
  }
}
