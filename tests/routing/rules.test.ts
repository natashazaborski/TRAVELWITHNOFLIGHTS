import { describe, expect, it } from "vitest";
import {
  applyTransferRules,
  dedupeItineraries,
  finalizeItineraries,
  sortItineraries,
  transfersOf,
} from "@/lib/routing/rules";
import { itinerary, leg } from "./helpers";

const busThenTrain = (gapEnd: string, gapStart: string, sameOperator = false) =>
  itinerary([
    leg("bus", "08:00", gapEnd, {
      operator: sameOperator ? "Amtrak" : "Greyhound",
      from: "A",
      to: "B",
    }),
    leg("walk", gapEnd, gapEnd, { from: "B", to: "B2" }),
    leg("train", gapStart, "12:00", {
      operator: "Amtrak",
      from: "B2",
      to: "C",
    }),
  ]);

describe("transfer rules (CLAUDE.md rule 5)", () => {
  it("measures transfers between transit legs, skipping walks", () => {
    const [t] = transfersOf(busThenTrain("09:00", "09:30").legs);
    expect(t).toMatchObject({
      fromLeg: 0,
      toLeg: 2,
      minutes: 30,
      crossOperator: true,
    });
  });

  it.each([
    ["19 min", "09:19", null],
    ["20 min", "09:20", ["tightConnection"]],
    ["44 min", "09:44", ["tightConnection"]],
    ["45 min", "09:45", []],
    ["2 h", "11:00", []],
  ])("different operators, %s", (_, start, flags) => {
    const result = applyTransferRules(busThenTrain("09:00", start));
    if (flags === null) expect(result).toBeNull();
    else expect(result?.flags).toEqual(flags);
  });

  it("does not limit transfers within one operator", () => {
    expect(
      applyTransferRules(busThenTrain("09:00", "09:05", true))?.flags,
    ).toEqual([]);
  });

  it("treats operator names case-insensitively", () => {
    const it1 = itinerary([
      leg("train", "08:00", "09:00", { operator: "Amtrak" }),
      leg("train", "09:05", "10:00", { operator: "AMTRAK " }),
    ]);
    expect(applyTransferRules(it1)?.flags).toEqual([]);
  });

  it("excludes impossible connections", () => {
    expect(applyTransferRules(busThenTrain("09:30", "09:00", true))).toBeNull();
  });

  it("checks every transfer, not just the first", () => {
    const it1 = itinerary([
      leg("train", "06:00", "07:00", { operator: "Amtrak" }),
      leg("bus", "08:00", "09:00", { operator: "Greyhound" }), // 60 min: fine
      leg("ferry", "09:10", "10:00", { operator: "Washington State Ferries" }), // 10 min
    ]);
    expect(applyTransferRules(it1)).toBeNull();
  });
});

describe("dedupeItineraries", () => {
  const base = (dep: string, arr: string, id: string, extraWalk = false) =>
    itinerary(
      [
        ...(extraWalk
          ? [leg("walk", "07:50", dep, { from: "X", to: "A" })]
          : []),
        leg("train", dep, arr, { from: "A", to: "B" }),
      ],
      id,
    );

  it("collapses the same vehicles a few minutes apart, keeping the shortest", () => {
    const result = dedupeItineraries([
      base("08:00", "12:00", "plain"),
      base("08:00", "12:00", "with-walk", true),
    ]);
    expect(result.map((i) => i.id)).toEqual(["plain"]);
  });

  it("keeps the same route at different times", () => {
    const result = dedupeItineraries([
      base("08:00", "12:00", "early"),
      base("10:00", "14:00", "late"),
    ]);
    expect(result).toHaveLength(2);
  });

  it("keeps different routes at the same time", () => {
    const other = itinerary(
      [leg("bus", "08:00", "12:00", { operator: "Greyhound" })],
      "bus",
    );
    expect(
      dedupeItineraries([base("08:00", "12:00", "train"), other]),
    ).toHaveLength(2);
  });
});

describe("sorting and request window", () => {
  const a = itinerary([leg("train", "08:00", "13:00")], "a"); // leaves early, arrives late
  const b = itinerary(
    [leg("bus", "09:00", "12:00", { operator: "Greyhound" })],
    "b",
  );
  const c = itinerary([leg("train", "10:00", "12:30", { from: "Q" })], "c");

  it("leaveAt: earliest arrival first", () => {
    expect(sortItineraries([a, b, c], "leaveAt").map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("arriveBy: latest departure first", () => {
    expect(sortItineraries([a, b, c], "arriveBy").map((i) => i.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("drops trips leaving before a leaveAt time", () => {
    const at = Date.parse("2026-11-14T08:30:00Z");
    expect(
      finalizeItineraries([a, b, c], "leaveAt", at).map((i) => i.id),
    ).toEqual(["b", "c"]);
  });

  it("drops trips arriving after an arriveBy deadline", () => {
    const by = Date.parse("2026-11-14T12:15:00Z");
    expect(
      finalizeItineraries([a, b, c], "arriveBy", by).map((i) => i.id),
    ).toEqual(["b"]);
  });
});
