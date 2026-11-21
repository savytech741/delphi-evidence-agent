import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface MarketState {
  /** Normalized fact texts already submitted on this market (by hash). */
  submittedFactHashes: string[];
  /** Submission ids, in order. */
  submissionIds: string[];
  /** Verdicts seen, in order. */
  verdicts: string[];
  /** Total USDC.e rewards recorded on this market (judgment + settlement, as reported). */
  totalReward: number;
}

export interface AgentState {
  markets: Record<string, MarketState>;
  /** Total submissions sent by this agent. */
  totalSubmissions: number;
  /** Total rewards recorded (judgment + settlement). */
  totalReward: number;
  updatedAt: string;
}

export const emptyState = (): AgentState => ({
  markets: {},
  totalSubmissions: 0,
  totalReward: 0,
  updatedAt: new Date().toISOString(),
});

export const normalizeFact = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const factHash = (text: string): string =>
  createHash("sha256").update(normalizeFact(text)).digest("hex").slice(0, 16);

export async function loadState(path: string): Promise<AgentState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as AgentState;
    if (!parsed || typeof parsed !== "object" || !parsed.markets) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

export async function saveState(path: string, state: AgentState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function appendLog(
  path: string,
  entry: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    "utf8",
  );
}

export function marketState(state: AgentState, address: string): MarketState {
  const key = address.toLowerCase();
  const existing = state.markets[key];
  if (existing) return existing;
  const fresh: MarketState = {
    submittedFactHashes: [],
    submissionIds: [],
    verdicts: [],
    totalReward: 0,
  };
  state.markets[key] = fresh;
  return fresh;
}
