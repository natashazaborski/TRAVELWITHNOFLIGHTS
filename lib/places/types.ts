/** A US city or town, as stored in lib/places/data/us-places.json. */
export interface Place {
  /** GeoNames id. Unique, stable across rebuilds. */
  id: number;
  name: string;
  /** Two-letter USPS state code, e.g. "OR". */
  state: string;
  lat: number;
  lon: number;
  population: number;
  /** IANA timezone, e.g. "America/Los_Angeles". */
  timezone: string;
}

/** A place as returned by /api/places, with its display label. */
export interface PlaceResult extends Place {
  /** "City, ST", e.g. "Portland, OR". */
  label: string;
}

export interface PlacesApiResponse {
  results: PlaceResult[];
}
