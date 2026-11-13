import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/places/route";
import type { PlacesApiResponse } from "@/lib/places/types";

async function get(query: string) {
  const res = await GET(new NextRequest(`http://localhost/api/places${query}`));
  return { res, body: (await res.json()) as PlacesApiResponse };
}

describe("GET /api/places", () => {
  it("returns at most 8 results", async () => {
    const { res, body } = await get("?q=Springfield");
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(8);
  });

  it("ignores attempts to raise the cap", async () => {
    const { body } = await get("?q=San&limit=50");
    expect(body.results).toHaveLength(8);
  });

  it("returns places with every field the UI needs", async () => {
    const { body } = await get(`?q=${encodeURIComponent("Portland, ME")}`);
    expect(body.results[0]).toMatchObject({
      name: "Portland",
      state: "ME",
      label: "Portland, ME",
      timezone: "America/New_York",
    });
    const first = body.results[0]!;
    expect(typeof first.id).toBe("number");
    expect(typeof first.lat).toBe("number");
    expect(typeof first.lon).toBe("number");
    expect(typeof first.population).toBe("number");
  });

  it.each(["", "?q=", "?q=a", "?q=%20%20"])(
    "returns no results for short query %j",
    async (query) => {
      const { res, body } = await get(query);
      expect(res.status).toBe(200);
      expect(body.results).toEqual([]);
    },
  );

  it("returns an empty list, not an error, when nothing matches", async () => {
    const { res, body } = await get("?q=Qwxzzy");
    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("rejects very long queries", async () => {
    const { res } = await get(`?q=${"a".repeat(101)}`);
    expect(res.status).toBe(400);
  });

  it("is cacheable by the CDN", async () => {
    const { res } = await get("?q=Portland");
    expect(res.headers.get("cache-control")).toContain("s-maxage=");
  });
});
