import type { NextRequest } from "next/server";
import {
  getPlaceById,
  searchPlaces,
  type PlaceResult,
  type PlacesApiResponse,
} from "@/lib/places";
import { formatPlaceLabel } from "@/lib/places/format";

/** Hard cap on results, regardless of the `limit` parameter. */
const MAX_RESULTS = 8;
const MAX_QUERY_LENGTH = 100;
const MAX_IDS = 2;

const CACHE_HEADERS = {
  // The dataset only changes on redeploy, so the CDN can cache freely.
  "Cache-Control": "public, max-age=3600, s-maxage=86400",
};

/**
 * GET /api/places?q=portl -> { results: PlaceResult[] } (at most 8).
 * Queries shorter than 2 characters return no results.
 *
 * GET /api/places?id=5746545,5809844 -> the places with those GeoNames ids,
 * in the order asked, skipping unknown ids. Used to restore a shared search.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const ids = params.get("id");
  if (ids !== null) {
    const parsed = ids.split(",").map((s) => Number(s.trim()));
    if (parsed.length > MAX_IDS || !parsed.every(Number.isSafeInteger)) {
      return Response.json(
        { error: `id must be up to ${MAX_IDS} comma-separated integers` },
        { status: 400 },
      );
    }
    const results: PlaceResult[] = parsed.flatMap((id) => {
      const place = getPlaceById(id);
      return place ? [{ ...place, label: formatPlaceLabel(place) }] : [];
    });
    return Response.json({ results } satisfies PlacesApiResponse, {
      headers: CACHE_HEADERS,
    });
  }

  const q = (params.get("q") ?? "").trim();
  if (q.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `q must be at most ${MAX_QUERY_LENGTH} characters` },
      { status: 400 },
    );
  }

  const body: PlacesApiResponse = {
    results: q.length < 2 ? [] : searchPlaces(q, { limit: MAX_RESULTS }),
  };
  return Response.json(body, { headers: CACHE_HEADERS });
}
