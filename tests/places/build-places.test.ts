import { describe, expect, it } from "vitest";
import { convertCities, parseUsStates } from "../../scripts/build-places.mts";

// A row in GeoNames "geoname" table order (19 tab-separated columns).
function row(fields: {
  id: number;
  name: string;
  featureCode?: string;
  country?: string;
  admin1: string;
  population: number;
  timezone?: string;
}): string {
  return [
    fields.id,
    fields.name,
    fields.name,
    "",
    "45.52346",
    "-122.67621",
    "P",
    fields.featureCode ?? "PPL",
    fields.country ?? "US",
    "",
    fields.admin1,
    "",
    "",
    "",
    fields.population,
    "",
    "",
    fields.timezone ?? "America/Los_Angeles",
    "2024-01-01",
  ].join("\t");
}

const admin1 = [
  "US.OR\tOregon\tOregon\t5744337",
  "US.ME\tMaine\tMaine\t4971068",
  "CA.01\tAlberta\tAlberta\t5883102",
].join("\n");

describe("parseUsStates", () => {
  it("keeps US codes only, without the country prefix", () => {
    expect(parseUsStates(admin1)).toEqual({ OR: "Oregon", ME: "Maine" });
  });
});

describe("convertCities", () => {
  const states = parseUsStates(admin1);

  it("produces compact records with the expected fields", () => {
    const text = row({
      id: 5746545,
      name: "Portland",
      admin1: "OR",
      population: 652503,
    });
    expect(convertCities(text, states)).toEqual([
      {
        id: 5746545,
        name: "Portland",
        state: "OR",
        lat: 45.5235,
        lon: -122.6762,
        population: 652503,
        timezone: "America/Los_Angeles",
      },
    ]);
  });

  it("drops non-US, abandoned, historical, and unknown-state rows", () => {
    const text = [
      row({
        id: 1,
        name: "Calgary",
        country: "CA",
        admin1: "01",
        population: 1e6,
      }),
      row({
        id: 2,
        name: "Ghost Town",
        featureCode: "PPLQ",
        admin1: "OR",
        population: 5000,
      }),
      row({
        id: 3,
        name: "Old Place (historical)",
        admin1: "OR",
        population: 5000,
      }),
      row({ id: 4, name: "Nowhere", admin1: "ZZ", population: 5000 }),
      row({ id: 5, name: "Portland", admin1: "ME", population: 66881 }),
    ].join("\n");
    expect(convertCities(text, states).map((p) => p.id)).toEqual([5]);
  });

  it("sorts by population, largest first", () => {
    const text = [
      row({ id: 1, name: "Portland", admin1: "ME", population: 66881 }),
      row({ id: 2, name: "Portland", admin1: "OR", population: 652503 }),
    ].join("\n");
    expect(convertCities(text, states).map((p) => p.state)).toEqual([
      "OR",
      "ME",
    ]);
  });
});
