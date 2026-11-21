# Florex Evidence — Delphi Agent Arena: Evidence Mining

An autonomous evidence-mining agent for the **Delphi Agent Arena Competition:
Evidence Mining** (DoraHacks, Gensyn, 25 November – 11 December 2026).

It finds dated, sourced facts on live Delphi prediction markets and sells that
evidence to Delphi. When the evidence makes Delphi's forecaster more accurate,
the submission earns USDC.e. Rank is total rewards on competition markets.

## How it works

One cycle:

1. Read the competition markets from `<site>/markets.json`.
2. Pick **open** markets with YES odds in the **20%–80%** band, before their
   evidence cutoff (soonest cutoff first). Outside that band there is little to
   earn.
3. Check the account limits (`GET /v1/limits`) and the market's entry-state
   (can it take evidence? how many of the 3 submissions per market are left?
   how much of the judgement pot remains?).
4. Research **one new dated fact** per market (see [Strategy](#strategy)).
5. Submit a note + links to Delphi, poll the result until it is judged, and log
   everything to `evidence-log.jsonl` + `state/evidence-state.json`.

The agent never accepts the evidence terms on its own. Set `ACCEPT_TERMS` to
the exact current version only after the account holder has read the terms at
the URL the agent prints and approved that version.

## Setup

```bash
npm install
cp .env.example .env   # fill in the values below
```

| Variable | Where to get it |
|---|---|
| `DELPHI_API_ACCESS_KEY` | Create a **Mainnet** key at https://api-access.delphi.fyi/ (keep Mainnet selected; a Testnet key is refused) with the wallet registered on DoraHacks |
| `AGENT_ID` | A stable name for this agent, e.g. `florex-evidence` |
| `GEMINI_API_KEY` | Only for `RESEARCH_PROVIDER=gemini` — a free Google AI Studio key at https://aistudio.google.com/ |
| `ACCEPT_TERMS` | Only after the account holder reads the terms and approves that exact version |

Before the competition opens you also need, both done by the account holder:

1. A Delphi account on Mainnet at https://app.delphi.fyi — copy the wallet
   address from the profile.
2. Registration on DoraHacks at
   https://dorahacks.io/hackathon/delphi-agent-competition2 with that same
   wallet and the agent name. The wallet is added to the competition within
   about 12 hours. A wallet with no Delphi account is skipped, and a wallet
   that is not registered can't rank.

Evidence submission needs only the API key. No private key, no ETH, no USDC.

## Run

```bash
npm run agent            # one cycle
npm run agent -- --dry-run   # research + print notes, submit nothing (no key needed)
npm run agent -- --loop      # one cycle every CYCLE_INTERVAL_MINUTES (default 60)
```

`RESEARCH_PROVIDER=file` (default) submits a fact the operator supplies via
`FACT`, `FACT_SOURCE`, `FACT_DATE`, `MARKET_ADDRESS` (see `.env.example`) —
the mode the starter agent uses. `RESEARCH_PROVIDER=gemini` researches each
market itself with Gemini + Google Search grounding.

## Strategy

From the competition's own evidence guide — what earns, and what does not:

**Earns:** calculations on official data (a statistics office table, a central
bank file, a standards tracker — do the arithmetic the question needs and show
the inputs and the working); fresh state read from the primary record (a
release pipeline, a ballot position, a committee report, a court docket, a
regulator's register); local-language and niche sources; a connection nobody
has made yet.

**Earns nothing:** widely reported news, what the market's listed sources
already say, odds from other prediction markets or bookmakers, confirmation
that nothing changed, a scheduled event everyone knows about, a public live
reading anyone can fetch, a base rate restated.

**Rules the agent follows:**

- One submission makes one claim. The note says, in order: the fact (with its
  number and date), the source (who published it and when, linked to the
  original record), why it matters for the resolution criteria, and the
  working when something was computed.
- Never submit the same fact twice on a market (local fact-hash dedupe + the
  API's own submission list). Rejected, duplicate and irrelevant submissions
  each use one of the 3 per market, and a low accepted rate drops the account
  to the Restricted tier (1 per market, lower daily cap).
- Racing is a bad strategy: when a public source changes, many agents see it
  within seconds and only the first earns. Prefer evidence that takes work to
  produce over evidence that only takes fast polling.
- Never instruct the judge, never fabricate, never use non-public material.
- Spread across markets: the activity minimum needs at least 10 judged
  submissions across at least 3 competition markets to qualify for prizes.

## Limits (per account)

| Limit | Value |
|---|---|
| Submissions per market | 3 (Standard tier); 1 on the Restricted tier |
| Note | 8,000 characters |
| Files | 3 files, 10 MB total (this agent submits links only for now) |
| Submissions per hour, daily reward cap | Per account — `GET /v1/limits` says what is left |

## Tests

```bash
npm run typecheck
npm run test:fixtures   # market picking, note format, dedupe, providers — no key, no network
```

## Competition facts

- Network: Delphi Mainnet only. Competition: 25 Nov 2026 17:00 UTC – 11 Dec
  2026 17:00 UTC. Winners announced 16 December 2026.
- Each market has a 50 USDC.e pot: 20 judgement + 30 settlement. Evidence
  cutoff is 24 hours before close unless the market list says otherwise.
- Prizes (per the official competition docs): 1st $3,000, 2nd $2,000,
  3rd $1,000, plus five $250 feedback bounties. (The DoraHacks page lists a
  different top-10 split totalling the same $7,250 — confirm the current
  breakdown on the hackathon page before the deadline.)
- Judgement reward is set within minutes; settlement reward follows when the
  market settles, only if the evidence pointed toward the actual outcome.
  Rewards are paid in USDC.e to the Delphi account wallet 24 hours after the
  amount is set.
- Leaderboard: https://competition.delphi.fyi

## Credits

Built on the Gensyn Delphi SDK (`@gensyn-ai/gensyn-delphi-sdk`) and its
evidence-starter example. Competition guide and evidence rules:
`gensyn-ai/gensyn-delphi-skills` (`reference/competition.md`,
`reference/evidence.md`).
