/**
 * Builds lib/places/data/us-places.json from the GeoNames "cities1000" dump.
 *
 * Usage: npm run build:places            (downloads fresh data)
 *        npm run build:places -- --cached (reuses .cache/geonames)
 *
 * Source: https://download.geonames.org/export/dump/ (see readme.txt there)
 * Licence: Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/)
 * The output is a modified subset (US only, selected columns, rounded
 * coordinates), and the site footer carries the attribution.
 *
 * Runs directly on Node 24 via built-in TypeScript type stripping, so it
 * must stay a single file with erasable-only TypeScript syntax.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

export const GEONAMES_BASE_URL = "https://download.geonames.org/export/dump/";
const CITIES_FILE = "cities1000";
const ADMIN1_FILE = "admin1CodesASCII.txt";

export interface PlaceRecord {
  id: number;
  name: string;
  state: string;
  lat: number;
  lon: number;
  population: number;
  timezone: string;
}

export interface PlacesDataset {
  meta: {
    source: string;
    licence: string;
    licenceUrl: string;
    attribution: string;
    sourceLastModified: string | null;
    generatedAt: string;
    count: number;
  };
  /** US state/territory postal code -> English name, from admin1CodesASCII.txt */
  states: Record<string, string>;
  places: PlaceRecord[];
}

/** Feature codes we drop: PPLQ = abandoned populated place. */
const EXCLUDED_FEATURE_CODES = new Set(["PPLQ"]);

// Column indexes in the GeoNames "geoname" table (readme.txt).
const COL = {
  id: 0,
  name: 1,
  lat: 4,
  lon: 5,
  featureClass: 6,
  featureCode: 7,
  country: 8,
  admin1: 10,
  population: 14,
  timezone: 17,
} as const;

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Parses admin1CodesASCII.txt into { "OR": "Oregon", ... } for the US. */
export function parseUsStates(admin1Text: string): Record<string, string> {
  const states: Record<string, string> = {};
  for (const line of admin1Text.split("\n")) {
    const [code, name] = line.split("\t");
    if (!code?.startsWith("US.") || !name) continue;
    states[code.slice(3)] = name.trim();
  }
  return states;
}

/** Converts cities1000.txt rows into compact US place records. */
export function convertCities(
  citiesText: string,
  states: Record<string, string>,
): PlaceRecord[] {
  const places: PlaceRecord[] = [];
  for (const line of citiesText.split("\n")) {
    if (!line) continue;
    const c = line.split("\t");
    if (c[COL.country] !== "US") continue;
    if (c[COL.featureClass] !== "P") continue;
    if (EXCLUDED_FEATURE_CODES.has(c[COL.featureCode] ?? "")) continue;

    const name = (c[COL.name] ?? "").trim();
    if (!name || /\(historical\)/i.test(name)) continue;

    const state = c[COL.admin1] ?? "";
    if (!(state in states)) continue;

    const timezone = c[COL.timezone] ?? "";
    const lat = Number(c[COL.lat]);
    const lon = Number(c[COL.lon]);
    const population = Number(c[COL.population]);
    const id = Number(c[COL.id]);
    if (!timezone || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!Number.isInteger(id)) continue;

    places.push({
      id,
      name,
      state,
      // 4 decimals is about 11 m: plenty for a city centroid.
      lat: round(lat, 4),
      lon: round(lon, 4),
      population: Number.isFinite(population) ? population : 0,
      timezone,
    });
  }
  // Largest first, so the file reads sensibly and search ties are stable.
  places.sort(
    (a, b) =>
      b.population - a.population ||
      a.name.localeCompare(b.name) ||
      a.state.localeCompare(b.state) ||
      a.id - b.id,
  );
  return places;
}

async function download(
  url: string,
): Promise<{ bytes: Uint8Array; lastModified: string | null }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    lastModified: res.headers.get("last-modified"),
  };
}

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, "..");
  const cacheDir = path.join(root, ".cache", "geonames");
  const outFile = path.join(root, "lib", "places", "data", "us-places.json");
  const useCache = process.argv.includes("--cached");
  await mkdir(cacheDir, { recursive: true });

  let zipBytes: Uint8Array;
  let admin1Text: string;
  let lastModified: string | null = null;
  const zipPath = path.join(cacheDir, `${CITIES_FILE}.zip`);
  const admin1Path = path.join(cacheDir, ADMIN1_FILE);

  const lastModifiedPath = `${zipPath}.last-modified`;

  if (useCache) {
    zipBytes = new Uint8Array(await readFile(zipPath));
    admin1Text = await readFile(admin1Path, "utf8");
    lastModified = (await readFile(lastModifiedPath, "utf8")).trim() || null;
  } else {
    console.log(`Downloading ${CITIES_FILE}.zip ...`);
    const zip = await download(`${GEONAMES_BASE_URL}${CITIES_FILE}.zip`);
    zipBytes = zip.bytes;
    lastModified = zip.lastModified;
    await writeFile(zipPath, zipBytes);
    await writeFile(lastModifiedPath, lastModified ?? "");
    const admin1 = await download(`${GEONAMES_BASE_URL}${ADMIN1_FILE}`);
    admin1Text = new TextDecoder().decode(admin1.bytes);
    await writeFile(admin1Path, admin1Text);
  }

  const entryName = `${CITIES_FILE}.txt`;
  const entries = unzipSync(zipBytes, {
    filter: (file) => file.name === entryName,
  });
  const citiesBytes = entries[entryName];
  if (!citiesBytes) throw new Error(`${entryName} not found in zip`);
  const citiesText = new TextDecoder().decode(citiesBytes);

  const states = parseUsStates(admin1Text);
  const places = convertCities(citiesText, states);
  const usedStates = Object.fromEntries(
    Object.entries(states).filter(([code]) =>
      places.some((p) => p.state === code),
    ),
  );

  const dataset: PlacesDataset = {
    meta: {
      source: `${GEONAMES_BASE_URL}${CITIES_FILE}.zip`,
      licence: "CC BY 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
      attribution:
        "Place data from GeoNames (geonames.org), CC BY 4.0. Modified: US places only, selected fields, rounded coordinates.",
      sourceLastModified: lastModified
        ? new Date(lastModified).toISOString()
        : null,
      generatedAt: new Date().toISOString(),
      count: places.length,
    },
    states: usedStates,
    places,
  };

  await mkdir(path.dirname(outFile), { recursive: true });
  // One place per line: compact, but diffs stay readable when regenerated.
  const body = [
    "{",
    `"meta":${JSON.stringify(dataset.meta)},`,
    `"states":${JSON.stringify(dataset.states)},`,
    `"places":[`,
    dataset.places.map((p) => JSON.stringify(p)).join(",\n"),
    "]}",
    "",
  ].join("\n");
  await writeFile(outFile, body);
  console.log(
    `Wrote ${places.length} places in ${Object.keys(usedStates).length} states to ${path.relative(root, outFile)} (${(Buffer.byteLength(body) / 1024).toFixed(0)} KiB)`,
  );
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
