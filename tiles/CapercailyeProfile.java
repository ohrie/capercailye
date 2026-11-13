// capercailye – Planetiler profile for a printable 1:25,000 hiking map.
// SPDX-License-Identifier: MIT
//
// Single-file profile, run without Maven:
//   java -cp planetiler.jar CapercailyeProfile.java --input=bw.osm.pbf --output=out.pmtiles
// Structure loosely follows Planetiler's Apache-2.0 example BikeRouteOverlay.java.
// See SCHEMA.md for the produced layers and attributes.

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.geo.TileCoord;
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
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.prep.PreparedGeometry;
import org.locationtech.jts.geom.prep.PreparedGeometryFactory;

public class CapercailyeProfile implements Profile {

  // ---------------------------------------------------------------------------------------------
  // Global detail settings. MapLibre prints at z≈12.9 using z12 tiles (512 px source), so from
  // PRINT_ZOOM on everything is kept with almost no simplification.
  // ---------------------------------------------------------------------------------------------
  static final int PRINT_ZOOM = 12;
  static final double PRINT_TOLERANCE = 0.1; // px (tile = 256 px); 1 px at z12 ≈ 25 m at 48° N
  static final int MAX_ROUTE_SYMBOLS = 4;
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
      case "memorial" -> SKIP_MEMORIALS.contains(sf.getString("memorial", "")) ? null : p;
      case "parking" -> sf.hasTag("access", "private", "no") ||
        SKIP_PARKING.contains(sf.getString("parking", "")) ? null : p;
      // toilets: only publicly accessible ones (access missing, yes or public); customers/permit/... drop out
      case "toilets" -> !sf.hasTag("access") || sf.hasTag("access", "yes", "public") ? p : null;
      case "shelter" -> SKIP_SHELTERS.contains(sf.getString("shelter_type", "")) ? null : p;
      case "wind_turbine" -> sf.hasTag("generator:source", "wind") ? p : null;
      case "guidepost" -> sf.hasTag("tourism", "information") || !sf.hasTag("tourism") ? p : null;
      default -> p;
    };
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

    // Deduplicate by symbol (or by ref+name when no symbol), keep rank order, cap.
    Set<String> seen = new HashSet<>();
    List<RouteInfo> shown = new ArrayList<>();
    for (RouteInfo r : active) {
      String key = r.symbol().isEmpty() ? "\u0000" + r.ref() + "\u0000" + r.name() : r.symbol();
      if (seen.add(key) && shown.size() < MAX_ROUTE_SYMBOLS) {
        shown.add(r);
      }
    }
    var f = features.line("routes")
      .setMinZoom(ROUTES_MINZOOM)
      .setAttr("symbols", join(shown, RouteInfo::symbol))
      .setAttr("refs", join(shown, RouteInfo::ref))
      .setAttr("names", join(shown, RouteInfo::name))
      .setAttr("colours", join(shown, RouteInfo::colour))
      .setAttr("count", active.size());
    String network = active.getFirst().rank() < NETWORK_RANK.size() ? active.getFirst().network() : null;
    f.setAttr("network", network);
    printDetail(f, 0.5, 0);
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
      processWater(sf, features);
      processProtectedArea(sf, features);
      if (sf.hasTag("building") && !sf.hasTag("building", "no")) {
        processBuilding(sf, features);
      }
    }
    if (sf.isPoint() || sf.canBePolygon()) {
      if (sf.hasTag("place")) {
        processPlace(sf, features);
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

  void processPoi(SourceFeature sf, FeatureCollector features) {
    Poi p = matchPoi(sf);
    if (p == null) {
      return;
    }
    String name = sf.getString("name");
    var f = sf.isPoint() ? features.point("poi") : features.pointOnSurface("poi");
    f.setMinZoom(POI_MINZOOM)
      .setAttr("kind", p.kind())
      .setAttr("rank", p.rank())
      .setAttr("name", name)
      .setAttr("ele", parseEle(sf.getString("ele")))
      .setSortKey(p.rank() * 2 + (name == null ? 1 : 0))
      .setBufferPixels(64);
    switch (p.kind()) {
      case "church", "chapel", "place_of_worship" -> f.setAttr("religion", sf.getString("religion"));
      case "shelter" -> f.setAttr("shelter_type", sf.getString("shelter_type"));
      case "tower" -> f.setAttr("tower_type", sf.getString("tower:type"));
      case "railway_station", "railway_halt" -> f.setAttr("station", sf.getString("station"));
      case "spring", "fountain" -> f.setAttr("drinking_water", sf.getString("drinking_water"));
      case "parking" -> parkingAttrs(sf, f);
      default -> {
      }
    }
  }

  static void parkingAttrs(SourceFeature sf, FeatureCollector.Feature f) {
    f.setAttr("access", sf.getString("access"))
      .setAttr("hiking", sf.hasTag("hiking", "yes") ? Boolean.TRUE : null);
    if (!sf.isPoint()) {
      try {
        f.setAttr("area_m2", Math.round(sf.areaMeters()));
      } catch (GeometryException e) {
        // leave area_m2 missing
      }
    }
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
    return "0.2.1-m2b";
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
