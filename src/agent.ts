/**
 * Florex Evidence — evidence-mining agent for the Delphi Agent Arena Competition.
 *
 * One cycle: read the competition markets, pick open markets with YES odds in the
 * 20%–80% band before their evidence cutoff, research one new dated fact per
 * market, submit it to Delphi, poll the result, and log everything.
 *
 * Run one cycle:   npm run agent
 * Dry run (no submits, no key needed):  npm run agent -- --dry-run
 * Loop forever:    npm run agent -- --loop
 *
 * The agent never accepts the evidence terms on its own: set ACCEPT_TERMS to the
 * exact current version only after the account holder has read the terms and
 * approved that version.
 */
import "dotenv/config";
import { EvidenceApiError, EvidenceClient, TermsNotAcceptedError } from "@gensyn-ai/gensyn-delphi-sdk";
import { fetchMarkets, pickMarkets, sortByCutoff } from "./markets.js";
import { researchWithGemini } from "./research-gemini.js";
import { researchFromEnv } from "./research-file.js";
import {
  appendLog,
  factHash,
  loadState,
  marketState,
  saveState,
} from "./state.js";
import type { AgentConfig, Fact, MarketCard } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const need = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (!v) throw new Error(`${k} is required (see .env.example)`);
  return v;
};

function loadConfig(): AgentConfig {
  const dryRun =
    process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
  return {
    apiKey: dryRun ? process.env.DELPHI_API_ACCESS_KEY ?? "" : need("DELPHI_API_ACCESS_KEY"),
    apiUrl: process.env.DELPHI_API_URL ?? "https://delphi.fyi/v1",
    siteUrl: (process.env.COMPETITION_SITE_URL ?? "https://competition.delphi.fyi").replace(/\/+$/, ""),
    marketsJsonUrl:
      process.env.MARKETS_JSON_URL ??
      `${(process.env.COMPETITION_SITE_URL ?? "https://competition.delphi.fyi").replace(/\/+$/, "")}/markets.json`,
    agentId: process.env.AGENT_ID ?? "florex-evidence",
    agentHarness: process.env.AGENT_HARNESS ?? "muse-agent",
    agentModel: process.env.AGENT_MODEL || undefined,
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    researchProvider:
      process.env.RESEARCH_PROVIDER === "gemini" ? "gemini" : "file",
    acceptTerms: process.env.ACCEPT_TERMS || undefined,
    maxMarketsPerCycle: Number(process.env.MAX_MARKETS_PER_CYCLE ?? 3) || 3,
    cycleIntervalMinutes: Number(process.env.CYCLE_INTERVAL_MINUTES ?? 60) || 60,
    dryRun,
    statePath: process.env.STATE_PATH ?? "./state/evidence-state.json",
    logPath: process.env.LOG_PATH ?? "./evidence-log.jsonl",
  };
}

/** The note, in the order the evidence guide asks for: fact, source, why it matters, working. */
export function composeNote(fact: Fact): string {
  const lines = [`As of ${fact.date}: ${fact.text}`, ""];
  const sourceBits = [
    fact.publisher ? `Source: ${fact.publisher}` : "Source:",
    fact.sourceDate ? `(${fact.sourceDate})` : "",
    fact.source,
  ]
    .filter(Boolean)
    .join(" ");
  lines.push(sourceBits);
  if (fact.whyItMatters) lines.push("", `Why it matters: ${fact.whyItMatters}`);
  if (fact.working) lines.push("", `Working: ${fact.working}`);
  const note = lines.join("\n");
  if (note.length > 8000) return note.slice(0, 7997) + "...";
  return note;
}

async function research(
  market: MarketCard,
  cfg: AgentConfig,
  log: (...a: unknown[]) => void,
): Promise<{ fact: Fact | null; noFactReason?: string }> {
  if (cfg.researchProvider === "gemini") {
    if (!cfg.geminiApiKey) {
      log("gemini provider selected but GEMINI_API_KEY is not set — skipping market");
      return { fact: null, noFactReason: "no Gemini key" };
    }
    return researchWithGemini(market, {
      apiKey: cfg.geminiApiKey,
      model: cfg.geminiModel,
      log,
    });
  }
  const fact = researchFromEnv(market);
  if (!fact) return { fact: null, noFactReason: "no FACT/FACT_SOURCE/MARKET_ADDRESS for this market" };
  return { fact };
}

async function runCycle(cfg: AgentConfig): Promise<void> {
  const log = console.log;
  const state = await loadState(cfg.statePath);
  log(`[florex-evidence] cycle start (dryRun=${cfg.dryRun}, provider=${cfg.researchProvider})`);

  let markets: MarketCard[];
  try {
    markets = await fetchMarkets(cfg.marketsJsonUrl);
  } catch (e) {
    log(`[florex-evidence] could not read the markets list (${(e as Error).message}). The competition markets may not be live yet — they open 25 November 2026.`);
    return;
  }
  const picked = sortByCutoff(pickMarkets(markets));
  log(`[florex-evidence] ${markets.length} markets listed, ${picked.length} open in the 20%–80% band before cutoff`);
  if (picked.length === 0) return;

  const client = cfg.dryRun
    ? null
    : new EvidenceClient({
        baseUrl: cfg.apiUrl,
        apiKey: cfg.apiKey,
        agentId: cfg.agentId,
        agentHarness: cfg.agentHarness,
        agentModel: cfg.agentModel,
      });

  if (client) {
    // Limits first: never start a batch we cannot finish.
    try {
      const { data: limits } = await client.getLimits();
      log(`[florex-evidence] limits: ${limits.submitsLeftThisHour} submits left this hour, daily cap left ${limits.dailyCapLeft}`);
      if (limits.submitsLeftThisHour <= 0 || limits.dailyCapLeft <= 0) {
        log("[florex-evidence] no submissions left — stopping this cycle");
        return;
      }
    } catch (e) {
      if (e instanceof EvidenceApiError) {
        log(`[florex-evidence] limits check failed: ${e.code} ${e.message} — stopping`);
      } else {
        log(`[florex-evidence] limits check failed: ${(e as Error).message} — stopping`);
      }
      return;
    }

    // Terms: accept only the exact version the account holder approved.
    try {
      const { data: terms } = await client.getTerms();
      if (terms.acceptedAt === null) {
        if (cfg.acceptTerms !== terms.version) {
          log(`[florex-evidence] evidence terms not accepted. Read them at ${terms.url}, then set ACCEPT_TERMS=${terms.version} to accept and submit. Stopping.`);
          return;
        }
        await client.acceptTerms(terms.version);
        log(`[florex-evidence] accepted evidence terms ${terms.version}`);
      }
    } catch (e) {
      if (e instanceof TermsNotAcceptedError) {
        log(`[florex-evidence] terms not accepted: read ${e.terms.url}, set ACCEPT_TERMS=${e.terms.version}. Stopping.`);
      } else {
        log(`[florex-evidence] terms check failed: ${(e as Error).message} — stopping`);
      }
      return;
    }
  }

  let submittedThisCycle = 0;
  for (const market of picked.slice(0, cfg.maxMarketsPerCycle)) {
    const ms = marketState(state, market.address);
    if (ms.submissionIds.length >= 3) {
      log(`[skip] ${market.address}: already used all 3 submissions on this market`);
      continue;
    }

    if (client) {
      try {
        const { data: entry } = await client.getEntryState(market.address);
        if (!entry.canSubmit) {
          log(`[skip] ${market.address}: ${entry.reason ?? "cannot submit"}`);
          continue;
        }
        if (entry.remainingOnMarket <= 0) {
          log(`[skip] ${market.address}: no submissions left on this market`);
          continue;
        }
        if (entry.judgementPotRemainingBaseUnits === "0") {
          log(`[note] ${market.address}: judgement pot is empty — a submission can still earn at settlement`);
        }
      } catch (e) {
        if (e instanceof EvidenceApiError && e.code === "rate_limited") {
          log(`[florex-evidence] rate limited (${e.limit ?? ""}) — stopping this cycle`);
          break;
        }
        log(`[skip] ${market.address}: entry-state failed (${(e as Error).message})`);
        continue;
      }
    }

    const { fact, noFactReason } = await research(market, cfg, log).catch((e) => {
      log(`[skip] ${market.address}: research failed (${(e as Error).message})`);
      return { fact: null as Fact | null, noFactReason: "research error" };
    });
    if (!fact) {
      log(`[skip] ${market.address}: ${noFactReason ?? "no fact found"}`);
      continue;
    }

    const hash = factHash(fact.text);
    if (ms.submittedFactHashes.includes(hash)) {
      log(`[skip] ${market.address}: this fact was already submitted here`);
      continue;
    }

    const note = composeNote(fact);
    const links = [fact.source, ...(fact.extraLinks ?? [])].slice(0, 3);
    await appendLog(cfg.logPath, {
      type: "claim",
      market: market.address,
      question: market.question,
      fact: fact.text,
      source: fact.source,
    });

    if (cfg.dryRun || !client) {
      log(`[dry-run] would submit to ${market.address} (${market.question}):\n${note}\nlinks: ${links.join(", ")}`);
      continue;
    }

    try {
      const { data } = await client.submitEvidence({
        note,
        links,
        marketAddress: market.address,
      });
      log(`[submit] ${data.id} → ${market.address} (status ${data.status})`);
      ms.submittedFactHashes.push(hash);
      ms.submissionIds.push(data.id);
      state.totalSubmissions += 1;
      await appendLog(cfg.logPath, {
        type: "submit",
        market: market.address,
        submissionId: data.id,
        note,
        links,
      });

      const result =
        data.status === "rejected"
          ? data
          : (await client.waitForSubmission(data.id, { timeoutMs: 10 * 60_000 })).data;
      const verdict = result.markets?.[0];
      log(
        `[result] ${data.id}: ${result.status} — verdict ${verdict?.verdict ?? "?"}: ${verdict?.reason ?? ""} reward=${verdict?.bounty?.amount ?? "0"} (${verdict?.bounty?.state ?? ""})${verdict?.zeroPayReason ? ` zeroPayReason=${verdict.zeroPayReason}` : ""}`,
      );
      if (verdict?.verdict) ms.verdicts.push(verdict.verdict);
      const reward = Number(verdict?.bounty?.amount ?? "0") || 0;
      if (reward > 0) {
        ms.totalReward += reward;
        state.totalReward += reward;
      }
      await appendLog(cfg.logPath, {
        type: "result",
        market: market.address,
        submissionId: data.id,
        status: result.status,
        verdict: verdict?.verdict ?? null,
        reason: verdict?.reason ?? null,
        reward,
        zeroPayReason: verdict?.zeroPayReason ?? null,
      });
      await saveState(cfg.statePath, state);
      submittedThisCycle += 1;
    } catch (e) {
      if (e instanceof EvidenceApiError) {
        log(`[error] submit to ${market.address} failed: ${e.code} ${e.message}${e.limit ? ` (limit: ${e.limit})` : ""}`);
        if (e.code === "rate_limited" || e.code === "cap_reached") {
          if (e.code === "rate_limited") break;
          continue;
        }
        if (e.code === "terms_not_accepted") {
          log("[florex-evidence] terms changed or not accepted — stopping this cycle");
          break;
        }
      } else {
        log(`[error] submit to ${market.address} failed: ${(e as Error).message}`);
      }
    }

    // Call-rate safety between submissions.
    if (submittedThisCycle > 0) await sleep(20_000);
  }

  await saveState(cfg.statePath, state);
  log(
    `[florex-evidence] cycle done: ${submittedThisCycle} submitted, ${state.totalSubmissions} total, total rewards ${state.totalReward}`,
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const loop = process.argv.includes("--loop");
  for (;;) {
    try {
      await runCycle(cfg);
    } catch (e) {
      console.error(`[florex-evidence] cycle failed: ${(e as Error).message}`);
    }
    if (!loop) break;
    console.log(`[florex-evidence] sleeping ${cfg.cycleIntervalMinutes} min`);
    await sleep(cfg.cycleIntervalMinutes * 60_000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
