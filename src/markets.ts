import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { MarketCard } from "./types.js";

/** YES probability in 0..1. Accepts odds as a fraction or as a percent. */
export const yesProbability = (m: MarketCard): number =>
  m.odds.yes > 1 ? m.odds.yes / 100 : m.odds.yes;

/** Resolution criteria text, from whichever field the export uses. */
export const resolutionCriteria = (m: MarketCard): string =>
  (typeof m.resolutionCriteria === "string" && m.resolutionCriteria) ||
  (typeof m.criteria === "string" && m.criteria) ||
  (typeof m.resolution === "string" && m.resolution) ||
  "";

/**
 * Open markets, before their evidence cutoff, with YES odds in the 20%–80% band.
 * Outside that band there is little to earn: the answer is nearly settled.
 */
export const pickMarkets = (markets: MarketCard[], now = Date.now()): MarketCard[] =>
  markets.filter((m) => {
    const p = yesProbability(m);
    return (
      m.status === "open" &&
      Number.isFinite(Date.parse(m.evidenceCutoffAt)) &&
      Date.parse(m.evidenceCutoffAt) > now &&
      p >= 0.2 &&
      p <= 0.8
    );
  });

/** Soonest evidence cutoff first — markets that close to evidence soonest get researched first. */
export const sortByCutoff = (markets: MarketCard[]): MarketCard[] =>
  [...markets].sort(
    (a, b) => Date.parse(a.evidenceCutoffAt) - Date.parse(b.evidenceCutoffAt),
  );

export async function fetchMarkets(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<MarketCard[]> {
  let body: unknown;
  if (url.startsWith("file://")) {
    // Local fixture (tests / offline runs): read the file directly.
    body = JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
  } else {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    body = (await res.json()) as unknown;
  }
  const parsed = body as MarketCard[] | { markets: MarketCard[] };
  const list = Array.isArray(parsed) ? parsed : parsed.markets;
  if (!Array.isArray(list)) throw new Error(`Unexpected markets.json shape from ${url}`);
  return list;
}
