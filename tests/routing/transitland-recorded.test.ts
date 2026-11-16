/**
 * TransitlandProvider against recorded real responses. See cassette.ts for
 * how to record. Assertions check properties that must hold for any real
 * timetable, so re-recording on a new date keeps them valid.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchPlaces } from "@/lib/places";
import { transfersOf } from "@/lib/routing/rules";
import { TransitlandClient } from "@/lib/routing/transitland/client";
import {
  TransitlandProvider,
  type KeyValueCache,
} from "@/lib/routing/transitland/provider";
import { otpPlanResponse } from "@/lib/routing/transitland/schema";
import type { Itinerary, PlanRequest, PlanResult } from "@/lib/routing/types";
import { timezoneAt } from "@/lib/time/timezone-at";
import {
  calendarDaysBetween,
  dayOffsetLabel,
  localToInstant,
  zoneAbbreviation,
} from "@/lib/time/zoned";
import {
  type Cassette,
  type Interaction,
  loadCassette,
  RECORDING,
  recordingFetch,
  replayFetch,
  saveCassette,
  upcomingDate,
} from "./cassette";

if (RECORDING) {
  const envFile = path.resolve(__dirname, "../../.env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const API_KEY = process.env.TRANSITLAND_API_KEY ?? "";

interface Candidate {
  from: string;
  to: string;
  mode: PlanRequest["mode"];
  /** Local time; date is filled in at record time. */
  time: string;
}

interface Scenario {
  name: string;
  candidates: Candidate[];
  /** When recording, keep trying candidates until this holds. */
  accept?: (result: PlanResult, cassette: Cassette) => boolean;
}

const place = (label: string) => {
  const p = searchPlaces(label)[0];
  if (!p || p.label !== label) throw new Error(`Place not found: ${label}`);
  return p;
};

function memoryCache(): KeyValueCache {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => (m.get(k) as T) ?? null,
    set: async (k, v) => void m.set(k, v),
  };
}

function providerWith(fetchImpl: typeof fetch) {
  return new TransitlandProvider({
    client: new TransitlandClient({
      apiKey: API_KEY || "replay",
      fetch: fetchImpl,
    }),
    timezoneAt,
    cache: memoryCache(),
  });
}

/** Records (or replays) a scenario; returns null when no cassette exists. */
async function run(
  scenario: Scenario,
): Promise<{ result: PlanResult; cassette: Cassette } | null> {
  if (!RECORDING) {
    const cassette = loadCassette(scenario.name);
    if (!cassette) return null;
    const result = await providerWith(replayFetch(cassette)).plan(
      cassette.request,
    );
    return { result, cassette };
  }

  if (!API_KEY)
    throw new Error("Set TRANSITLAND_API_KEY in .env.local to record");
  const date = upcomingDate(2); // a Tuesday: full weekday service
  for (const c of scenario.candidates) {
    const interactions: Interaction[] = [];
    const request: PlanRequest = {
      from: place(c.from),
      to: place(c.to),
      dateTime: `${date}T${c.time}`,
      mode: c.mode,
    };
    const result = await providerWith(recordingFetch(interactions)).plan(
      request,
    );
    const cassette: Cassette = {
      scenario: scenario.name,
      recordedAt: new Date().toISOString(),
      request,
      interactions,
    };
    if (!scenario.accept || scenario.accept(result, cassette)) {
      saveCassette(cassette, API_KEY);
      return { result, cassette };
    }
    console.warn(
      `[record] ${scenario.name}: ${c.from} -> ${c.to} did not qualify`,
    );
  }
  throw new Error(`[record] ${scenario.name}: no candidate qualified`);
}

/** Raw itineraries from the first plan call in a cassette. */
function rawItineraries(cassette: Cassette) {
  const first = cassette.interactions.find((i) =>
    i.url.includes("/routing/otp/plan"),
  );
  if (!first) return [];
  return otpPlanResponse.parse(JSON.parse(first.body)).plan?.itineraries ?? [];
}

/** Raw itineraries with a change between different operators under 20 min. */
function rawShortCrossOperatorTransfers(cassette: Cassette) {
  return rawItineraries(cassette).filter((it) => {
    const transit = it.legs.filter((l) => l.transitLeg ?? l.mode !== "WALK");
    return transit.some((leg, i) => {
      const next = transit[i + 1];
      if (!next) return false;
      const sameOperator =
        (leg.agencyName ?? "").trim().toLowerCase() ===
        (next.agencyName ?? "").trim().toLowerCase();
      return !sameOperator && (next.startTime - leg.endTime) / 60_000 < 20;
    });
  });
}

/** Hard rules that every returned itinerary must satisfy. */
function expectHardRules(itineraries: Itinerary[]) {
  for (const it of itineraries) {
    for (const leg of it.legs) {
      // Rule 3: provenance and times on every leg.
      expect(leg.mode).toMatch(/^(bus|train|ferry|local|walk)$/);
      expect(leg.fromStop.name).toBeTruthy();
      expect(leg.toStop.name).toBeTruthy();
      expect(Date.parse(leg.start)).toBeLessThanOrEqual(Date.parse(leg.end));
      expect(leg.timezoneStart).toMatch(/^(America|Pacific)\//);
      expect(leg.timezoneEnd).toMatch(/^(America|Pacific)\//);
      if (leg.mode !== "walk") {
        expect(leg.operator).toBeTruthy();
        expect(leg.feedId).toMatch(/^f-/);
        expect(leg.feedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // Booking links are homepages only.
      if (leg.bookingUrl)
        expect(new URL(leg.bookingUrl).pathname.length).toBeLessThan(40);
    }
    // Rule 5: no cross-operator transfer under 20 minutes.
    for (const t of transfersOf(it.legs)) {
      expect(t.minutes).toBeGreaterThanOrEqual(t.crossOperator ? 20 : 0);
      if (t.crossOperator && t.minutes < 45)
        expect(it.flags).toContain("tightConnection");
    }
  }
}

const scenarios = {
  arriveBy: {
    name: "arrive-by",
    candidates: [
      {
        from: "Portland, OR",
        to: "Seattle, WA",
        mode: "arriveBy",
        time: "18:00",
      },
      {
        from: "New York City, NY",
        to: "Philadelphia, PA",
        mode: "arriveBy",
        time: "18:00",
      },
    ],
    accept: (r) => r.status === "ok",
  },
  twoTimezones: {
    name: "two-timezones",
    candidates: [
      {
        from: "Chicago, IL",
        to: "Detroit, MI",
        mode: "leaveAt",
        time: "07:00",
      },
      {
        from: "Chicago, IL",
        to: "Indianapolis, IN",
        mode: "leaveAt",
        time: "07:00",
      },
    ],
    accept: (r) =>
      r.itineraries.some(
        (it) => it.legs[0]!.timezoneStart !== it.legs.at(-1)!.timezoneEnd,
      ),
  },
  midnight: {
    name: "crosses-midnight",
    candidates: [
      {
        from: "Seattle, WA",
        to: "Los Angeles, CA",
        mode: "leaveAt",
        time: "08:00",
      },
      {
        from: "New York City, NY",
        to: "Chicago, IL",
        mode: "leaveAt",
        time: "14:00",
      },
    ],
    accept: (r) =>
      r.itineraries.some(
        (it) =>
          calendarDaysBetween(
            Date.parse(it.departure),
            it.legs[0]!.timezoneStart,
            Date.parse(it.arrival),
            it.legs.at(-1)!.timezoneEnd,
          ) >= 1,
      ),
  },
  shortTransfer: {
    name: "excluded-short-transfer",
    candidates: [
      {
        from: "Vancouver, WA",
        to: "Beaverton, OR",
        mode: "leaveAt",
        time: "08:00",
      },
      {
        from: "Oakland, CA",
        to: "Palo Alto, CA",
        mode: "leaveAt",
        time: "08:00",
      },
      {
        from: "Newark, NJ",
        to: "Brooklyn, NY",
        mode: "leaveAt",
        time: "08:00",
      },
      { from: "Everett, WA", to: "Tacoma, WA", mode: "leaveAt", time: "08:00" },
    ],
    accept: (_, cassette) =>
      rawShortCrossOperatorTransfers(cassette).length > 0,
  },
  noResults: {
    name: "no-results",
    candidates: [
      { from: "Nome, AK", to: "Utqiagvik, AK", mode: "leaveAt", time: "09:00" },
    ],
    accept: (r) => r.status === "noRoutes",
  },
  coastToCoast: {
    name: "coast-to-coast",
    candidates: [
      {
        from: "San Francisco, CA",
        to: "New York City, NY",
        mode: "leaveAt",
        time: "08:00",
      },
    ],
  },
} satisfies Record<string, Scenario>;

const hasCassette = (s: Scenario) => RECORDING || loadCassette(s.name) !== null;
const missing = Object.values(scenarios).filter((s) => !hasCassette(s));
const SLOW = 120_000;

describe("TransitlandProvider (recorded responses)", () => {
  if (missing.length > 0) {
    it.todo(
      `record cassettes: ${missing.map((s) => s.name).join(", ")} (RECORD_TRANSITLAND=1, see tests/routing/cassette.ts)`,
    );
  }

  it.skipIf(!hasCassette(scenarios.arriveBy))(
    "arrive-by: arrives by the deadline, latest departure first",
    async () => {
      const { result, cassette } = (await run(scenarios.arriveBy))!;
      expect(result.status).toBe("ok");
      expect(cassette.interactions[0]!.url).toContain("arriveBy=true");
      const deadline = localToInstant(
        cassette.request.dateTime,
        cassette.request.to.timezone,
      );
      for (const it of result.itineraries) {
        expect(Date.parse(it.arrival)).toBeLessThanOrEqual(deadline);
      }
      const departures = result.itineraries.map((it) =>
        Date.parse(it.departure),
      );
      expect(departures).toEqual([...departures].sort((a, b) => b - a));
      expectHardRules(result.itineraries);
    },
    SLOW,
  );

  it.skipIf(!hasCassette(scenarios.twoTimezones))(
    "two timezones: each end shown in its own zone",
    async () => {
      const { result, cassette } = (await run(scenarios.twoTimezones))!;
      const crossing = result.itineraries.filter(
        (it) => it.legs[0]!.timezoneStart !== it.legs.at(-1)!.timezoneEnd,
      );
      expect(crossing.length).toBeGreaterThan(0);
      const it = crossing[0]!;
      const dep = Date.parse(it.departure);
      const arr = Date.parse(it.arrival);
      expect(it.legs[0]!.timezoneStart).toBe(cassette.request.from.timezone);
      expect(zoneAbbreviation(dep, it.legs[0]!.timezoneStart)).not.toBe(
        zoneAbbreviation(arr, it.legs.at(-1)!.timezoneEnd),
      );
      // "Leave at" is interpreted in the departure place's zone.
      const leaveAt = localToInstant(
        cassette.request.dateTime,
        cassette.request.from.timezone,
      );
      for (const i of result.itineraries) {
        expect(Date.parse(i.departure)).toBeGreaterThanOrEqual(
          leaveAt - 60_000,
        );
      }
      expect(it.durationMinutes).toBe(Math.round((arr - dep) / 60_000));
      expectHardRules(result.itineraries);
    },
    SLOW,
  );

  it.skipIf(!hasCassette(scenarios.midnight))(
    "crosses midnight: +N day is computed per stop zone",
    async () => {
      const { result } = (await run(scenarios.midnight))!;
      const overnight = result.itineraries.filter(
        (it) =>
          calendarDaysBetween(
            Date.parse(it.departure),
            it.legs[0]!.timezoneStart,
            Date.parse(it.arrival),
            it.legs.at(-1)!.timezoneEnd,
          ) >= 1,
      );
      expect(overnight.length).toBeGreaterThan(0);
      const it = overnight[0]!;
      const days = calendarDaysBetween(
        Date.parse(it.departure),
        it.legs[0]!.timezoneStart,
        Date.parse(it.arrival),
        it.legs.at(-1)!.timezoneEnd,
      );
      expect(dayOffsetLabel(days)).toMatch(/^\+\d+ days?$/);
      expectHardRules(result.itineraries);
    },
    SLOW,
  );

  it.skipIf(!hasCassette(scenarios.shortTransfer))(
    "excludes cross-operator transfers under 20 minutes",
    async () => {
      const { result, cassette } = (await run(scenarios.shortTransfer))!;
      const rawShort = rawShortCrossOperatorTransfers(cassette);
      expect(rawShort.length).toBeGreaterThan(0);
      // None of the raw short-transfer itineraries survive.
      for (const raw of rawShort) {
        const key =
          new Date(raw.startTime).toISOString() +
          new Date(raw.endTime).toISOString();
        const survivor = result.itineraries.find(
          (it) =>
            it.departure + it.arrival === key &&
            transfersOf(it.legs).some((t) => t.crossOperator && t.minutes < 20),
        );
        expect(survivor).toBeUndefined();
      }
      expectHardRules(result.itineraries);
    },
    SLOW,
  );

  it.skipIf(!hasCassette(scenarios.noResults))(
    "no results: says so, after trying nearby stations",
    async () => {
      const { result, cassette } = (await run(scenarios.noResults))!;
      expect(result).toEqual({
        status: "noRoutes",
        itineraries: [],
        notes: [],
        provider: "transitland",
      });
      // The station fallback looked for stops near both ends.
      expect(
        cassette.interactions.filter((i) => i.url.includes("/rest/stops")),
      ).toHaveLength(2);
    },
    SLOW,
  );

  it.skipIf(!hasCassette(scenarios.coastToCoast))(
    "coast to coast: well-formed either way (records the limit hit)",
    async () => {
      const { result, cassette } = (await run(scenarios.coastToCoast))!;
      const plan = cassette.interactions.find((i) =>
        i.url.includes("/routing/otp/plan"),
      )!;
      console.info(
        `[coast-to-coast] HTTP ${plan.status}, status=${result.status}, itineraries=${result.itineraries.length}` +
          (result.itineraries[0]
            ? `, first takes ${Math.round(result.itineraries[0].durationMinutes / 60)} h`
            : `, body: ${plan.body.slice(0, 300)}`),
      );
      expectHardRules(result.itineraries);
    },
    SLOW,
  );
});
