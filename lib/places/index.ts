// Server-only entry point: imports the ~2 MB dataset. Client code should
// import from "@/lib/places/types" and "@/lib/places/format" instead.
import dataset from "./data/us-places.json";
import { createPlaceSearch } from "./search";
import type { Place } from "./types";

export { DEFAULT_LIMIT } from "./search";
export type { Place, PlaceResult, PlacesApiResponse } from "./types";

export const placesMeta = dataset.meta;

/** Searches US places with population over 1,000 (GeoNames, CC BY 4.0). */
export const searchPlaces = createPlaceSearch(
  dataset.places satisfies Place[],
  dataset.states,
);

const byId = new Map<number, Place>(
  (dataset.places satisfies Place[]).map((p) => [p.id, p]),
);

/** The place with this GeoNames id, or undefined. */
export function getPlaceById(id: number): Place | undefined {
  return byId.get(id);
}
