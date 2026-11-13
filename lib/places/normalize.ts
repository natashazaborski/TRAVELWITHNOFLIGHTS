/** Abbreviations in US place names, expanded to their long form. */
const ABBREVIATIONS: Record<string, string> = {
  st: "saint",
  ste: "sainte",
  ft: "fort",
  mt: "mount",
};

/**
 * Lowercase, strip diacritics and punctuation, collapse whitespace.
 * "Cañon City" -> "canon city", "St. Paul" -> "st paul",
 * "Winston-Salem" -> "winston salem".
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Expands whole-word abbreviations: "st louis" -> "saint louis". */
export function expandAbbreviations(normalized: string): string {
  return normalized
    .split(" ")
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(" ");
}

/**
 * The forms a name can be matched under: as written, and with abbreviations
 * expanded. Both are needed so that a partly typed "st" still matches
 * "Stamford", while "saint lou" matches "St. Louis".
 */
export function nameForms(input: string): string[] {
  const normalized = normalizeName(input);
  const expanded = expandAbbreviations(normalized);
  return expanded === normalized ? [normalized] : [normalized, expanded];
}

/**
 * Optimal string alignment distance (Damerau-Levenshtein where each substring
 * is edited at most once): insertions, deletions, substitutions, and
 * transpositions of adjacent characters each cost 1.
 *
 * Returns `max + 1` as soon as the distance must exceed `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prevPrev[j - 2]! + 1);
      }
      curr.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = curr;
  }
  return prev[b.length]!;
}
