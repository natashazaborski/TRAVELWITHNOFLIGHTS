// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_MESSAGE, ResultsView } from "@/components/results/ResultsView";
import {
  resetAnalyticsForTests,
  setAnalyticsClient,
} from "@/lib/analytics/client";
import type { PlaceResult } from "@/lib/places/types";
import type { Itinerary, PlanResult } from "@/lib/routing/types";
import { itinerary, leg } from "../routing/helpers";

// The real map needs WebGL; render a stand-in that shows which trip it got.
vi.mock("@/components/results/RouteMapCanvas", () => ({
  default: ({ itinerary }: { itinerary: Itinerary }) => (
    <div data-testid="map">{itinerary.id}</div>
  ),
}));

const PT = "America/Los_Angeles";
const PORTLAND: PlaceResult = {
  id: 5746545,
  name: "Portland",
  state: "OR",
  label: "Portland, OR",
  lat: 45.52,
  lon: -122.68,
  population: 652503,
  timezone: PT,
};
const SEATTLE: PlaceResult = {
  ...PORTLAND,
  id: 5809844,
  name: "Seattle",
  state: "WA",
  label: "Seattle, WA",
  lat: 47.61,
  lon: -122.33,
};

// Test-only trips on Tue 2026-11-17 (PST = UTC-8). Deadline 18:00 PST.
const z = { timezoneStart: PT, timezoneEnd: PT };
const early = itinerary(
  [
    leg("train", "2026-11-17T14:00:00.000Z", "2026-11-17T17:30:00.000Z", {
      ...z,
      routeName: "Cascades 500",
      from: "Portland Union Station",
      to: "Seattle King Street",
      feedDate: "2026-11-02",
      bookingUrl: "https://www.amtrak.com/",
    }),
  ],
  "early", // 06:00 -> 09:30 PST, direct
);
const withTransfer = itinerary(
  [
    leg("bus", "2026-11-17T21:00:00.000Z", "2026-11-17T22:00:00.000Z", {
      ...z,
      operator: "Greyhound",
      routeName: "1450",
      from: "Portland Greyhound",
      to: "Kelso Bus Stop",
      feedDate: "2026-10-28",
      bookingUrl: "https://www.greyhound.com/",
    }),
    leg("walk", "2026-11-17T22:00:00.000Z", "2026-11-17T22:06:00.000Z", {
      ...z,
      from: "Kelso Bus Stop",
      to: "Kelso Station",
    }),
    leg("train", "2026-11-17T22:30:00.000Z", "2026-11-18T00:30:00.000Z", {
      ...z,
      routeName: "Cascades 506",
      from: "Kelso Station",
      to: "Seattle King Street",
      feedDate: "2026-11-02",
      bookingUrl: "https://www.amtrak.com/",
    }),
  ],
  "transfer", // 13:00 -> 16:30 PST, 30 min Greyhound -> Amtrak change
);
withTransfer.flags = ["tightConnection"];
const late = itinerary(
  [
    leg("train", "2026-11-17T22:00:00.000Z", "2026-11-18T01:40:00.000Z", {
      ...z,
      routeName: "Coast Starlight",
      from: "Portland Union Station",
      to: "Seattle King Street",
      feedDate: "2026-11-02",
      bookingUrl: "https://www.amtrak.com/",
    }),
  ],
  "late", // 14:00 -> 17:40 PST, direct
);

const QUERY =
  "from=5746545-portland-or&to=5809844-seattle-wa&mode=arriveBy&date=2026-11-17&time=18%3A00";

let planResponse: () => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const okResult = (itineraries: Itinerary[], extra: Partial<PlanResult> = {}) =>
  Response.json({
    status: itineraries.length ? "ok" : "noRoutes",
    itineraries,
    notes: [],
    provider: "transitland",
    ...extra,
  } satisfies PlanResult);

beforeEach(() => {
  planResponse = () => okResult([late, early, withTransfer]);
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/places") {
      return Response.json({ results: [PORTLAND, SEATTLE] });
    }
    if (url.pathname === "/api/plan") return planResponse();
    throw new Error(`unexpected fetch ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  // Phone-sized screen: the map starts collapsed.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const planCalls = () =>
  fetchMock.mock.calls.filter(([u]) => String(u) === "/api/plan");

function setup(query = QUERY) {
  const replaceQuery = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <ResultsView query={query} replaceQuery={replaceQuery} />,
  );
  const rerenderWith = (q: string) =>
    view.rerender(<ResultsView query={q} replaceQuery={replaceQuery} />);
  return { user, replaceQuery, rerenderWith };
}

const cards = () => screen.getAllByRole("article");
const cardTimes = () =>
  cards().map((c) => within(c).getAllByText(/[AP]M PST/)[0]!.textContent);

describe("ResultsView", () => {
  it("shows the loading message, then a summary with route, mode, time, and count", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    planResponse = async () => {
      await gate;
      return okResult([late, early, withTransfer]);
    };
    setup();
    expect(await screen.findByText(LOADING_MESSAGE)).toBeTruthy();
    release();

    const heading = await screen.findByRole("heading", { level: 1 });
    await waitFor(() =>
      expect(heading.textContent).toBe("Portland, OR → to  Seattle, WA"),
    );
    await screen.findByText("3 options found.");
    expect(screen.getByText(/Arrive by 6:00 PM PST, Tue, Nov 17/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Edit search" }).getAttribute("href"),
    ).toBe(`/?${QUERY}`);
    expect(screen.queryByText(LOADING_MESSAGE)).toBeNull();
  });

  it("sends the search from the URL to /api/plan", async () => {
    setup();
    await waitFor(() => expect(planCalls()).toHaveLength(1));
    expect(JSON.parse(String(planCalls()[0]![1]!.body))).toEqual({
      from: { id: 5746545 },
      to: { id: 5809844 },
      dateTime: "2026-11-17T18:00",
      mode: "arriveBy",
    });
  });

  it("sorts by earliest arrival by default and re-sorts from the URL without refetching", async () => {
    const { user, replaceQuery, rerenderWith } = setup();
    await screen.findByText("3 options found.");
    expect(cardTimes()).toEqual(["6:00 AM PST", "1:00 PM PST", "2:00 PM PST"]);

    await user.selectOptions(screen.getByLabelText("Sort by"), "transfers");
    expect(replaceQuery).toHaveBeenCalledWith(`${QUERY}&sort=transfers`);
    rerenderWith(`${QUERY}&sort=transfers`);
    // Direct trips first (earliest arrival breaks the tie), then 1 transfer.
    expect(cardTimes()).toEqual(["6:00 AM PST", "2:00 PM PST", "1:00 PM PST"]);

    rerenderWith(`${QUERY}&sort=duration`);
    expect(cardTimes()).toEqual(["6:00 AM PST", "1:00 PM PST", "2:00 PM PST"]);
    expect(planCalls()).toHaveLength(1);
  });

  it("collapsed cards show times, places, duration, transfers, and a route line", async () => {
    setup();
    await screen.findByText("3 options found.");
    const card = cards()[1]!; // the 13:00 trip with a transfer
    const button = within(card).getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain("1:00 PM PST");
    expect(button.textContent).toContain("Portland Greyhound");
    expect(button.textContent).toContain("4:30 PM PST");
    expect(button.textContent).toContain("Seattle King Street");
    expect(button.textContent).toContain("3 h 30 min · 1 transfer");
    expect(button.textContent).toContain("Tight connection");
    // Route line: one segment per leg (3 legs).
    expect(
      card.querySelectorAll('[data-route-line="horizontal"] > [data-mode]')
        .length,
    ).toBe(3);
    expect(button.textContent).toContain(
      "Intercity bus 1 h, then Walk 6 min, then Train 2 h",
    );
  });

  it("expands into a timeline with waits, warnings, booking, and the schedule notice", async () => {
    const { user } = setup();
    await screen.findByText("3 options found.");
    const card = cards()[1]!;
    await user.click(within(card).getByRole("button"));
    expect(within(card).getByRole("button").getAttribute("aria-expanded")).toBe(
      "true",
    );

    const text = card.textContent!;
    expect(text).toContain("Intercity bus · Greyhound · 1450");
    expect(text).toContain("Train · Amtrak · Cascades 506");
    expect(text).toContain("Board1:00 PM PST · Portland Greyhound");
    expect(text).toContain("Get off4:30 PM PST · Seattle King Street");
    expect(text).toContain(
      "Change at Kelso Bus Stop: 30 min, including a 6 min walk",
    );
    expect(text).toContain(
      "Tight connection: 30 min to change from Greyhound to Amtrak.",
    );
    const book = within(card).getByRole("link", {
      name: /Book with Greyhound/,
    });
    expect(book.getAttribute("href")).toBe("https://www.greyhound.com/");
    expect(book.getAttribute("target")).toBe("_blank");
    expect(book.getAttribute("rel")).toContain("noopener");
    expect(
      within(card).getAllByRole("link", { name: /Book with Amtrak/ }),
    ).toHaveLength(1);
    // Oldest feed the trip relies on: Greyhound's.
    expect(text).toContain(
      "Schedules as of Oct 28, 2026. Seats are not guaranteed. Confirm with the operator before travelling.",
    );
  });

  it("for Arrive by: shows spare time and highlights the latest on-time departure", async () => {
    setup();
    await screen.findByText("3 options found.");
    const [first, second, third] = cards();
    expect(first!.textContent).toContain(
      "8 h 30 min to spare before your deadline",
    );
    expect(second!.textContent).toContain("1 h 30 min to spare");
    expect(third!.textContent).toContain("20 min to spare");
    expect(
      screen.getAllByText("Latest departure that arrives on time"),
    ).toHaveLength(1);
    expect(third!.textContent).toContain(
      "Latest departure that arrives on time",
    );
  });

  it("does not show spare time for Leave at", async () => {
    setup(QUERY.replace("arriveBy", "leaveAt"));
    await screen.findByText("3 options found.");
    expect(screen.queryByText(/to spare/)).toBeNull();
    expect(
      screen.queryByText("Latest departure that arrives on time"),
    ).toBeNull();
  });

  it("shows +1 day on arrivals after midnight", async () => {
    const overnight = itinerary(
      [
        leg("train", "2026-11-18T05:00:00.000Z", "2026-11-18T09:00:00.000Z", {
          ...z,
        }),
      ],
      "overnight", // 21:00 -> 01:00 PST next day
    );
    planResponse = () => okResult([overnight]);
    setup(QUERY.replace("arriveBy", "leaveAt"));
    const card = (await screen.findAllByRole("article"))[0]!;
    expect(card.textContent).toContain("1:00 AM PST+1 day");
  });

  it("keeps the map collapsed on phones and shows the selected trip when opened", async () => {
    const { user } = setup();
    await screen.findByText("3 options found.");
    const toggle = screen.getByRole("button", { name: "Show map" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("map")).toBeNull();

    await user.click(toggle);
    expect((await screen.findByTestId("map")).textContent).toBe("early");
    await user.click(within(cards()[2]!).getByRole("button"));
    expect(screen.getByTestId("map").textContent).toBe("late");
    expect(screen.getByText(/option 3 of 3/)).toBeTruthy();
  });

  it("copies the URL with the share button", async () => {
    // userEvent.setup() installs its own clipboard; spy on that one.
    const { user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await screen.findByText("3 options found.");
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText(/Link copied/)).toBeTruthy();
  });

  it("shows the link to copy by hand when the clipboard is blocked", async () => {
    const { user } = setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("blocked"),
    );
    await screen.findByText("3 options found.");
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(
      ((await screen.findByLabelText(/Copy this link/)) as HTMLInputElement)
        .value,
    ).toBe(window.location.href);
  });
});

describe("ResultsView states never show invented data", () => {
  // The summary repeats the user's own requested time; that is their input,
  // not trip data. No trip, stop time, or schedule may appear.
  const noTrips = () => {
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(
      screen.queryByText(/Board|Get off|to spare|Schedules as of/),
    ).toBeNull();
  };

  it("empty: says no routes were found and offers to edit", async () => {
    planResponse = () => okResult([]);
    setup();
    expect(
      await screen.findByRole("heading", { name: "No routes found" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Edit search" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Sort by")).toBeNull();
    noTrips();
  });

  it("quota exhausted: busy message with a retry that searches again", async () => {
    planResponse = () =>
      Response.json(
        {
          status: "busy",
          message:
            "Lots of people are searching right now. Please try again in a minute.",
          retryAfterSeconds: null,
        },
        { status: 503 },
      );
    const { user } = setup();
    expect(
      await screen.findByRole("heading", {
        name: "Lots of people are searching right now",
      }),
    ).toBeTruthy();
    noTrips();
    planResponse = () => okResult([early]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("1 options found.");
    expect(planCalls()).toHaveLength(2);
  });

  it("rate limited: says when to try again", async () => {
    planResponse = () =>
      Response.json(
        {
          status: "rateLimited",
          message: "Too many searches. Please wait a moment and try again.",
          retryAfterSeconds: 42,
        },
        { status: 429 },
      );
    setup();
    expect(await screen.findByText(/about 42 seconds/)).toBeTruthy();
    noTrips();
  });

  it("provider down: error with retry", async () => {
    planResponse = () =>
      Response.json(
        {
          status: "unavailable",
          message: "We couldn't reach the timetable service. Please try again.",
        },
        { status: 502 },
      );
    setup();
    expect(
      await screen.findByText(/couldn't reach the timetable service/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    noTrips();
  });

  it("offline: connection error", async () => {
    planResponse = () => Promise.reject(new TypeError("Failed to fetch"));
    setup();
    expect(await screen.findByText(/Couldn't connect/)).toBeTruthy();
    noTrips();
  });

  it("rejected search: explains and links to edit", async () => {
    planResponse = () =>
      Response.json(
        {
          status: "invalid",
          message: "Pick a time between yesterday and 90 days from now.",
        },
        { status: 400 },
      );
    setup();
    expect(
      await screen.findByText(/Pick a time between yesterday/),
    ).toBeTruthy();
    noTrips();
  });

  it("incomplete link: no search is run", () => {
    setup("from=5746545&mode=leaveAt");
    expect(
      screen.getByRole("heading", { name: "This search link is incomplete" }),
    ).toBeTruthy();
    expect(planCalls()).toHaveLength(0);
    noTrips();
  });

  it("never asks the user to sign up", async () => {
    setup();
    await screen.findByText("3 options found.");
    expect(document.body.textContent).not.toMatch(
      /sign ?up|sign ?in|log ?in|create an account|register|subscribe/i,
    );
  });
});

describe("ResultsView analytics", () => {
  const capture = vi.fn();
  beforeEach(() => {
    capture.mockReset();
    resetAnalyticsForTests();
    setAnalyticsClient({
      capture,
      get_distinct_id: () => "anon-123456",
      get_session_id: () => "sess-123456",
    } as never);
  });
  afterEach(() => resetAnalyticsForTests());

  const events = () => capture.mock.calls.map(([name]) => name);

  it("joins /api/plan to the visitor's anonymous session", async () => {
    setup();
    await screen.findByText("3 options found.");
    const [, init] = planCalls()[0]!;
    expect(init.headers).toMatchObject({
      "x-posthog-distinct-id": "anon-123456",
      "x-posthog-session-id": "sess-123456",
    });
    // results_shown / no_results come from the server, never the browser.
    expect(events()).toEqual([]);
  });

  it("tracks expanding (not collapsing), booking, and sharing", async () => {
    const { user } = setup();
    await screen.findByText("3 options found.");
    const card = cards()[1]!;
    await user.click(within(card).getByRole("button"));
    await user.click(within(card).getByRole("button"));
    expect(capture.mock.calls).toEqual([
      [
        "itinerary_expanded",
        {
          rank: 2,
          duration_minutes: 210,
          transfers: 1,
          modes: ["walk", "bus", "train"],
        },
      ],
    ]);

    await user.click(within(card).getByRole("button"));
    within(card)
      .getByRole("link", { name: /Book with Greyhound/ })
      .addEventListener("click", (e) => e.preventDefault());
    await user.click(
      within(card).getByRole("link", { name: /Book with Greyhound/ }),
    );
    expect(capture).toHaveBeenLastCalledWith("booking_clicked", {
      operator: "Greyhound",
      rank: 2,
    });

    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(capture).toHaveBeenLastCalledWith("share_clicked", {});
  });
});
