import { describe, expect, it } from "vitest";
import {
  boundsOf,
  isAirportLayer,
  itineraryGeoJson,
  loadStyleWithoutAirports,
} from "@/components/results/map-data";
import { itinerary, leg } from "../routing/helpers";

describe("airport layers (CLAUDE.md rule 2)", () => {
  // Layer ids and source layers as found in the OpenFreeMap Positron style.
  it.each([
    [{ id: "aeroway-taxiway", "source-layer": "aeroway" }, true],
    [{ id: "aeroway-runway", "source-layer": "aeroway" }, true],
    [{ id: "aeroway-area", "source-layer": "aeroway" }, true],
    [{ id: "airport", "source-layer": "aerodrome_label" }, true],
    [{ id: "road_major", "source-layer": "transportation" }, false],
    [{ id: "water", "source-layer": "water" }, false],
  ])("%o -> %s", (layer, expected) => {
    expect(isAirportLayer(layer)).toBe(expected);
  });

  it("removes them from the fetched style", async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        { id: "background", type: "background" },
        { id: "aeroway-runway", type: "line", "source-layer": "aeroway" },
        { id: "airport", type: "symbol", "source-layer": "aerodrome_label" },
        { id: "road", type: "line", "source-layer": "transportation" },
      ],
    };
    const fake = (async () => Response.json(style)) as unknown as typeof fetch;
    const result = await loadStyleWithoutAirports(fake);
    expect(result.layers.map((l) => l.id)).toEqual(["background", "road"]);
  });
});

describe("itineraryGeoJson", () => {
  const trip = itinerary([
    leg("walk", "08:00", "08:10", {
      fromStop: {
        name: "Portland, OR",
        lat: 45.52,
        lon: -122.68,
        stopId: null,
      },
      toStop: { name: "Union Station", lat: 45.53, lon: -122.68, stopId: null },
    }),
    leg("train", "08:20", "12:00", {
      fromStop: {
        name: "Union Station",
        lat: 45.53,
        lon: -122.68,
        stopId: "pdx",
      },
      toStop: { name: "King Street", lat: 47.6, lon: -122.33, stopId: "sea" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.68, 45.53],
          [-122.5, 46.5],
          [-122.33, 47.6],
        ],
      },
    }),
  ]);

  it("has a line per leg, using provider geometry when present", () => {
    const { lines, stops } = itineraryGeoJson(trip);
    expect(lines.features.map((f) => f.properties.mode)).toEqual([
      "walk",
      "train",
    ]);
    expect(lines.features[0]!.properties.approximate).toBe(true);
    expect(lines.features[1]!.properties.approximate).toBe(false);
    expect(lines.features[1]!.geometry.coordinates).toHaveLength(3);
    // Stops: board and alight of each transit leg.
    expect(stops.features.map((f) => f.properties.name)).toEqual([
      "Union Station",
      "King Street",
    ]);
  });

  it("fits bounds around every point", () => {
    expect(boundsOf(trip)).toEqual([
      [-122.68, 45.52],
      [-122.33, 47.6],
    ]);
  });
});

describe("basemap theming", () => {
  it("removes highway shields (no copies of real shields)", async () => {
    const { isShieldLayer } = await import("@/components/results/map-data");
    expect(isShieldLayer({ id: "highway-shield-us-interstate" })).toBe(true);
    expect(isShieldLayer({ id: "road_shield_us" })).toBe(true);
    expect(isShieldLayer({ id: "highway-name-major" })).toBe(false);
  });

  it("recolours water, roads, and labels to the palette, only with valid properties", async () => {
    const { themeLayer } = await import("@/components/results/map-data");
    const water = themeLayer({
      id: "water",
      type: "fill",
      source: "openmaptiles",
      paint: { "fill-color": "#cccccc" },
    } as never) as { paint: Record<string, unknown> };
    expect(water.paint["fill-color"]).toBe("#1b5288");

    const label = themeLayer({
      id: "label_city",
      type: "symbol",
      source: "openmaptiles",
      paint: { "text-color": "#000", "text-halo-blur": 1 },
    } as never) as { paint: Record<string, unknown> };
    expect(label.paint["text-color"]).toBe("#d9d4ca");
    expect(label.paint["text-halo-blur"]).toBeUndefined();

    const casing = themeLayer({
      id: "highway_motorway_casing",
      type: "line",
      source: "openmaptiles",
      paint: { "line-color": "#fff", "line-width": 2 },
    } as never) as { paint: Record<string, unknown> };
    expect(casing.paint["line-color"]).toBe("#16181b");
    expect(casing.paint["line-width"]).toBe(2); // untouched
    expect(Object.keys(casing.paint).some((k) => k.startsWith("fill-"))).toBe(
      false,
    );
  });
});
