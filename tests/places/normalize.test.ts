import { describe, expect, it } from "vitest";
import { editDistance, nameForms, normalizeName } from "@/lib/places/normalize";

describe("normalizeName", () => {
  it.each([
    ["Cañon City", "canon city"],
    ["St. Paul", "st paul"],
    ["Winston-Salem", "winston salem"],
    ["Coeur d'Alene", "coeur dalene"],
    ["  PORTLAND  ", "portland"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe("nameForms", () => {
  it("adds the expanded form when a word is an abbreviation", () => {
    expect(nameForms("St. Louis")).toEqual(["st louis", "saint louis"]);
    expect(nameForms("Ft Worth")).toEqual(["ft worth", "fort worth"]);
  });

  it("does not expand inside words", () => {
    expect(nameForms("Stamford")).toEqual(["stamford"]);
  });
});

describe("editDistance", () => {
  it.each([
    ["springfield", "springfield", 0],
    ["springfeld", "springfield", 1], // missing letter
    ["sprinfgield", "springfield", 1], // swapped letters
    ["pheonix", "phoenix", 1],
    ["chicgo", "chicago", 1],
  ])("%s vs %s = %i", (a, b, d) => {
    expect(editDistance(a, b, 2)).toBe(d);
  });

  it("stops early once the limit is exceeded", () => {
    expect(editDistance("boston", "seattle", 1)).toBe(2);
  });
});
