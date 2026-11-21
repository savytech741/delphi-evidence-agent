import { resolutionCriteria, yesProbability } from "./markets.js";
import type { Fact, MarketCard } from "./types.js";

const RESEARCH_SYSTEM = `You research one dated fact for a prediction market. Return JSON only.

Rules (these decide whether the fact earns anything):
- Find ONE fact that bears on the market's resolution criteria and that a news-reading forecaster is unlikely to already have. Prefer: calculations on official data (statistics office tables, central bank files, standards trackers), fresh state read from the primary record (a release pipeline, a ballot position, a committee report, a court docket, a regulator's register), local-language or niche sources, or a connection nobody has made yet.
- Do NOT return: widely reported news, what the market's listed sources already say, odds from other prediction markets or bookmakers, confirmation that nothing changed, a scheduled event everyone knows about, a public live reading anyone can fetch, or a base rate restated.
- The fact must be checkable from the source you link. Link the original record, not an article about it. Say who published it and when.
- One claim only. Never tell the reader what verdict to give, and never state a market direction without a fact behind it.
- Dates matter: give the date the fact is true on and the date the source was published.

Return exactly this JSON shape, nothing else:
{"fact": "<one claim, with its number or state>", "date": "YYYY-MM-DD", "source": "<URL of the original record>", "publisher": "<who published it>", "sourceDate": "YYYY-MM-DD or null", "whyItMatters": "<which part of the resolution criteria it bears on, and in which direction>", "working": "<inputs, formula and result, or null if nothing was computed>"}
If no such fact exists, return exactly: {"noFact": "<one sentence why>"}`;

export interface GeminiResult {
  fact: Fact | null;
  noFactReason?: string;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
  }[];
}

/** Extract the JSON object from model output (it may arrive wrapped in a code fence). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

export function buildResearchPrompt(market: MarketCard, now = new Date()): string {
  const criteria = resolutionCriteria(market) || "(no resolution criteria listed)";
  const sources = (market.dataSources ?? []).join(", ") || "(none listed)";
  return [
    `Market question: ${market.question}`,
    `Category: ${market.category ?? "unknown"}`,
    `Current odds: YES ${(yesProbability(market) * 100).toFixed(1)}% / NO ${((1 - yesProbability(market)) * 100).toFixed(1)}%`,
    `Evidence cutoff: ${market.evidenceCutoffAt}`,
    `Resolution criteria: ${criteria}`,
    `Market's listed data sources: ${sources}`,
    `Today is ${now.toISOString().slice(0, 10)}. Find one new dated fact for this market.`,
  ].join("\n");
}

/**
 * Research one market with Gemini + Google Search grounding.
 * Returns a fact, or null with a reason when no earning fact exists.
 */
export async function researchWithGemini(
  market: MarketCard,
  opts: { apiKey: string; model: string; fetchFn?: typeof fetch; log?: (...a: unknown[]) => void },
): Promise<GeminiResult> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent` +
    `?key=${encodeURIComponent(opts.apiKey)}`;
  const body = {
    system_instruction: { parts: [{ text: RESEARCH_SYSTEM }] },
    contents: [{ parts: [{ text: buildResearchPrompt(market) }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  };
  const res = await (opts.fetchFn ?? fetch)(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini request failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) return { fact: null, noFactReason: "empty model response" };
  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson(text) as Record<string, unknown>;
  } catch {
    opts.log?.("gemini output was not JSON, skipping market");
    return { fact: null, noFactReason: "model output was not JSON" };
  }
  if (typeof parsed.noFact === "string") {
    return { fact: null, noFactReason: parsed.noFact };
  }
  if (typeof parsed.fact !== "string" || typeof parsed.source !== "string") {
    return { fact: null, noFactReason: "model output missing fact or source" };
  }
  // Prefer a grounded URL when the model gave a bare or search-result link.
  const grounded = data.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((c) => c.web?.uri)
    .filter((u): u is string => !!u);
  const fact: Fact = {
    date:
      typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : new Date().toISOString().slice(0, 10),
    text: parsed.fact,
    source: parsed.source,
    publisher: typeof parsed.publisher === "string" ? parsed.publisher : undefined,
    sourceDate: typeof parsed.sourceDate === "string" ? parsed.sourceDate : undefined,
    whyItMatters: typeof parsed.whyItMatters === "string" ? parsed.whyItMatters : "",
    working: typeof parsed.working === "string" ? parsed.working : undefined,
    extraLinks: grounded?.filter((u) => u !== parsed.source).slice(0, 2),
  };
  return { fact };
}
