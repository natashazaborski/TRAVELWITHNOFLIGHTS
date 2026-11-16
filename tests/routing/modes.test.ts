import { describe, expect, it } from "vitest";
import { classifyOtpMode, classifyRouteType } from "@/lib/routing/modes";
import { bookingUrlFor, OPERATORS } from "@/lib/routing/operators";
import { decodePolyline } from "@/lib/routing/polyline";

describe("classifyRouteType", () => {
  it.each([
    [0, null, "local"], // light rail
    [1, null, "local"], // subway
    [2, "Amtrak", "train"],
    [2, "Metra", "train"], // commuter rail is still a train
    [3, "TriMet", "local"],
    [3, "Greyhound", "bus"], // intercity operator on a plain bus type
    [3, "greyhound lines", "bus"],
    [4, null, "ferry"],
    [5, null, "local"],
    [11, null, "local"],
    [12, null, "local"],
    [102, null, "train"], // long distance trains
    [200, null, "bus"], // coach service
    [202, null, "bus"],
    [700, "King County Metro", "local"],
    [700, "FlixBus", "bus"],
    [900, null, "local"],
    [1000, null, "ferry"],
    [1200, null, "ferry"],
    [1100, null, "air"],
    [1102, null, "air"],
    [1500, null, "unsupported"], // taxi
    [1700, null, "unsupported"],
    [99, null, "unsupported"],
  ])("route_type %i (%s) -> %s", (type, operator, expected) => {
    expect(classifyRouteType(type, operator)).toBe(expected);
  });
});

describe("classifyOtpMode", () => {
  it.each([
    ["RAIL", null, "train"],
    ["BUS", null, "local"],
    ["BUS", "Megabus", "bus"],
    ["FERRY", null, "ferry"],
    ["SUBWAY", null, "local"],
    ["AIRPLANE", null, "air"],
    ["TAXI", null, "unsupported"],
  ])("%s (%s) -> %s", (mode, operator, expected) => {
    expect(classifyOtpMode(mode, operator)).toBe(expected);
  });
});

describe("operators", () => {
  it("maps names to booking homepages, never deep links", () => {
    expect(bookingUrlFor("Amtrak")).toBe("https://www.amtrak.com/");
    expect(bookingUrlFor("  greyhound  ")).toBe("https://www.greyhound.com/");
    expect(bookingUrlFor("Unknown Transit")).toBeNull();
    expect(bookingUrlFor(null)).toBeNull();
    for (const op of OPERATORS) {
      const url = new URL(op.bookingUrl);
      expect(url.protocol).toBe("https:");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    }
  });

  it("has no duplicate names", () => {
    const names = OPERATORS.flatMap((o) => o.names.map((n) => n.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("decodePolyline", () => {
  it("decodes the reference example to [lon, lat]", () => {
    // From the Google polyline algorithm documentation.
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@").coordinates).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("rejects truncated input", () => {
    expect(() => decodePolyline("_p~iF~ps|U_")).toThrow();
  });
});
