/**
 * Map data helpers, kept free of MapLibre imports so they can be unit tested
 * and so the map library loads only with the map itself.
 */
import type { MapOptions } from "maplibre-gl";
import type { Itinerary, LegMode } from "@/lib/routing/types";
import { palette } from "@/lib/theme/palette";

/** OpenFreeMap: free, no key, attribution added by MapLibre automatically. */
export const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Leg colours on the map, matching the route line. */
export const MODE_COLOR: Record<LegMode, string> = {
  bus: palette.lane,
  train: palette.ink,
  ferry: palette.waterLight,
  local: palette.inkMuted,
  walk: palette.ink,
};

/**
 * Basemap colours: dark asphalt land so the route stands out, with roads
 * and water emphasised. Keys are layer-id prefixes in the Positron style.
 */
const BASEMAP: { match: RegExp; paint: Record<string, unknown> }[] = [
  { match: /^background$/, paint: { "background-color": "#202327" } },
  {
    match: /^(park|landcover_wood|landcover_glacier|landcover_ice_shelf)$/,
    paint: { "fill-color": "#23272b" },
  },
  { match: /^landuse_residential$/, paint: { "fill-color": "#262a2f" } },
  {
    match: /^building$/,
    paint: { "fill-color": "#2c3035", "fill-outline-color": "#2c3035" },
  },
  { match: /^water$/, paint: { "fill-color": "#1b5288" } },
  { match: /^waterway$/, paint: { "line-color": "#2c6aa6" } },
  { match: /^road_area_pier$/, paint: { "fill-color": "#3a3f45" } },
  { match: /^road_pier$|^highway_path$/, paint: { "line-color": "#3a3f45" } },
  { match: /^highway_minor$/, paint: { "line-color": "#4a4f56" } },
  { match: /_casing$/, paint: { "line-color": "#16181b" } },
  {
    match: /^highway_major_(inner|subtle)$/,
    paint: { "line-color": "#6e747c" },
  },
  {
    match:
      /^(tunnel_motorway_inner|highway_motorway_(inner|subtle)|highway_motorway_bridge_inner)$/,
    paint: { "line-color": "#8d939b" },
  },
  { match: /^railway/, paint: { "line-color": "#7a8088" } },
  { match: /^boundary/, paint: { "line-color": "#5a6068" } },
  {
    match: /^(water_name|waterway_line_label)/,
    paint: { "text-color": palette.waterLight, "text-halo-color": "#16181b" },
  },
  {
    match: /^(label_|highway-name)/,
    paint: { "text-color": "#d9d4ca", "text-halo-color": "#16181b" },
  },
];

type StyleLayer = Style["layers"][number];

/** Recolours a Positron layer to the palette; other layers pass through. */
export function themeLayer(layer: StyleLayer): StyleLayer {
  const rule = BASEMAP.find((r) => r.match.test(layer.id));
  if (!rule) return layer;
  const paint = { ...(layer as { paint?: Record<string, unknown> }).paint };
  for (const [key, value] of Object.entries(rule.paint)) {
    // Only set properties that belong to this layer type: "fill-*" on fill
    // layers, "line-*" on line layers, "text-*" on symbol layers, etc.
    const prefix = layer.type === "symbol" ? "text-" : `${layer.type}-`;
    if (key.startsWith(prefix)) paint[key] = value;
  }
  // Labels: drop any halo blur so text stays crisp on the dark map.
  if (layer.type === "symbol") delete paint["text-halo-blur"];
  return { ...layer, paint } as StyleLayer;
}

export type Style = Exclude<MapOptions["style"], string | undefined>;

/**
 * Fetches the basemap style, removes every airport layer (runways, taxiways,
 * aerodrome labels; CLAUDE.md rule 2) and every highway shield (no copies of
 * real shields), and recolours the rest to the palette.
 */
export async function loadStyleWithoutAirports(
  fetchImpl: typeof fetch = fetch,
): Promise<Style> {
  const res = await fetchImpl(STYLE_URL);
  if (!res.ok) throw new Error(`Map style failed: ${res.status}`);
  const style = (await res.json()) as Style;
  style.layers = style.layers
    .filter((layer) => !isAirportLayer(layer) && !isShieldLayer(layer))
    .map(themeLayer);
  return style;
}

/** Layers drawing runways, taxiways, airport areas, or airport labels. */
export function isAirportLayer(layer: { id: string }): boolean {
  const sourceLayer = (layer as { "source-layer"?: string })["source-layer"];
  return (
    sourceLayer === "aeroway" ||
    sourceLayer === "aerodrome_label" ||
    /aero|airport/i.test(layer.id)
  );
}

/** Layers drawing US or other highway shields. */
export function isShieldLayer(layer: { id: string }): boolean {
  return /shield/i.test(layer.id);
}

/** GeoJSON for an itinerary: one line per leg, one point per stop. */
export function itineraryGeoJson(itinerary: Itinerary) {
  const lines = itinerary.legs.map((leg, i) => ({
    type: "Feature" as const,
    properties: {
      mode: leg.mode,
      color: MODE_COLOR[leg.mode],
      // Without provider geometry we draw a straight line, marked as such.
      approximate: !leg.geometry,
      index: i,
    },
    geometry: leg.geometry ?? {
      type: "LineString" as const,
      coordinates: [
        [leg.fromStop.lon, leg.fromStop.lat],
        [leg.toStop.lon, leg.toStop.lat],
      ] as [number, number][],
    },
  }));
  const stops = itinerary.legs
    .filter((l) => l.mode !== "walk")
    .flatMap((l) => [l.fromStop, l.toStop])
    .map((s) => ({
      type: "Feature" as const,
      properties: { name: s.name },
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
    }));
  return {
    lines: { type: "FeatureCollection" as const, features: lines },
    stops: { type: "FeatureCollection" as const, features: stops },
  };
}

export function boundsOf(
  itinerary: Itinerary,
): [[number, number], [number, number]] {
  const pts = itinerary.legs.flatMap((l) =>
    l.geometry
      ? l.geometry.coordinates
      : [
          [l.fromStop.lon, l.fromStop.lat] as [number, number],
          [l.toStop.lon, l.toStop.lat] as [number, number],
        ],
  );
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
