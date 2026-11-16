/**
 * Control-flow tests for TransitlandProvider with small hand-built responses
 * in the documented response shape. These check our logic (air filtering,
 * feed lookup, station fallback), not real timetables; real behaviour is
 * covered by transitland-recorded.test.ts.
 */
import { describe, expect, it } from "vitest";
import { searchPlaces } from "@/lib/places";
import { ProviderUnavailableError } from "@/lib/routing/provider";
import { TransitlandClient } from "@/lib/routing/transitland/client";
import { TransitlandProvider } from "@/lib/routing/transitland/provider";
import type { PlanRequest } from "@/lib/routing/types";

const springfield = searchPlaces("Springfield, IL")[0]!;
const chicago = searchPlaces("Chicago, IL")[0]!;
const T0 = Date.parse("2026-11-17T14:00:00Z"); // 08:00 CST

const request: PlanRequest = {
  from: springfield,
  to: chicago,
  dateTime: "2026-11-17T07:30",
  mode: "leaveAt",
};

function otpLeg(o: {
  mode: string;
  routeType?: number;
  agency?: string;
  start: number;
  minutes: number;
  sha?: string;
}) {
  const transit = o.mode !== "WALK";
  return {
    mode: o.mode,
    transitLeg: transit,
    routeType: o.routeType,
    agencyName: o.agency,
    routeShortName: transit ? "Lincoln Service" : undefined,
    feedVersionSha1: o.sha,
    startTime: o.start,
    endTime: o.start + o.minutes * 60_000,
    from: {
      name: "A",
      lat: 39.8,
      lon: -89.65,
      stopId: transit ? "spi" : undefined,
    },
    to: {
      name: "B",
      lat: 41.88,
      lon: -87.64,
      stopId: transit ? "chi" : undefined,
    },
  };
}

function itin(legs: ReturnType<typeof otpLeg>[]) {
  return {
    startTime: legs[0]!.startTime,
    endTime: legs.at(-1)!.endTime,
    legs,
  };
}

const train = (start: number, sha = "sha-amtrak") =>
  otpLeg({
    mode: "RAIL",
    routeType: 2,
    agency: "Amtrak",
    start,
    minutes: 210,
    sha,
  });

type Handler = (url: URL) => unknown;

type ZoneLookup = (lat: number, lon: number, fallback: string) => string;

function provider(
  handler: Handler,
  timezoneAt: ZoneLookup = (lat) => (lat > 0 ? "America/Chicago" : "UTC"),
) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const body = handler(url);
    return body instanceof Response ? body : Response.json(body);
  }) as typeof fetch;
  const p = new TransitlandProvider({
    client: new TransitlandClient({ apiKey: "k", fetch: fetchImpl }),
    timezoneAt,
  });
  return { p, calls };
}

const feedVersion = (url: URL) => ({
  feed_versions: [
    {
      sha1: url.searchParams.get("sha1"),
      fetched_at: "2026-11-02T03:04:05Z",
      feed: {
        onestop_id: "f-9-amtrak~amtrakcalifornia~amtrakcharteredvehicle",
      },
    },
  ],
});

describe("TransitlandProvider flow", () => {
  it("sends documented parameters and maps a train trip", async () => {
    const { p, calls } = provider((url) =>
      url.pathname.endsWith("/plan")
        ? { plan: { itineraries: [itin([train(T0)])] } }
        : feedVersion(url),
    );
    const result = await p.plan(request);

    const plan = calls[0]!;
    expect(Object.fromEntries(plan.searchParams)).toMatchObject({
      fromPlace: `${springfield.lat},${springfield.lon}`,
      toPlace: `${chicago.lat},${chicago.lon}`,
      date: "2026-11-17",
      time: "07:30:00",
      arriveBy: "false",
      useFallbackDates: "false",
      maxItineraries: "10",
    });
    expect(result.status).toBe("ok");
    expect(result.itineraries[0]!.legs[0]).toMatchObject({
      mode: "train",
      operator: "Amtrak",
      routeName: "Lincoln Service",
      feedId: "f-9-amtrak~amtrakcalifornia~amtrakcharteredvehicle",
      feedDate: "2026-11-02",
      bookingUrl: "https://www.amtrak.com/",
      timezoneStart: "America/Chicago",
    });
  });

  it("looks each feed version up once", async () => {
    const { p, calls } = provider((url) =>
      url.pathname.endsWith("/plan")
        ? {
            plan: {
              itineraries: [itin([train(T0)]), itin([train(T0 + 3600_000)])],
            },
          }
        : feedVersion(url),
    );
    await p.plan(request);
    expect(
      calls.filter((c) => c.pathname.endsWith("/feed_versions")),
    ).toHaveLength(1);
  });

  it("drops itineraries with an air leg or unscheduled mode", async () => {
    const { p } = provider((url) =>
      url.pathname.endsWith("/plan")
        ? {
            plan: {
              itineraries: [
                itin([
                  otpLeg({
                    mode: "AIRPLANE",
                    routeType: 1100,
                    agency: "Air Co",
                    start: T0,
                    minutes: 60,
                    sha: "s",
                  }),
                ]),
                itin([
                  otpLeg({
                    mode: "TAXI",
                    routeType: 1500,
                    agency: "Cab",
                    start: T0,
                    minutes: 60,
                    sha: "s",
                  }),
                ]),
                itin([train(T0 + 7200_000)]),
              ],
            },
          }
        : feedVersion(url),
    );
    const result = await p.plan(request);
    expect(result.itineraries).toHaveLength(1);
    expect(result.itineraries[0]!.legs.every((l) => l.mode !== "walk")).toBe(
      true,
    );
  });

  it("fails rather than show legs without a feed date", async () => {
    const { p } = provider((url) =>
      url.pathname.endsWith("/plan")
        ? { plan: { itineraries: [itin([train(T0)])] } }
        : { feed_versions: [] },
    );
    await expect(p.plan(request)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("retries from the nearest station within 40 km and adds a note", async () => {
    let planCalls = 0;
    const { p, calls } = provider((url) => {
      if (url.pathname.endsWith("/plan")) {
        planCalls++;
        return planCalls === 1
          ? { plan: { itineraries: [] } }
          : { plan: { itineraries: [itin([train(T0)])] } };
      }
      if (url.pathname.endsWith("/stops")) {
        const [minLon, minLat, maxLon, maxLat] = url.searchParams
          .get("bbox")!
          .split(",")
          .map(Number);
        const lat = (minLat! + maxLat!) / 2;
        const lon = (minLon! + maxLon!) / 2;
        return {
          stops: [
            {
              stop_id: "far",
              stop_name: "Far Station",
              geometry: { type: "Point", coordinates: [lon + 0.45, lat] },
            }, // ~38 km
            {
              stop_id: "near",
              stop_name: "Union Station",
              geometry: {
                type: "Point",
                coordinates: [lon + 0.02, lat + 0.01],
              },
            },
            {
              stop_id: "outside",
              stop_name: "Corner",
              geometry: { type: "Point", coordinates: [lon + 0.45, lat + 0.3] },
            }, // > 40 km
          ],
        };
      }
      return feedVersion(url);
    });
    const result = await p.plan(request);

    expect(result.status).toBe("ok");
    expect(result.notes.map((n) => [n.end, n.stationName])).toEqual([
      ["from", "Union Station"],
      ["to", "Union Station"],
    ]);
    expect(result.notes[0]!.message).toMatch(
      /Springfield, IL.*Union Station.*km away/,
    );
    const stops = calls.filter((c) => c.pathname.endsWith("/stops"));
    expect(stops).toHaveLength(2);
    expect(stops[0]!.searchParams.get("served_by_route_types")).toContain(
      "2,4,",
    );
    // The retry plans from the station, not the city centre.
    const retry = calls.filter((c) => c.pathname.endsWith("/plan"))[1]!;
    expect(retry.searchParams.get("fromPlace")).not.toBe(
      `${springfield.lat},${springfield.lon}`,
    );
  });

  it("returns noRoutes when there is no station nearby either", async () => {
    const { p, calls } = provider((url) =>
      url.pathname.endsWith("/plan")
        ? { plan: { itineraries: [] } }
        : { stops: [] },
    );
    expect((await p.plan(request)).status).toBe("noRoutes");
    expect(calls.filter((c) => c.pathname.endsWith("/plan"))).toHaveLength(1);
  });

  it("treats an OTP-style error body with no itineraries as no routes", async () => {
    const { p } = provider((url) =>
      url.pathname.endsWith("/plan")
        ? { error: { id: 404, msg: "PATH_NOT_FOUND" } }
        : { stops: [] },
    );
    expect((await p.plan(request)).status).toBe("noRoutes");
  });

  it("rejects responses that do not match the documented shape", async () => {
    const { p } = provider(() => ({
      plan: { itineraries: [{ legs: "nope" }] },
    }));
    await expect(p.plan(request)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("uses the city's own timezone for the trip's start and end points", async () => {
    const walkIn = {
      ...otpLeg({ mode: "WALK", start: T0 - 600_000, minutes: 10 }),
      from: {
        name: "Origin",
        lat: springfield.lat,
        lon: springfield.lon,
        stopId: undefined,
      },
    };
    const walkOut = {
      ...otpLeg({ mode: "WALK", start: T0 + 210 * 60_000, minutes: 10 }),
      to: {
        name: "Destination",
        lat: chicago.lat,
        lon: chicago.lon,
        stopId: undefined,
      },
    };
    const lookups: [number, number][] = [];
    const { p } = provider(
      (url) =>
        url.pathname.endsWith("/plan")
          ? { plan: { itineraries: [itin([walkIn, train(T0), walkOut])] } }
          : feedVersion(url),
      (lat, lon) => {
        lookups.push([lat, lon]);
        return "America/Indiana/Knox"; // marker: came from a coordinate lookup
      },
    );
    const legs = (await p.plan(request)).itineraries[0]!.legs;
    expect(legs[0]!.fromStop.name).toBe("Springfield, IL");
    expect(legs[0]!.timezoneStart).toBe(springfield.timezone); // city point
    expect(legs[1]!.timezoneStart).toBe("America/Indiana/Knox"); // a stop
    expect(legs[2]!.timezoneEnd).toBe(chicago.timezone); // city point
    expect(lookups).not.toContainEqual([springfield.lat, springfield.lon]);
  });
});
