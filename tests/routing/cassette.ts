/**
 * Record / replay of real Transitland HTTP exchanges ("cassettes").
 *
 * Record: RECORD_TRANSITLAND=1 with TRANSITLAND_API_KEY in .env.local
 *   RECORD_TRANSITLAND=1 npx vitest run tests/routing/transitland-recorded.test.ts
 * Replay (default): requests are answered from tests/fixtures/transitland/.
 *
 * The API key travels in a header and is never written to a cassette; saving
 * aborts if the key appears anywhere in the recorded data.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlanRequest } from "@/lib/routing/types";

export const CASSETTE_DIR = path.resolve(__dirname, "../fixtures/transitland");
export const RECORDING = process.env.RECORD_TRANSITLAND === "1";

export interface Interaction {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface Cassette {
  scenario: string;
  recordedAt: string;
  request: PlanRequest;
  interactions: Interaction[];
}

export function cassettePath(scenario: string): string {
  return path.join(CASSETTE_DIR, `${scenario}.json`);
}

export function loadCassette(scenario: string): Cassette | null {
  const file = cassettePath(scenario);
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Cassette)
    : null;
}

export function saveCassette(cassette: Cassette, apiKey: string): void {
  const json = JSON.stringify(cassette, null, 1);
  if (apiKey && json.includes(apiKey)) {
    throw new Error("Refusing to save a cassette that contains the API key");
  }
  mkdirSync(CASSETTE_DIR, { recursive: true });
  writeFileSync(cassettePath(cassette.scenario), json + "\n");
}

const KEPT_HEADERS = /^(content-type|retry-after)$|ratelimit|rate-limit|quota/i;

/** Real fetch that appends every exchange to `interactions`. */
export function recordingFetch(interactions: Interaction[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (KEPT_HEADERS.test(k)) headers[k] = v;
    });
    interactions.push({
      url: String(input),
      status: res.status,
      headers,
      body,
    });
    return new Response(body, { status: res.status, headers: res.headers });
  }) as typeof fetch;
}

/** Fetch that answers only from a cassette; unknown requests fail loudly. */
export function replayFetch(cassette: Cassette): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = cassette.interactions.find((i) => i.url === url);
    if (!hit)
      throw new Error(`Request not in cassette "${cassette.scenario}": ${url}`);
    return new Response(hit.body, { status: hit.status, headers: hit.headers });
  }) as typeof fetch;
}

/** A local "YYYY-MM-DD" for the next given weekday at least 3 days out. */
export function upcomingDate(weekday: number, from = new Date()): string {
  const d = new Date(from.getTime() + 3 * 86400_000);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
