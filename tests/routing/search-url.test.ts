import { describe, expect, it } from "vitest";
import {
  EMPTY_SEARCH,
  isCompleteSearch,
  parseSearch,
  serializeSearch,
  slugify,
} from "@/lib/routing/search-url";

const parse = (q: string) => parseSearch(new URLSearchParams(q));

describe("search URL state", () => {
  it("round-trips a full search with readable slugs", () => {
    const state = {
      fromId: 5746545,
      toId: 5809844,
      mode: "arriveBy" as const,
      date: "2026-11-17",
      time: "18:00",
    };
    const q = serializeSearch(state, {
      from: "Portland, OR",
      to: "Seattle, WA",
    });
    expect(q).toBe(
      "from=5746545-portland-or&to=5809844-seattle-wa&mode=arriveBy&date=2026-11-17&time=18%3A00",
    );
    expect(parse(q)).toEqual(state);
    expect(isCompleteSearch(parse(q))).toBe(true);
  });

  it("ignores the slug and accepts bare ids", () => {
    expect(parse("from=5746545-anything&to=5809844").fromId).toBe(5746545);
    expect(parse("from=5746545-anything&to=5809844").toId).toBe(5809844);
  });

  it.each([
    ["from=abc", { fromId: null }],
    ["from=-5", { fromId: null }],
    ["mode=fly", { mode: "leaveAt" }],
    ["date=2026-13-01", { date: null }],
    ["date=17/11/2026", { date: null }],
    ["time=24:00", { time: null }],
    ["time=9:00", { time: null }],
  ])("drops invalid values: %s", (q, expected) => {
    expect(parse(q)).toMatchObject(expected);
  });

  it("is incomplete without both places, a date, a time, or with the same place twice", () => {
    expect(isCompleteSearch(EMPTY_SEARCH)).toBe(false);
    expect(isCompleteSearch(parse("from=1&to=2&date=2026-11-17"))).toBe(false);
    expect(
      isCompleteSearch(parse("from=1&to=1&date=2026-11-17&time=09:00")),
    ).toBe(false);
    expect(
      isCompleteSearch(parse("from=1&to=2&date=2026-11-17&time=09:00")),
    ).toBe(true);
  });

  it("slugifies labels", () => {
    expect(slugify("Cañon City, CO")).toBe("canon-city-co");
    expect(slugify("St. Louis, MO")).toBe("st-louis-mo");
  });
});
