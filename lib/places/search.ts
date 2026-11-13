import { formatPlaceLabel } from "./format";
import { editDistance, nameForms, normalizeName } from "./normalize";
import type { Place, PlaceResult } from "./types";

export const DEFAULT_LIMIT = 8;

/** How a place matched the query. Lower is better; ties rank by population. */
export enum MatchTier {
  Exact = 0,
  Prefix = 1,
  /** The query starts a later word: "vegas" -> "Las Vegas". */
  WordPrefix = 2,
  /** Within a small edit distance: "springfeld" -> "Springfield". */
  Fuzzy = 3,
}

const MIN_WORD_PREFIX_LENGTH = 3;

/** Typos tolerated for a query of this length (normalized characters). */
export function maxTypos(length: number): number {
  if (length < 4) return 0;
  if (length < 8) return 1;
  return 2;
}

interface IndexedPlace {
  place: Place;
  label: string;
  /** Normalized name forms (as written, and abbreviations expanded). */
  forms: string[];
  /** Each form from its second word on: "las vegas" -> ["vegas"]. */
  laterWords: string[];
}

interface Interpretation {
  /** Normalized query forms for the city part. */
  cityForms: string[];
  /** Allowed state codes, or null for any state. */
  states: ReadonlySet<string> | null;
}

export interface PlaceSearchOptions {
  limit?: number;
}

export type PlaceSearch = (
  query: string,
  options?: PlaceSearchOptions,
) => PlaceResult[];

/**
 * Builds a search over `places`. Matches on name prefix, on "city, state"
 * (state as code or name), and tolerates small typos. Results are ranked by
 * match quality, then population. Places that would show the same
 * "City, ST" label are collapsed to the most populous one, because the user
 * could not tell them apart.
 */
export function createPlaceSearch(
  places: readonly Place[],
  states: Readonly<Record<string, string>>,
): PlaceSearch {
  const index: IndexedPlace[] = [...places]
    .sort((a, b) => b.population - a.population || a.id - b.id)
    .map((place) => {
      const forms = nameForms(place.name);
      const laterWords = forms.flatMap((form) => {
        const words = form.split(" ");
        return words.slice(1).map((_, i) => words.slice(i + 1).join(" "));
      });
      return { place, label: formatPlaceLabel(place), forms, laterWords };
    });

  const stateEntries = Object.entries(states).map(([code, name]) => ({
    code,
    codeLower: code.toLowerCase(),
    name: normalizeName(name),
  }));

  /** States matching a complete or partly typed state code or name. */
  function statesMatching(text: string, allowPartialName: boolean): string[] {
    const t = normalizeName(text);
    if (!t) return [];
    return stateEntries
      .filter(
        (s) =>
          s.codeLower === t ||
          s.name === t ||
          (allowPartialName && t.length >= 1 && s.codeLower.startsWith(t)) ||
          (allowPartialName && s.name.startsWith(t)) ||
          (t.length >= 5 && editDistance(t, s.name, 1) <= 1),
      )
      .map((s) => s.code);
  }

  function interpret(query: string): Interpretation[] {
    const commaAt = query.indexOf(",");
    if (commaAt >= 0) {
      const city = query.slice(0, commaAt);
      const stateText = query.slice(commaAt + 1);
      const cityForms = nameForms(city).filter(Boolean);
      if (cityForms.length === 0) return [];
      if (!normalizeName(stateText)) return [{ cityForms, states: null }];
      const codes = statesMatching(stateText, true);
      // A state we cannot recognise: no results rather than a guess.
      return codes.length ? [{ cityForms, states: new Set(codes) }] : [];
    }

    const cityForms = nameForms(query).filter(Boolean);
    if (cityForms.length === 0) return [];
    const result: Interpretation[] = [{ cityForms, states: null }];

    // Without a comma, the last 1-3 words may be a complete state code or
    // name: "portland me", "springfield new jersey".
    const words = normalizeName(query).split(" ");
    for (let n = 1; n <= Math.min(3, words.length - 1); n++) {
      const codes = statesMatching(words.slice(-n).join(" "), false);
      if (codes.length) {
        result.push({
          cityForms: nameForms(words.slice(0, -n).join(" ")),
          states: new Set(codes),
        });
      }
    }
    return result;
  }

  function cheapTier(
    entry: IndexedPlace,
    cityForms: string[],
  ): MatchTier | null {
    let best: MatchTier | null = null;
    for (const q of cityForms) {
      for (const form of entry.forms) {
        if (form === q) return MatchTier.Exact;
        if (form.startsWith(q)) best = MatchTier.Prefix;
      }
      if (
        best === null &&
        q.length >= MIN_WORD_PREFIX_LENGTH &&
        entry.laterWords.some((w) => w.startsWith(q))
      ) {
        best = MatchTier.WordPrefix;
      }
    }
    return best;
  }

  function isFuzzyMatch(entry: IndexedPlace, cityForms: string[]): boolean {
    for (const q of cityForms) {
      const max = maxTypos(q.length);
      if (max === 0) continue;
      for (const form of entry.forms) {
        // Compare against name prefixes near the query's length, so a typo
        // in a partly typed name still matches: "sprinfg" -> "springfield".
        for (let len = q.length - max; len <= q.length + max; len++) {
          if (len <= 0 || len > form.length) continue;
          if (editDistance(q, form.slice(0, len), max) <= max) return true;
        }
      }
    }
    return false;
  }

  return function search(query, options = {}) {
    const limit = Math.max(0, options.limit ?? DEFAULT_LIMIT);
    if (limit === 0) return [];
    const interpretations = interpret(query);
    if (interpretations.length === 0) return [];

    const allowed = (entry: IndexedPlace, i: Interpretation) =>
      i.states === null || i.states.has(entry.place.state);

    const matches: { entry: IndexedPlace; tier: MatchTier }[] = [];
    for (const entry of index) {
      let best: MatchTier | null = null;
      for (const i of interpretations) {
        if (!allowed(entry, i)) continue;
        const tier = cheapTier(entry, i.cityForms);
        if (tier !== null && (best === null || tier < best)) best = tier;
      }
      if (best !== null) matches.push({ entry, tier: best });
    }

    // Typo matching only runs when nothing matched as typed. Otherwise
    // "Portland, ME" would be padded with look-alikes such as "Poland, ME".
    // It is also the expensive pass.
    if (matches.length === 0) {
      for (const entry of index) {
        if (
          interpretations.some(
            (i) => allowed(entry, i) && isFuzzyMatch(entry, i.cityForms),
          )
        ) {
          matches.push({ entry, tier: MatchTier.Fuzzy });
        }
      }
    }

    // `index` is already in population order, and sort is stable.
    matches.sort((a, b) => a.tier - b.tier);

    const results: PlaceResult[] = [];
    const seen = new Set<string>();
    for (const { entry } of matches) {
      if (seen.has(entry.label)) continue;
      seen.add(entry.label);
      results.push({ ...entry.place, label: entry.label });
      if (results.length >= limit) break;
    }
    return results;
  };
}
