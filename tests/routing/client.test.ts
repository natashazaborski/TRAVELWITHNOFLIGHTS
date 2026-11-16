import { describe, expect, it, vi } from "vitest";
import { planCacheKey, timeBucket } from "@/lib/routing/infra";
import {
  ProviderQuotaError,
  ProviderUnavailableError,
} from "@/lib/routing/provider";
import {
  TransitlandClient,
  type UsageEvent,
} from "@/lib/routing/transitland/client";
import type { PlanRequest } from "@/lib/routing/types";

function clientWith(response: Response, onUsage?: (e: UsageEvent) => void) {
  // Typed so mock.calls carries (url, init) for the assertions below.
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(async () => response);
  const client = new TransitlandClient({
    apiKey: "test-key",
    fetch: fetchMock as unknown as typeof fetch,
    onUsage,
  });
  return { client, fetchMock };
}

describe("TransitlandClient", () => {
  it("sends the key as a header, never in the URL", async () => {
    const { client, fetchMock } = clientWith(Response.json({ plan: {} }));
    await client.plan({ fromPlace: "1,2", toPlace: "3,4", arriveBy: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://transit.land/api/v2/routing/otp/plan?fromPlace=1%2C2&toPlace=3%2C4&arriveBy=true",
    );
    expect(url).not.toContain("test-key");
    expect((init?.headers as Record<string, string>).apikey).toBe("test-key");
  });

  it("reports usage: 2 routing units per plan, 1 per REST call", async () => {
    const events: UsageEvent[] = [];
    const { client } = clientWith(
      Response.json({}, { headers: { "x-ratelimit-remaining": "41" } }),
      (e) => void events.push(e),
    );
    await client.plan({});
    expect(events[0]).toEqual({
      kind: "routing",
      units: 2,
      status: 200,
      quotaHeaders: { "x-ratelimit-remaining": "41" },
    });
  });

  it.each([
    [429, "", true],
    [402, "", true],
    [403, "Monthly quota exceeded", true],
    [403, "Forbidden", false],
  ])("status %i %j -> quota error: %s", async (status, body, isQuota) => {
    const { client } = clientWith(
      new Response(body, { status, headers: { "retry-after": "30" } }),
    );
    const err = await client.plan({}).catch((e: unknown) => e);
    if (isQuota) {
      expect(err).toBeInstanceOf(ProviderQuotaError);
      expect((err as ProviderQuotaError).retryAfterSeconds).toBe(30);
    } else {
      expect(err).toBeInstanceOf(ProviderUnavailableError);
    }
  });

  it("wraps network failures and server errors", async () => {
    const failing = new TransitlandClient({
      apiKey: "k",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(failing.plan({})).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    const { client } = clientWith(new Response("oops", { status: 500 }));
    await expect(client.plan({})).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("refuses to start without a key", () => {
    expect(() => new TransitlandClient({ apiKey: "" })).toThrow(
      ProviderUnavailableError,
    );
  });
});

describe("plan cache key", () => {
  const place = (lat: number, lon: number) => ({
    id: 1,
    name: "X",
    state: "OR",
    lat,
    lon,
    population: 1,
    timezone: "America/Los_Angeles",
  });
  const req = (
    dateTime: string,
    mode: PlanRequest["mode"] = "leaveAt",
  ): PlanRequest => ({
    from: place(45.52345, -122.67621),
    to: place(47.60621, -122.33207),
    dateTime,
    mode,
  });

  it("rounds places and floors time to 15 minutes", () => {
    expect(planCacheKey("transitland", req("2026-11-14T09:52"))).toBe(
      "plan:v1:transitland:45.52,-122.68:47.61,-122.33:leaveAt:2026-11-14T09:45",
    );
  });

  it("shares a key within a bucket and splits across buckets and modes", () => {
    const k = (d: string, m?: PlanRequest["mode"]) =>
      planCacheKey("transitland", req(d, m));
    expect(k("2026-11-14T09:45")).toBe(k("2026-11-14T09:59"));
    expect(k("2026-11-14T09:44")).not.toBe(k("2026-11-14T09:45"));
    expect(k("2026-11-14T09:45")).not.toBe(k("2026-11-14T09:45", "arriveBy"));
  });

  it.each([
    ["2026-11-14T00:00", "2026-11-14T00:00"],
    ["2026-11-14T00:14", "2026-11-14T00:00"],
    ["2026-11-14T23:59:59", "2026-11-14T23:45"],
  ])("timeBucket(%s) = %s", (input, expected) => {
    expect(timeBucket(input)).toBe(expected);
  });
});
