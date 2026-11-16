import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchPlaces } from "@/lib/places";
import type { PlanResult } from "@/lib/routing/types";
import { itinerary, leg } from "../routing/helpers";

const planTrip = vi.fn();
const checkPlanRateLimit = vi.fn();
const captureServerEvent = vi.fn();

vi.mock("@/lib/routing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/routing")>()),
  planTrip: (...args: unknown[]) => planTrip(...args),
}));
vi.mock("@/lib/routing/infra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/routing/infra")>()),
  checkPlanRateLimit: (...args: unknown[]) => checkPlanRateLimit(...args),
  log: () => {},
}));

vi.mock("@/lib/analytics/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/server")>()),
  captureServerEvent: (...args: unknown[]) => captureServerEvent(...args),
}));

const { POST } = await import("@/app/api/plan/route");
const { ProviderQuotaError, ProviderUnavailableError } =
  await import("@/lib/routing");

const portland = searchPlaces("Portland, OR")[0]!;
const seattle = searchPlaces("Seattle, WA")[0]!;

/** A local time two days from now, so it passes the date range check. */
function soon(hour = "09:00") {
  const d = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  return `${d}T${hour}`;
}

function post(body: unknown, ip = "203.0.113.7") {
  return POST(
    new NextRequest("http://localhost/api/plan", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

const okResult: PlanResult = {
  status: "noRoutes",
  itineraries: [],
  notes: [],
  provider: "transitland",
};

beforeEach(() => {
  planTrip.mockReset().mockResolvedValue({ result: okResult, cacheHit: false });
  captureServerEvent.mockReset().mockResolvedValue(true);
  checkPlanRateLimit
    .mockReset()
    .mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("POST /api/plan", () => {
  it("validates and passes a server-side copy of each place", async () => {
    const res = await post({
      // Client-supplied coordinates are ignored; only the id is used.
      from: { ...portland, lat: 0, lon: 0 },
      to: { id: seattle.id },
      dateTime: soon(),
      mode: "arriveBy",
    });
    expect(res.status).toBe(200);
    // The cache flag is for analytics only, not part of the API response.
    expect(await res.json()).toEqual(okResult);
    const [request] = planTrip.mock.calls[0]!;
    expect(request.from.lat).toBe(portland.lat);
    expect(request.to.timezone).toBe("America/Los_Angeles");
    expect(request.mode).toBe("arriveBy");
  });

  it.each([
    [
      "missing mode",
      { from: { id: 1 }, to: { id: 2 }, dateTime: "2026-11-14T09:00" },
    ],
    [
      "bad mode",
      {
        from: { id: 1 },
        to: { id: 2 },
        dateTime: "2026-11-14T09:00",
        mode: "now",
      },
    ],
    [
      "UTC time",
      {
        from: { id: 1 },
        to: { id: 2 },
        dateTime: "2026-11-14T09:00Z",
        mode: "leaveAt",
      },
    ],
    [
      "offset time",
      {
        from: { id: 1 },
        to: { id: 2 },
        dateTime: "2026-11-14T09:00-08:00",
        mode: "leaveAt",
      },
    ],
    [
      "impossible date",
      {
        from: { id: 1 },
        to: { id: 2 },
        dateTime: "2026-02-30T09:00",
        mode: "leaveAt",
      },
    ],
    [
      "no place id",
      {
        from: {},
        to: { id: 2 },
        dateTime: "2026-11-14T09:00",
        mode: "leaveAt",
      },
    ],
  ])("rejects %s", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe("invalid");
    expect(planTrip).not.toHaveBeenCalled();
  });

  it("rejects non-JSON, unknown places, same place, and far-off dates", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect(
      (
        await post({
          from: { id: 999999999 },
          to: { id: seattle.id },
          dateTime: soon(),
          mode: "leaveAt",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          from: { id: portland.id },
          to: { id: portland.id },
          dateTime: soon(),
          mode: "leaveAt",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          from: { id: portland.id },
          to: { id: seattle.id },
          dateTime: "2020-01-01T09:00",
          mode: "leaveAt",
        })
      ).status,
    ).toBe(400);
    expect(planTrip).not.toHaveBeenCalled();
  });

  const valid = () => ({
    from: { id: portland.id },
    to: { id: seattle.id },
    dateTime: soon(),
    mode: "leaveAt",
  });

  it("rate limits per IP with Retry-After", async () => {
    checkPlanRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const res = await post(valid(), "198.51.100.1");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect((await res.json()).status).toBe("rateLimited");
    expect(checkPlanRateLimit).toHaveBeenCalledWith("198.51.100.1");
    expect(planTrip).not.toHaveBeenCalled();
  });

  it("returns a clear busy state when the provider quota is exhausted", async () => {
    planTrip.mockRejectedValue(new ProviderQuotaError("quota", 60));
    const res = await post(valid());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toMatchObject({
      status: "busy",
      retryAfterSeconds: 60,
    });
  });

  it("returns unavailable when the provider fails", async () => {
    planTrip.mockRejectedValue(new ProviderUnavailableError("down"));
    const res = await post(valid());
    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe("unavailable");
  });

  describe("server-side analytics", () => {
    const withResults: PlanResult = {
      status: "ok",
      itineraries: [
        itinerary(
          [leg("walk", "08:00", "08:10"), leg("train", "08:10", "11:00")],
          "a",
        ),
        itinerary(
          [leg("bus", "09:00", "11:30"), leg("ferry", "11:40", "11:50")],
          "b",
        ),
      ],
      notes: [],
      provider: "transitland",
    };

    it("sends results_shown with aggregates only, joined to the visitor's ids", async () => {
      planTrip.mockResolvedValue({ result: withResults, cacheHit: true });
      const res = await POST(
        new NextRequest("http://localhost/api/plan", {
          method: "POST",
          body: JSON.stringify(valid()),
          headers: {
            "content-type": "application/json",
            "x-posthog-distinct-id": "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
            "x-posthog-session-id": "0193a1b2-aaaa-7e5f-8a9b-0c1d2e3f4a5b",
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(captureServerEvent).toHaveBeenCalledTimes(1);
      const [event, props, identity] = captureServerEvent.mock.calls[0]!;
      expect(event).toBe("results_shown");
      expect(props).toEqual({
        option_count: 2,
        fastest_minutes: 170,
        modes_present: ["walk", "bus", "train", "ferry"],
        cache_hit: true,
      });
      expect(identity).toEqual({
        distinctId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        sessionId: "0193a1b2-aaaa-7e5f-8a9b-0c1d2e3f4a5b",
      });
    });

    it("sends no_results with city and state names only", async () => {
      await post(valid());
      expect(captureServerEvent).toHaveBeenCalledWith(
        "no_results",
        {
          from_city: "Portland",
          from_state: "OR",
          to_city: "Seattle",
          to_state: "WA",
        },
        expect.objectContaining({ sessionId: null }),
      );
      const props = JSON.stringify(captureServerEvent.mock.calls[0]![1]);
      expect(props).not.toMatch(/lat|lon|\d+\.\d{3}/);
    });

    it.each([
      [new ProviderQuotaError("quota", 60), "quota", 503],
      [new ProviderUnavailableError("down"), "unavailable", 502],
    ])("sends provider_error %#", async (err, type, status) => {
      planTrip.mockRejectedValue(err);
      expect((await post(valid())).status).toBe(status);
      expect(captureServerEvent).toHaveBeenCalledWith(
        "provider_error",
        { type },
        expect.anything(),
      );
    });

    it("sends provider_error unexpected and still fails", async () => {
      planTrip.mockRejectedValue(new Error("boom"));
      await expect(post(valid())).rejects.toThrow("boom");
      expect(captureServerEvent).toHaveBeenCalledWith(
        "provider_error",
        { type: "unexpected" },
        expect.anything(),
      );
    });

    it("sends nothing for invalid or rate-limited requests", async () => {
      await post("{nope");
      checkPlanRateLimit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 5,
      });
      await post(valid());
      expect(captureServerEvent).not.toHaveBeenCalled();
    });
  });
});
