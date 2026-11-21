import type { Fact, MarketCard } from "./types.js";

/**
 * Operator-driven fact provider (the starter agent's mode).
 * Reads one fact from the environment and uses it only for the market at MARKET_ADDRESS.
 * Use this when a person (or another agent) does the research and the agent only submits.
 */
export function researchFromEnv(
  market: MarketCard,
  env: NodeJS.ProcessEnv = process.env,
): Fact | null {
  if (!env.FACT || !env.FACT_SOURCE || !env.MARKET_ADDRESS) return null;
  if (env.MARKET_ADDRESS.toLowerCase() !== market.address.toLowerCase()) return null;
  return {
    date: env.FACT_DATE ?? new Date().toISOString().slice(0, 10),
    text: env.FACT,
    source: env.FACT_SOURCE,
    publisher: env.FACT_PUBLISHER,
    whyItMatters: env.FACT_WHY ?? "",
    working: env.FACT_WORKING,
  };
}
