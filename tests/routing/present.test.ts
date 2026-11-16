import { describe, expect, it } from "vitest";
import {
  bookingLegIndexes,
  formatDuration,
  formatFeedDate,
  formatTransfers,
  latestOnTimeDeparture,
  parseSortKey,
  routeSegments,
  schedulesAsOf,
  sortForDisplay,
  spareMinutes,
  transferDetails,
} from "@/lib/routing/present";
import { itinerary, leg } from "./helpers";

// a: leaves 08:00, arrives 13:00 (5 h, direct)
// b: leaves 09:00, arrives 12:00 (3 h, 1 transfer)
// c: leaves 10:00, arrives 12:30 (2.5 h, 2 transfers)
const a = itinerary([leg("train", "08:00", "13:00")], "a");
const b = itinerary(
  [
    leg("bus", "09:00", "10:00", { operator: "Greyhound", to: "X" }),
    leg("train", "10:30", "12:00", { from: "X" }),
  ],
  "b",
);
const c = itinerary(
  [
    leg("local", "10:00", "10:30", { operator: "TriMet", to: "X" }),
    leg("bus", "10:40", "11:00", { operator: "Greyhound", from: "X", to: "Y" }),
    leg("train", "11:05", "12:30", { from: "Y" }),
  ],
  "c",
);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("sortForDisplay", () => {
  it("earliest arrival", () => {
    expect(ids(sortForDisplay([a, b, c], "arrival"))).toEqual(["b", "c", "a"]);
  });
  it("shortest total time", () => {
    expect(ids(sortForDisplay([a, b, c], "duration"))).toEqual(["c", "b", "a"]);
  });
  it("fewest transfers", () => {
    expect(ids(sortForDisplay([a, b, c], "transfers"))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("does not mutate its input", () => {
    const input = [a, b, c];
    sortForDisplay(input, "duration");
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
  it("parses unknown sort keys as earliest arrival", () => {
    expect(parseSortKey("duration")).toBe("duration");
    expect(parseSortKey("cheapest")).toBe("arrival");
    expect(parseSortKey(null)).toBe("arrival");
  });
});

describe("arrive-by helpers", () => {
  const deadline = Date.parse("2026-11-14T12:45:00.000Z");

  it("computes minutes to spare", () => {
    expect(spareMinutes(b, deadline)).toBe(45);
    expect(spareMinutes(c, deadline)).toBe(15);
    expect(spareMinutes(a, deadline)).toBe(-15);
  });

  it("picks the latest departure that is still on time", () => {
    expect(latestOnTimeDeparture([a, b, c], deadline)?.id).toBe("c");
    // With a tighter deadline, c (arrives 12:30) is late; b is the answer.
    expect(
      latestOnTimeDeparture([a, b, c], Date.parse("2026-11-14T12:15:00.000Z"))
        ?.id,
    ).toBe("b");
    expect(
      latestOnTimeDeparture([a, b, c], Date.parse("2026-11-14T11:00:00.000Z")),
    ).toBeNull();
  });
});

describe("routeSegments", () => {
  it("has one segment per leg, sized by duration", () => {
    const segs = routeSegments(b);
    expect(segs.map((s) => s.mode)).toEqual(["bus", "train"]);
    expect(segs.map((s) => s.minutes)).toEqual([60, 90]);
    expect(segs[0]!.fraction).toBeCloseTo(0.4);
    expect(segs[1]!.fraction).toBeCloseTo(0.6);
  });
});

describe("transferDetails", () => {
  it("reports each wait, the walk inside it, and tight cross-operator changes", () => {
    const withWalk = itinerary([
      leg("bus", "09:00", "10:00", { operator: "Greyhound", to: "Bus stop" }),
      leg("walk", "10:00", "10:08", { from: "Bus stop", to: "Station" }),
      leg("train", "10:30", "12:00", { operator: "Amtrak", from: "Station" }),
    ]);
    expect(transferDetails(withWalk)).toEqual([
      {
        afterLeg: 0,
        beforeLeg: 2,
        waitMinutes: 30,
        walkMinutes: 8,
        stopName: "Bus stop",
        fromOperator: "Greyhound",
        toOperator: "Amtrak",
        tight: true,
      },
    ]);
  });

  it("does not flag changes within one operator", () => {
    const same = itinerary([
      leg("train", "09:00", "10:00", { to: "X" }),
      leg("train", "10:10", "12:00", { from: "X" }),
    ]);
    expect(transferDetails(same)[0]!.tight).toBe(false);
  });
});

describe("schedules and booking", () => {
  it("reports the oldest feed date the trip relies on", () => {
    const mixed = itinerary([
      leg("bus", "09:00", "10:00", { feedDate: "2026-11-05" }),
      leg("walk", "10:00", "10:05"),
      leg("train", "10:30", "12:00", { feedDate: "2026-10-28" }),
    ]);
    expect(schedulesAsOf(mixed)).toBe("2026-10-28");
    expect(formatFeedDate("2026-10-28")).toBe("Oct 28, 2026");
  });

  it("shows one booking button per operator", () => {
    const legs = [
      leg("train", "08:00", "09:00", { bookingUrl: "https://www.amtrak.com/" }),
      leg("bus", "09:30", "10:00", { operator: "TriMet", bookingUrl: null }),
      leg("train", "10:30", "11:00", { bookingUrl: "https://www.amtrak.com/" }),
    ];
    expect([...bookingLegIndexes(legs)]).toEqual([0]);
  });
});

describe("formatting", () => {
  it.each([
    [45, "45 min"],
    [60, "1 h"],
    [575, "9 h 35 min"],
    [1440, "1 d"],
    [3060, "2 d 3 h"],
  ])("%i min -> %s", (m, s) => expect(formatDuration(m)).toBe(s));

  it("describes transfers", () => {
    expect(formatTransfers(0)).toBe("Direct");
    expect(formatTransfers(1)).toBe("1 transfer");
    expect(formatTransfers(3)).toBe("3 transfers");
  });
});
