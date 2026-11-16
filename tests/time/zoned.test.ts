import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  dayOffsetLabel,
  formatLocalTime,
  isValidTimeZone,
  localDate,
  localToInstant,
  zoneAbbreviation,
} from "@/lib/time/zoned";

const iso = (ms: number) => new Date(ms).toISOString();

describe("localToInstant", () => {
  it("interprets wall time in the given zone", () => {
    expect(iso(localToInstant("2026-11-14T09:00", "America/Los_Angeles"))).toBe(
      "2026-11-14T17:00:00.000Z",
    );
    expect(iso(localToInstant("2026-11-14T09:00", "America/New_York"))).toBe(
      "2026-11-14T14:00:00.000Z",
    );
    expect(iso(localToInstant("2026-07-14T09:00:30", "America/Chicago"))).toBe(
      "2026-07-14T14:00:30.000Z",
    );
  });

  it("handles zones without daylight saving time", () => {
    expect(iso(localToInstant("2026-07-01T12:00", "America/Phoenix"))).toBe(
      "2026-07-01T19:00:00.000Z",
    );
    expect(iso(localToInstant("2026-07-01T12:00", "Pacific/Honolulu"))).toBe(
      "2026-07-01T22:00:00.000Z",
    );
  });

  it("moves a time skipped by spring-forward past the gap", () => {
    // 2026-03-08 02:30 does not exist in New York; clocks jump 02:00 -> 03:00.
    expect(iso(localToInstant("2026-03-08T02:30", "America/New_York"))).toBe(
      "2026-03-08T07:30:00.000Z", // 03:30 EDT
    );
  });

  it("uses the first occurrence of a time repeated by fall-back", () => {
    // 2026-11-01 01:30 happens twice in New York: EDT first, then EST.
    expect(iso(localToInstant("2026-11-01T01:30", "America/New_York"))).toBe(
      "2026-11-01T05:30:00.000Z", // 01:30 EDT
    );
  });

  it("rejects malformed input", () => {
    expect(() =>
      localToInstant("2026-11-14 09:00", "America/New_York"),
    ).toThrow();
    expect(() =>
      localToInstant("2026-11-14T09:00Z", "America/New_York"),
    ).toThrow();
  });
});

describe("calendar days and +N day labels", () => {
  it("counts days in each stop's own zone", () => {
    // Leave Seattle 21:00 PST, arrive Los Angeles 20:30 PST next day.
    const dep = localToInstant("2026-11-14T21:00", "America/Los_Angeles");
    const arr = localToInstant("2026-11-15T20:30", "America/Los_Angeles");
    expect(
      calendarDaysBetween(
        dep,
        "America/Los_Angeles",
        arr,
        "America/Los_Angeles",
      ),
    ).toBe(1);
  });

  it("is not fooled by timezone changes alone", () => {
    // 23:00 Chicago is 00:00 next day in New York, but a trip leaving
    // Chicago at 22:00 and arriving in New York at 23:30 is the same day.
    const dep = localToInstant("2026-11-14T22:00", "America/Chicago");
    const arr = localToInstant("2026-11-14T23:30", "America/New_York");
    expect(
      calendarDaysBetween(dep, "America/Chicago", arr, "America/New_York"),
    ).toBe(0);
    // Leaving New York 23:30 and arriving Chicago 23:45 the same night is
    // also day 0, even though it is past midnight in New York.
    const dep2 = localToInstant("2026-11-14T23:30", "America/New_York");
    const arr2 = localToInstant("2026-11-14T23:45", "America/Chicago");
    expect(
      calendarDaysBetween(dep2, "America/New_York", arr2, "America/Chicago"),
    ).toBe(0);
  });

  it("labels multi-day trips", () => {
    expect(dayOffsetLabel(0)).toBe("");
    expect(dayOffsetLabel(1)).toBe("+1 day");
    expect(dayOffsetLabel(2)).toBe("+2 days");
    expect(dayOffsetLabel(3)).toBe("+3 days");
  });

  it("gives the local calendar date", () => {
    const t = Date.parse("2026-11-15T03:00:00Z");
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-11-14");
    expect(localDate(t, "America/New_York")).toBe("2026-11-14");
    expect(localDate(t, "UTC")).toBe("2026-11-15");
  });
});

describe("zone abbreviations and formatting", () => {
  const winter = Date.parse("2026-01-15T18:00:00Z");
  const summer = Date.parse("2026-07-15T18:00:00Z");

  it.each([
    ["America/Los_Angeles", "PST", "PDT"],
    ["America/Denver", "MST", "MDT"],
    ["America/Phoenix", "MST", "MST"],
    ["America/Chicago", "CST", "CDT"],
    ["America/New_York", "EST", "EDT"],
    ["America/Anchorage", "AKST", "AKDT"],
    ["Pacific/Honolulu", "HST", "HST"],
  ])("%s -> %s / %s", (zone, w, s) => {
    expect(zoneAbbreviation(winter, zone)).toBe(w);
    expect(zoneAbbreviation(summer, zone)).toBe(s);
  });

  it("formats a time with its zone", () => {
    const t = Date.parse("2026-11-14T17:05:00Z");
    expect(formatLocalTime(t, "America/Los_Angeles")).toBe("9:05 AM PST");
    expect(formatLocalTime(t, "America/New_York")).toBe("12:05 PM EST");
  });

  it("validates zone ids", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
