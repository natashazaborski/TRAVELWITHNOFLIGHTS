import { describe, expect, it } from "vitest";
import { DEFAULT_LIMIT, searchPlaces } from "@/lib/places";
import { createPlaceSearch } from "@/lib/places/search";
import type { Place } from "@/lib/places/types";

let nextId = 1;
function place(name: string, state: string, population: number): Place {
  return {
    id: nextId++,
    name,
    state,
    lat: 0,
    lon: 0,
    population,
    timezone: "America/Chicago",
  };
}

const fixture = createPlaceSearch(
  [
    place("Portland", "ME", 66881),
    place("Portland", "OR", 652503),
    place("South Portland", "ME", 26000),
    place("Portage", "MI", 48000),
    place("Springfield", "IL", 114394),
    place("Springfield", "MO", 170188),
    place("Springfield", "MA", 154341),
    place("Springfield", "OR", 62000),
    place("Burbank", "CA", 107337),
    place("Burbank", "CA", 4000), // same label, smaller place
    place("St. Louis", "MO", 279695),
    place("Saint Louis", "MI", 7482),
    place("Las Vegas", "NV", 641903),
    place("Cañon City", "CO", 16400),
    place("Fort Worth", "TX", 918915),
  ],
  {
    ME: "Maine",
    OR: "Oregon",
    MI: "Michigan",
    IL: "Illinois",
    MO: "Missouri",
    MA: "Massachusetts",
    CA: "California",
    NV: "Nevada",
    CO: "Colorado",
    TX: "Texas",
  },
);

const labels = (q: string, limit?: number) =>
  fixture(q, { limit }).map((p) => p.label);

describe("createPlaceSearch (fixture)", () => {
  it("ranks exact matches by population, then later-word matches", () => {
    expect(labels("Portland")).toEqual([
      "Portland, OR",
      "Portland, ME",
      "South Portland, ME",
    ]);
  });

  it("ranks prefix matches by population, above later-word matches", () => {
    expect(labels("port")).toEqual([
      "Portland, OR",
      "Portland, ME",
      "Portage, MI",
      "South Portland, ME",
    ]);
  });

  it("matches later words once 3 characters are typed", () => {
    expect(labels("vegas")).toEqual(["Las Vegas, NV"]);
    expect(labels("ve")).toEqual([]);
  });

  it.each([
    ["Portland, ME", "Portland, ME"],
    ["Portland, Maine", "Portland, ME"],
    ["portland,maine", "Portland, ME"],
    ["Portland ME", "Portland, ME"],
    ["portland maine", "Portland, ME"],
    ["Portland, Oregn", "Portland, OR"], // typo in the state name
  ])("filters by state: %s", (q, expected) => {
    const results = labels(q);
    expect(results[0]).toBe(expected);
    expect(results.every((l) => l.endsWith(expected.slice(-4)))).toBe(true);
  });

  it("accepts a partly typed state after a comma", () => {
    expect(labels("Springfield, M")).toEqual([
      "Springfield, MO",
      "Springfield, MA",
    ]);
  });

  it("returns nothing for an unknown state rather than guessing", () => {
    expect(labels("Portland, Narnia")).toEqual([]);
  });

  it("ignores a trailing comma with no state", () => {
    expect(labels("Portland,")).toEqual(labels("Portland"));
  });

  it.each([
    ["springfeld", "Springfield, MO"],
    ["sprinfgield", "Springfield, MO"],
    ["Portlnd", "Portland, OR"],
    ["fort wroth", "Fort Worth, TX"],
  ])("tolerates typos: %s", (q, first) => {
    expect(labels(q)[0]).toBe(first);
  });

  it("does not fuzzy-match very short queries", () => {
    expect(labels("pz")).toEqual([]);
  });

  it("matches St. / Saint and Ft. / Fort both ways", () => {
    expect(labels("saint louis")).toEqual(["St. Louis, MO", "Saint Louis, MI"]);
    expect(labels("st louis")).toEqual(["St. Louis, MO", "Saint Louis, MI"]);
    expect(labels("ft worth")).toEqual(["Fort Worth, TX"]);
    // A partly typed "st" still prefix-matches ordinary names.
    expect(labels("st")).toEqual(["St. Louis, MO", "Saint Louis, MI"]);
    expect(labels("sp")[0]).toBe("Springfield, MO");
  });

  it("ignores accents", () => {
    expect(labels("canon city")).toEqual(["Cañon City, CO"]);
  });

  it("collapses places that would show the same label", () => {
    const burbanks = fixture("Burbank");
    expect(burbanks).toHaveLength(1);
    expect(burbanks[0]!.population).toBe(107337);
  });

  it("respects the limit", () => {
    expect(labels("spring", 2)).toEqual(["Springfield, MO", "Springfield, MA"]);
    expect(labels("spring", 0)).toEqual([]);
  });

  it("returns nothing for empty or punctuation-only input", () => {
    expect(labels("")).toEqual([]);
    expect(labels("  ,  ")).toEqual([]);
    expect(labels("...")).toEqual([]);
  });
});

// Against the real GeoNames dataset. Populations can shift when the data is
// rebuilt, so these check ordering properties rather than exact lists.
describe("searchPlaces (GeoNames data)", () => {
  it("Portland: Oregon first, Maine second", () => {
    const results = searchPlaces("Portland");
    expect(results.slice(0, 2).map((p) => p.label)).toEqual([
      "Portland, OR",
      "Portland, ME",
    ]);
    expect(results).toHaveLength(DEFAULT_LIMIT);
    expect(results.every((p) => p.name === "Portland")).toBe(true);
  });

  it("Portland, ME / portland maine / Portland ME pick Maine", () => {
    for (const q of ["Portland, ME", "portland maine", "Portland ME"]) {
      const [first] = searchPlaces(q);
      expect(first?.label).toBe("Portland, ME");
      expect(first?.timezone).toBe("America/New_York");
    }
  });

  it("Portland, OR is in the Pacific timezone", () => {
    expect(searchPlaces("Portland, OR")[0]?.timezone).toBe(
      "America/Los_Angeles",
    );
  });

  it("Springfield: exact matches only, in population order, capped", () => {
    const results = searchPlaces("Springfield");
    expect(results).toHaveLength(DEFAULT_LIMIT);
    expect(results.every((p) => p.name === "Springfield")).toBe(true);
    const pops = results.map((p) => p.population);
    expect(pops).toEqual([...pops].sort((a, b) => b - a));
    expect(new Set(results.slice(0, 3).map((p) => p.state))).toEqual(
      new Set(["MO", "MA", "IL"]),
    );
  });

  it("Springfield, IL picks the Illinois capital", () => {
    const results = searchPlaces("Springfield, IL");
    expect(results[0]?.label).toBe("Springfield, IL");
    expect(results.every((p) => p.state === "IL")).toBe(true);
  });

  it("Springfield with a typo still finds Springfield", () => {
    expect(searchPlaces("Springfeld")[0]?.name).toBe("Springfield");
  });

  it("returns City, ST labels and IANA timezones", () => {
    for (const p of searchPlaces("Kansas City")) {
      expect(p.label).toMatch(/^.+, [A-Z]{2}$/);
      expect(p.timezone).toMatch(/^(America|Pacific)\/[A-Za-z_/]+$/);
    }
  });

  it("finds big cities from partial or misspelled input", () => {
    expect(searchPlaces("new york")[0]?.label).toBe("New York City, NY");
    expect(searchPlaces("chicgo")[0]?.label).toBe("Chicago, IL");
    expect(searchPlaces("Washington")[0]?.label).toBe("Washington, DC");
  });
});
