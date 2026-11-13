// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceResult } from "@/lib/places/types";

import { PLACE_SEARCH_DEBOUNCE_MS, PlaceInput } from "@/components/PlaceInput";

function result(name: string, state: string, id: number): PlaceResult {
  return {
    id,
    name,
    state,
    label: `${name}, ${state}`,
    lat: 0,
    lon: 0,
    population: 1000,
    timezone: "America/New_York",
  };
}

const PORTLANDS = [result("Portland", "OR", 1), result("Portland", "ME", 2)];

let fetchMock: ReturnType<typeof vi.fn>;

function respondWith(results: PlaceResult[]) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ results }), { status: 200 }),
  );
}

function Harness({ onChange }: { onChange?: (p: PlaceResult | null) => void }) {
  const [value, setValue] = useState<PlaceResult | null>(null);
  return (
    <>
      <PlaceInput
        label="Departure"
        value={value}
        onChange={(p) => {
          setValue(p);
          onChange?.(p);
        }}
      />
      <span data-testid="selected">{value?.label ?? "none"}</span>
    </>
  );
}

function setup(onChange?: (p: PlaceResult | null) => void) {
  const user = userEvent.setup();
  render(<Harness onChange={onChange} />);
  const input = screen.getByRole("combobox", { name: "Departure" });
  return { user, input };
}

/** Waits past the debounce, then for the mocked fetch to settle. */
async function flush() {
  await new Promise((r) => setTimeout(r, PLACE_SEARCH_DEBOUNCE_MS + 50));
  await waitFor(() =>
    expect(screen.getByRole("combobox").getAttribute("aria-busy")).toBe(
      "false",
    ),
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  respondWith(PORTLANDS);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlaceInput", () => {
  it("is a labelled combobox that starts collapsed", () => {
    const { input } = setup();
    expect(input).toHaveProperty("type", "text");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-controls")).toBeTruthy();
  });

  it("debounces requests while typing", async () => {
    const { user, input } = setup();
    await user.type(input, "Portl");
    expect(fetchMock).not.toHaveBeenCalled();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/places?q=Portl");
  });

  it("does not search for a single character", async () => {
    const { user, input } = setup();
    await user.type(input, "P");
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows options as City, ST and announces the count", async () => {
    const { user, input } = setup();
    await user.type(input, "Portland");
    await flush();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Portland, OR",
      "Portland, ME",
    ]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("status").textContent).toMatch(/2 places found/);
  });

  it("moves through options with the arrow keys and picks with Enter", async () => {
    const onChange = vi.fn();
    const { user, input } = setup(onChange);
    await user.type(input, "Portland");
    await flush();

    await user.keyboard("{ArrowDown}");
    const [first, second] = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(first!.id);
    expect(first!.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(second!.id);

    await user.keyboard("{ArrowDown}"); // wraps
    expect(input.getAttribute("aria-activedescendant")).toBe(first!.id);

    await user.keyboard("{ArrowUp}"); // wraps back
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(PORTLANDS[1]);
    expect((input as HTMLInputElement).value).toBe("Portland, ME");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("picks the first option on Enter when none is highlighted", async () => {
    const { user, input } = setup();
    await user.type(input, "Portland");
    await flush();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("selected").textContent).toBe("Portland, OR");
  });

  it("picks an option by click or tap", async () => {
    const { user, input } = setup();
    await user.type(input, "Portland");
    await flush();
    await user.click(screen.getByRole("option", { name: "Portland, ME" }));
    expect(screen.getByTestId("selected").textContent).toBe("Portland, ME");
    expect(document.activeElement).toBe(input);
  });

  it("closes on Escape, then clears on a second Escape", async () => {
    const { user, input } = setup();
    await user.type(input, "Portland");
    await flush();
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect((input as HTMLInputElement).value).toBe("Portland");
    await user.keyboard("{Escape}");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("clears the selection when the text is edited", async () => {
    const { user, input } = setup();
    await user.type(input, "Portland");
    await flush();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("selected").textContent).toBe("Portland, OR");
    await user.type(input, "x");
    expect(screen.getByTestId("selected").textContent).toBe("none");
  });

  it("has a clear button big enough to tap", async () => {
    const { user, input } = setup();
    await user.type(input, "Portland");
    await flush();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Clear Departure" }));
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("selected").textContent).toBe("none");
  });

  it("says when nothing matches", async () => {
    respondWith([]);
    const { user, input } = setup();
    await user.type(input, "Qwxzzy");
    await flush();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe(
      "No matching places in the USA.",
    );
  });

  it("reports a network failure instead of showing stale results", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user, input } = setup();
    await user.type(input, "Portland");
    await flush();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toMatch(
      /Couldn't load places/,
    );
  });

  it("aborts an in-flight request when the user keeps typing", async () => {
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      firstSignal = init.signal ?? undefined;
      return new Promise(() => {}); // never resolves
    });
    const { user, input } = setup();
    await user.type(input, "Port");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(firstSignal?.aborted).toBe(false);
    await user.type(input, "land");
    expect(firstSignal?.aborted).toBe(true);
    await flush();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});
