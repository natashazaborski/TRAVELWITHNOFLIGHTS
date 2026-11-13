import type { NextRequest } from "next/server";
import { searchPlaces, type PlacesApiResponse } from "@/lib/places";

/** Hard cap on results, regardless of the `limit` parameter. */
const MAX_RESULTS = 8;
const MAX_QUERY_LENGTH = 100;

/**
 * GET /api/places?q=portl -> { results: PlaceResult[] } (at most 8).
 * Queries shorter than 2 characters return no results.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();

  if (q.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `q must be at most ${MAX_QUERY_LENGTH} characters` },
      { status: 400 },
    );
  }

  const body: PlacesApiResponse = {
    results: q.length < 2 ? [] : searchPlaces(q, { limit: MAX_RESULTS }),
  };

  return Response.json(body, {
    headers: {
      // The dataset only changes on redeploy, so the CDN can cache freely.
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
