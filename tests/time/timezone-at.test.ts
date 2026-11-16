import { describe, expect, it } from "vitest";
import { timezoneAt } from "@/lib/time/timezone-at";
import { zoneAbbreviation } from "@/lib/time/zoned";

const WINTER = Date.parse("2026-01-15T18:00:00Z");

// Stops near US timezone borders, where a coarse lookup is most likely to
// be wrong. Expected abbreviation is what a traveller there sees in January.
describe("timezoneAt (tz-lookup) near US zone borders", () => {
  it.each([
    ["Gary, IN (Central)", 41.5934, -87.3464, "CST"],
    ["Michigan City, IN (Central)", 41.7075, -86.895, "CST"],
    ["South Bend, IN (Eastern)", 41.6764, -86.252, "EST"],
    ["Indianapolis, IN", 39.7684, -86.158, "EST"],
    ["Louisville, KY", 38.2542, -85.7594, "EST"],
    ["Nashville, TN", 36.1627, -86.7816, "CST"],
    ["Knoxville, TN", 35.9606, -83.9207, "EST"],
    ["Pensacola, FL (Central)", 30.4213, -87.2169, "CST"],
    ["Tallahassee, FL", 30.4383, -84.2807, "EST"],
    ["Mandan, ND (Central)", 46.8267, -100.8896, "CST"],
    ["El Paso, TX (Mountain)", 31.7587, -106.4869, "MST"],
    ["Ontario, OR (Mountain)", 44.0266, -116.9629, "MST"],
    ["Flagstaff, AZ", 35.1983, -111.6513, "MST"],
    ["Juneau, AK", 58.3019, -134.4197, "AKST"],
    ["Honolulu, HI", 21.3069, -157.8583, "HST"],
    ["Seattle ferry terminal", 47.6026, -122.3393, "PST"],
  ])("%s", (_, lat, lon, abbr) => {
    expect(zoneAbbreviation(WINTER, timezoneAt(lat, lon, "UTC"))).toBe(abbr);
  });

  it("does not observe DST in Arizona", () => {
    const july = Date.parse("2026-07-15T18:00:00Z");
    expect(zoneAbbreviation(july, timezoneAt(33.4484, -112.074, "UTC"))).toBe(
      "MST",
    );
  });

  it("falls back for points at sea", () => {
    expect(timezoneAt(35, -140, "America/Los_Angeles")).toBe(
      "America/Los_Angeles",
    );
  });
});
