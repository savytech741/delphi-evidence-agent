/** A market card from the competition site's /markets.json. The export has more fields; these are the ones the agent reads. */
export interface MarketCard {
  address: string;
  question: string;
  status: string;
  odds: { yes: number; no: number };
  /** ISO timestamp after which the market stops taking evidence. */
  evidenceCutoffAt: string;
  dataSources?: string[];
  category?: string;
  /** When the market closes / settles (field names vary; read defensively). */
  closesAt?: string;
  settlesAt?: string;
  resolvesAt?: string;
  /** Resolution criteria text (field name varies across exports). */
  resolutionCriteria?: string;
  criteria?: string;
  resolution?: string;
  /** Reward pots, when present. */
  judgementPot?: number;
  settlementPot?: number;
  [key: string]: unknown;
}

/** One researched fact, ready to become a submission note. */
export interface Fact {
  /** The date the fact is true on, e.g. `2026-11-25`. */
  date: string;
  /** The fact itself: one claim, with its number or state. */
  text: string;
  /** Link to the original record (not an article about it). */
  source: string;
  /** Who published the source, when known. */
  publisher?: string;
  /** When the source was published, when known. */
  sourceDate?: string;
  /** Why this fact matters for this market: which part of the resolution criteria it bears on, and in which direction. */
  whyItMatters: string;
  /** The working, when something was computed: inputs, formula, result. */
  working?: string;
  /** Extra links (at most 2 more; the API takes a short list). */
  extraLinks?: string[];
}

export type ResearchProvider = "gemini" | "file";

export interface AgentConfig {
  apiKey: string;
  apiUrl: string;
  siteUrl: string;
  marketsJsonUrl: string;
  agentId: string;
  agentHarness: string;
  agentModel?: string;
  geminiApiKey?: string;
  geminiModel: string;
  researchProvider: ResearchProvider;
  acceptTerms?: string;
  maxMarketsPerCycle: number;
  cycleIntervalMinutes: number;
  dryRun: boolean;
  statePath: string;
  logPath: string;
}
