/** Fixture test — no API key, no network. Run: npm run test:fixtures */
import { readFileSync } from "node:fs";
import { fetchMarkets, pickMarkets, sortByCutoff, yesProbability } from "../src/markets.js";
import { composeNote } from "../src/agent.js";
import { factHash, normalizeFact } from "../src/state.js";
import { researchFromEnv } from "../src/research-file.js";
import { extractJson } from "../src/research-gemini.js";
import type { MarketCard } from "../src/types.js";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

// Fixture markets: 0x1111 in-band + open + before cutoff (pick), 0x2222 95% (skip),
// 0x3333 past cutoff (skip), 0x4444 settled (skip), 0x5555 80% as percent (pick).
const markets = JSON.parse(
  readFileSync(new URL("./fixtures/markets.json", import.meta.url), "utf8"),
) as MarketCard[];
const now = Date.parse("2026-11-21T06:00:00Z");

check("fixture has 5 markets", markets.length === 5);
check("yesProbability accepts percent odds", yesProbability(markets[4]) === 0.8);
const picked = pickMarkets(markets, now);
check(
  "pickMarkets keeps only in-band open markets before cutoff",
  picked.length === 2 &&
    picked.some((m) => m.address.startsWith("0x1111")) &&
    picked.some((m) => m.address.startsWith("0x5555")),
  `picked ${picked.map((m) => m.address.slice(0, 6)).join(", ")}`,
);
const sorted = sortByCutoff(picked);
check(
  "sortByCutoff puts the soonest cutoff first",
  sorted[0].address.startsWith("0x5555"),
);

// fetchMarkets reads a local file:// URL directly (and http(s) over fetch).
const fileUrl = new URL("./fixtures/markets.json", import.meta.url).toString();
const fetched = await fetchMarkets(fileUrl);
check("fetchMarkets reads a markets list", fetched.length === 5);

// Note composition order: fact, source, why, working.
const note = composeNote({
  date: "2026-11-07",
  text: "The statistics office's monthly CPI table gives October at 4.21% year on year.",
  source: "https://example.com/cpi",
  publisher: "Statistics Office",
  sourceDate: "2026-11-07",
  whyItMatters:
    "The market resolves Yes if November prints at or above 4.00%. For November to fall below 4.00%, the month-on-month change must be at most -0.06%.",
  working: "October 4.21% YoY; November needs MoM <= -0.06% to print below 4.00%.",
});
check(
  "composeNote orders fact, source, why, working",
  note.indexOf("As of 2026-11-07:") === 0 &&
    note.indexOf("Source: Statistics Office (2026-11-07) https://example.com/cpi") > 0 &&
    note.indexOf("Why it matters:") > note.indexOf("Source:") &&
    note.indexOf("Working:") > note.indexOf("Why it matters:"),
);
check("composeNote stays under the 8000-char limit", note.length < 8000);

// Fact dedupe: same fact, different case/punctuation → same hash.
check(
  "factHash normalises case and punctuation",
  factHash("October CPI was 4.21%!") === factHash("october cpi was 4.21"),
);
check("normalizeFact trims to words", normalizeFact("  Hello,  World! ") === "hello world");

// File provider: only for the market at MARKET_ADDRESS.
const env = {
  FACT: "October CPI was 4.21%.",
  FACT_SOURCE: "https://example.com/cpi",
  MARKET_ADDRESS: markets[0].address,
};
check(
  "researchFromEnv returns the fact for its market",
  researchFromEnv(markets[0], env)?.text === "October CPI was 4.21%.",
);
check(
  "researchFromEnv returns null for other markets",
  researchFromEnv(markets[1], env) === null,
);
check(
  "researchFromEnv returns null without env",
  researchFromEnv(markets[0], {}) === null,
);

// Gemini JSON extraction: fenced and bare.
const parsed = extractJson('```json\n{"fact": "x", "date": "2026-11-07"}\n```') as { fact: string };
check("extractJson unwraps a fenced block", parsed.fact === "x");
const parsed2 = extractJson('noise {"noFact": "none found"} trailing') as { noFact: string };
check("extractJson finds the object in noise", parsed2.noFact === "none found");

if (failures > 0) {
  console.error(`${failures} fixture test(s) failed`);
  process.exit(1);
}
console.log("All fixture tests passed.");
