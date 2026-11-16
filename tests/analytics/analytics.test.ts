import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyticsHeaders,
  resetAnalyticsForTests,
  setAnalyticsClient,
  track,
} from "@/lib/analytics/client";
import {
  analyticsRewrites,
  ANALYTICS_PROXY_PATH,
  posthogHosts,
} from "@/lib/analytics/config";
import {
  distinctModes,
  itineraryExpandedProps,
  noResultsProps,
  resultsShownProps,
  searchSubmittedProps,
} from "@/lib/analytics/events";
import { isProjectToken } from "@/lib/analytics/init";
import { captureServerEvent, identityFrom } from "@/lib/analytics/server";
import { itinerary, leg } from "../routing/helpers";

const portland = { name: "Portland", state: "OR", lat: 45.52, lon: -122.68 };
const seattle = { name: "Seattle", state: "WA", lat: 47.61, lon: -122.33 };

describe("event properties", () => {
  it("search_submitted carries city and state names, never coordinates", () => {
    const now = Date.parse("2026-11-15T10:00:00Z");
    const props = searchSubmittedProps(
      portland,
      seattle,
      "arriveBy",
      now + 5.26 * 3600_000,
      now,
    );
    expect(props).toEqual({
      from_city: "Portland",
      from_state: "OR",
      to_city: "Seattle",
      to_state: "WA",
      mode: "arriveBy",
      hours_until_trip: 5.3,
    });
    expect(Object.keys(props)).not.toContain("lat");
  });

  it("hours_until_trip is negative for a time already passed", () => {
    const now = Date.parse("2026-11-15T10:00:00Z");
    expect(
      searchSubmittedProps(portland, seattle, "leaveAt", now - 1800_000, now)
        .hours_until_trip,
    ).toBe(-0.5);
  });

  it("no_results keeps only names", () => {
    expect(noResultsProps(portland, seattle)).toEqual({
      from_city: "Portland",
      from_state: "OR",
      to_city: "Seattle",
      to_state: "WA",
    });
  });

  const its = [
    itinerary(
      [
        leg("walk", "08:00", "08:05"),
        leg("bus", "08:05", "10:00"),
        leg("train", "10:30", "12:00"),
      ],
      "a",
    ),
    itinerary([leg("ferry", "09:00", "10:00")], "b"),
  ];

  it("modes are distinct and in a fixed order", () => {
    expect(distinctModes(its)).toEqual(["walk", "bus", "train", "ferry"]);
  });

  it("results_shown summarises the whole result", () => {
    expect(
      resultsShownProps(
        { status: "ok", itineraries: its, notes: [], provider: "x" },
        false,
      ),
    ).toEqual({
      option_count: 2,
      fastest_minutes: 60,
      modes_present: ["walk", "bus", "train", "ferry"],
      cache_hit: false,
    });
  });

  it("itinerary_expanded describes one option", () => {
    expect(itineraryExpandedProps(its[0]!, 3)).toEqual({
      rank: 3,
      duration_minutes: 240,
      transfers: 1,
      modes: ["walk", "bus", "train"],
    });
  });
});

describe("browser wrapper", () => {
  afterEach(() => resetAnalyticsForTests());

  function fakeClient() {
    return {
      capture: vi.fn(),
      get_distinct_id: () => "anon-123456",
      get_session_id: () => "sess-123456",
    };
  }

  it("queues events until PostHog is ready, then sends them in order", () => {
    track("share_clicked", {});
    track("booking_clicked", { operator: "Amtrak", rank: 1 });
    const client = fakeClient();
    setAnalyticsClient(client as never);
    expect(client.capture.mock.calls).toEqual([
      ["share_clicked", {}],
      ["booking_clicked", { operator: "Amtrak", rank: 1 }],
    ]);
    track("share_clicked", {});
    expect(client.capture).toHaveBeenCalledTimes(3);
  });

  it("never throws when PostHog does", () => {
    const client = fakeClient();
    client.capture.mockImplementation(() => {
      throw new Error("blocked");
    });
    setAnalyticsClient(client as never);
    expect(() => track("share_clicked", {})).not.toThrow();
  });

  it("caps the queue when analytics never loads", () => {
    for (let i = 0; i < 100; i++) track("share_clicked", {});
    const client = fakeClient();
    setAnalyticsClient(client as never);
    expect(client.capture).toHaveBeenCalledTimes(20);
  });

  it("adds the anonymous ids to /api/plan only when running", () => {
    expect(analyticsHeaders()).toEqual({});
    setAnalyticsClient(fakeClient() as never);
    expect(analyticsHeaders()).toEqual({
      "x-posthog-distinct-id": "anon-123456",
      "x-posthog-session-id": "sess-123456",
    });
  });

  it("only accepts a project token in the browser", () => {
    expect(isProjectToken("phc_abc")).toBe(true);
    expect(isProjectToken("phs_secret")).toBe(false);
    expect(isProjectToken("phx_personal")).toBe(false);
    expect(isProjectToken(undefined)).toBe(false);
  });
});

describe("proxy config", () => {
  it("rewrites assets before the catch-all, for the project's region", () => {
    expect(analyticsRewrites("https://us.i.posthog.com")).toEqual([
      {
        source: `${ANALYTICS_PROXY_PATH}/static/:path*`,
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: `${ANALYTICS_PROXY_PATH}/array/:path*`,
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: `${ANALYTICS_PROXY_PATH}/:path*`,
        destination: "https://us.i.posthog.com/:path*",
      },
    ]);
    expect(posthogHosts("https://eu.i.posthog.com").api).toBe(
      "https://eu.i.posthog.com",
    );
    expect(posthogHosts(undefined).ui).toBe("https://us.posthog.com");
  });

  it("does not use a path ad blockers commonly match", () => {
    expect(ANALYTICS_PROXY_PATH).not.toMatch(
      /analytics|posthog|track|telemetry|ingest/i,
    );
  });
});

describe("server capture", () => {
  const identity = { distinctId: "anon-123456", sessionId: "sess-123456" };

  it("posts an anonymous event with GeoIP off to the capture API", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await captureServerEvent(
      "no_results",
      noResultsProps(portland, seattle),
      identity,
      { key: "phc_test", host: "https://us.i.posthog.com", fetchImpl },
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "no_results",
      distinct_id: "anon-123456",
      properties: {
        from_city: "Portland",
        to_city: "Seattle",
        $session_id: "sess-123456",
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/\$ip|lat|lon/);
  });

  it("does nothing without a project token, and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(
      await captureServerEvent(
        "share_clicked" as never,
        {} as never,
        identity,
        {
          key: undefined,
          fetchImpl,
        },
      ),
    ).toBe(false);
    expect(
      await captureServerEvent("provider_error", { type: "quota" }, identity, {
        key: "phs_secret",
        fetchImpl,
      }),
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await captureServerEvent("provider_error", { type: "quota" }, identity, {
        key: "phc_test",
        fetchImpl,
      }),
    ).toBe(false);
  });

  it("uses the browser's ids when valid, a fresh one otherwise", () => {
    const ok = identityFrom(
      new Headers({
        "x-posthog-distinct-id": "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        "x-posthog-session-id": "0193a1b2-aaaa-7e5f",
      }),
    );
    expect(ok.distinctId).toBe("0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    expect(ok.sessionId).toBe("0193a1b2-aaaa-7e5f");

    const bad = identityFrom(
      new Headers({ "x-posthog-distinct-id": "<script>alert(1)</script>" }),
    );
    expect(bad.distinctId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bad.sessionId).toBeNull();
  });
});
