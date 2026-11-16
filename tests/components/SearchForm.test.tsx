// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchForm } from "@/components/SearchForm";
import {
  resetAnalyticsForTests,
  setAnalyticsClient,
} from "@/lib/analytics/client";
import type { PlaceResult } from "@/lib/places/types";
import { nowInZone, systemTimeZone } from "@/lib/time/zoned";

function place(
  id: number,
  name: string,
  state: string,
  timezone: string,
): PlaceResult {
  return {
    id,
    name,
    state,
    label: `${name}, ${state}`,
    lat: 0,
    lon: 0,
    population: 1000,
    timezone,
  };
}

const PORTLAND = place(5746545, "Portland", "OR", "America/Los_Angeles");
const SEATTLE = place(5809844, "Seattle", "WA", "America/Los_Angeles");
const HONOLULU = place(5856195, "Honolulu", "HI", "Pacific/Honolulu");
const ALL = [PORTLAND, SEATTLE, HONOLULU];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/places") {
      const q = url.searchParams.get("q");
      const ids = url.searchParams.get("id");
      const results = q
        ? ALL.filter((p) => p.name.toLowerCase().startsWith(q.toLowerCase()))
        : ALL.filter((p) => ids!.split(",").includes(String(p.id)));
      return Response.json({ results });
    }
    if (url.pathname === "/api/plan") {
      void init;
      throw new Error("the form must not call /api/plan");
    }
    throw new Error(`unexpected fetch ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(query = "") {
  const navigate = vi.fn();
  const user = userEvent.setup();
  const view = render(<SearchForm query={query} navigate={navigate} />);
  const rerenderWith = (q: string) =>
    view.rerender(<SearchForm query={q} navigate={navigate} />);
  return { user, navigate, rerenderWith };
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  label: "Departure" | "Arriving",
  typed: string,
  option: string,
) {
  const input = screen.getByRole("combobox", { name: label });
  await user.clear(input);
  await user.type(input, typed);
  await user.click(await screen.findByRole("option", { name: option }));
}

const planCalls = () =>
  fetchMock.mock.calls.filter(([u]) => String(u) === "/api/plan");

describe("SearchForm", () => {
  it("has the fields, toggle, and one search button", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Departure" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Arriving" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Swap departure and arrival" }),
    ).toBeTruthy();
    const leave = screen.getByRole("radio", { name: "Leave at" });
    const arrive = screen.getByRole("radio", { name: "Arrive by" });
    expect((leave as HTMLInputElement).checked).toBe(true);
    // Equal visual weight: both options are styled identically.
    expect(leave.parentElement!.className).toBe(
      arrive.parentElement!.className,
    );
    expect(screen.getAllByRole("button", { name: /search/i })).toHaveLength(1);
  });

  it("defaults date and time to now in the device's zone", () => {
    setup();
    const now = nowInZone(systemTimeZone());
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(
      now.date,
    );
    const time = (screen.getByLabelText("Time") as HTMLInputElement).value;
    // Allow for the minute ticking over during the test.
    expect(time.slice(0, 2)).toBe(now.time.slice(0, 2));
  });

  it("switches 'now' to the departure city's zone once chosen", async () => {
    const { user } = setup();
    await choose(user, "Departure", "Hono", "Honolulu, HI");
    const now = nowInZone("Pacific/Honolulu");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(
      now.date,
    );
    expect(
      (screen.getByLabelText("Time") as HTMLInputElement).value.slice(0, 2),
    ).toBe(now.time.slice(0, 2));
  });

  it("requires both places and focuses the first missing one", async () => {
    const { user, navigate } = setup();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(
      screen.getByText("Choose a departure city from the suggestions."),
    ).toBeTruthy();
    expect(
      screen.getByText("Choose an arrival city from the suggestions."),
    ).toBeTruthy();
    const departure = screen.getByRole("combobox", { name: "Departure" });
    expect(departure.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(departure);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects the same place for both ends", async () => {
    const { user, navigate } = setup();
    await choose(user, "Departure", "Port", "Portland, OR");
    await choose(user, "Arriving", "Port", "Portland, OR");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(
      screen.getByText("Arriving must be a different place from Departure."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Arriving" }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("swaps departure and arrival", async () => {
    const { user } = setup();
    await choose(user, "Departure", "Port", "Portland, OR");
    await choose(user, "Arriving", "Sea", "Seattle, WA");
    await user.click(
      screen.getByRole("button", { name: "Swap departure and arrival" }),
    );
    expect(
      (screen.getByRole("combobox", { name: "Departure" }) as HTMLInputElement)
        .value,
    ).toBe("Seattle, WA");
    expect(
      (screen.getByRole("combobox", { name: "Arriving" }) as HTMLInputElement)
        .value,
    ).toBe("Portland, OR");
  });

  it("explains the arrive-by timezone, naming it once a city is chosen", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Arrive by" }));
    const help = () =>
      screen.getByText(/Time is in the arrival city's timezone\./);
    expect(help().textContent).toBe("Time is in the arrival city's timezone.");
    await choose(user, "Arriving", "Hono", "Honolulu, HI");
    expect(help().textContent).toBe(
      "Time is in the arrival city's timezone. Honolulu, HI is on Hawaii-Aleutian Standard Time (HST).",
    );
    // The helper is linked to the time field for screen readers.
    const helpId = help().id;
    expect(
      screen.getByLabelText("Time").getAttribute("aria-describedby"),
    ).toContain(helpId);
  });

  it("goes to /results with the full search in the URL", async () => {
    const { user, navigate } = setup();
    await choose(user, "Departure", "Port", "Portland, OR");
    await choose(user, "Arriving", "Sea", "Seattle, WA");
    await user.click(screen.getByRole("radio", { name: "Arrive by" }));
    const date = screen.getByLabelText("Date");
    const time = screen.getByLabelText("Time");
    await user.clear(date);
    await user.type(date, "2026-11-17");
    await user.clear(time);
    await user.type(time, "18:00");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(navigate).toHaveBeenCalledWith(
      "/results?from=5746545-portland-or&to=5809844-seattle-wa&mode=arriveBy&date=2026-11-17&time=18%3A00",
    );
    expect(planCalls()).toHaveLength(0);
  });
});

describe("SearchForm prefilled from the URL (Edit search)", () => {
  const query =
    "from=5746545-portland-or&to=5809844-seattle-wa&mode=arriveBy&date=2026-11-17&time=18%3A00";

  it("restores every field without running a search", async () => {
    setup(query);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("combobox", {
            name: "Departure",
          }) as HTMLInputElement
        ).value,
      ).toBe("Portland, OR"),
    );
    expect(
      (screen.getByRole("combobox", { name: "Arriving" }) as HTMLInputElement)
        .value,
    ).toBe("Seattle, WA");
    expect(
      (screen.getByRole("radio", { name: "Arrive by" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(
      "2026-11-17",
    );
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe(
      "18:00",
    );
    expect(planCalls()).toHaveLength(0);
  });

  it("follows a changed URL", async () => {
    const { rerenderWith } = setup(query);
    await waitFor(() =>
      expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe(
        "18:00",
      ),
    );
    rerenderWith(query.replace("18%3A00", "20%3A00"));
    await waitFor(() =>
      expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe(
        "20:00",
      ),
    );
  });
});

describe("no sign-up prompts", () => {
  it("never asks the user to sign up or log in", () => {
    setup();
    expect(document.body.textContent).not.toMatch(
      /sign ?up|sign ?in|log ?in|create an account|register|subscribe/i,
    );
  });
});

describe("SearchForm analytics", () => {
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

  it("tracks a valid search with cities only, timed in the arrival city's zone", async () => {
    const { user } = setup();
    await choose(user, "Departure", "Hono", "Honolulu, HI");
    await choose(user, "Arriving", "Sea", "Seattle, WA");
    await user.click(screen.getByRole("radio", { name: "Arrive by" }));
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-11-17");
    await user.clear(screen.getByLabelText("Time"));
    await user.type(screen.getByLabelText("Time"), "18:00");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0]!;
    expect(event).toBe("search_submitted");
    // 18:00 in Seattle (PST, UTC-8), not Honolulu.
    const deadline = Date.parse("2026-11-18T02:00:00Z");
    const { hours_until_trip, ...rest } = props;
    expect(rest).toEqual({
      from_city: "Honolulu",
      from_state: "HI",
      to_city: "Seattle",
      to_state: "WA",
      mode: "arriveBy",
    });
    expect(
      Math.abs(hours_until_trip - (deadline - Date.now()) / 3600_000),
    ).toBeLessThan(0.2);
  });

  it("does not track a search that fails validation", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(capture).not.toHaveBeenCalled();
  });
});
