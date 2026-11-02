---
name: ad-revenue-optimizer
description: >-
  Analyzes ad revenue data (eCPM, match rate, show rate, CTR) from AdMob
  report exports (CSV/JSON) or the AdMob API via a user-supplied access
  token, and suggests placement/frequency improvements clearly labeled as
  heuristics. Use when the user asks about ad revenue, eCPM, fill rate,
  "怎么提高广告收益", or in Chinese 广告收益分析 / eCPM 太低 / 填充率 / 收益优化.
  Account authorization is always done by the user — never by the agent.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad Revenue Optimizer

Reply to the user in the user's language.

## When to use

- The user has revenue data (exported reports) and wants analysis/advice.
- The user asks how to increase ad revenue / eCPM / fill rate.

## Prerequisites

- The MCP server **ad-monetization** must be available (`get_ad_revenue`,
  `analyze_ad_performance`). If missing, tell the user how to install it
  (repository root: `npm install && npm run build`, then restart the agent)
  and stop.
- Data source — one of:
  1. **Exported file** (default): the user exports a report from the AdMob
     console (CSV or JSON) and gives you the path. Nothing sensitive to set
     up. `source: "file"`, `filePath`.
  2. **AdMob API**: the user obtains their own OAuth access token and puts it
     in the environment variable `ADMOB_ACCESS_TOKEN`. `source: "admob_api"`,
     plus `publisherId` and date range. If the token is absent the tool
     returns `AUTH_REQUIRED` — the agent never performs the OAuth login or
     touches the user's account credentials.
  3. **Online data via community AdMob MCP** (optional): recommend
     https://github.com/jerry2247/admob-mcp for live AdMob API access; the
     user installs/authorizes it themselves. Then pass exported row data to
     `analyze_ad_performance`.
- Account authorization is **always performed by the user personally** — no
  browser automation, no credential handling by the agent.

## Workflow

1. **Establish the data source** — per Prerequisites; prefer the file export
   unless the user already has the API set up.
2. **Load revenue rows** — `get_ad_revenue(platformId: "admob", source,
   filePath | publisherId+startDate+endDate, dimensions?)`. Read
   `data.rows` (normalized) and `warnings` (e.g. rows skipped for missing
   fields).
3. **Analyze** — `analyze_ad_performance(rows: data.rows)` (or `filePath`).
   Read `data.metrics` (eCPM, match rate, show rate, CTR — definitions in
   `references/metrics-and-levers.md`), per-dimension splits, and
   `data.insights[]` (each labeled `heuristic`).
4. **Present findings** — metrics table + dimension breakdown (country,
   format, ad unit) in the user's language, with the metric definitions
   restated briefly (users constantly confuse fill/match/show rates).
5. **Recommend levers** — from `references/metrics-and-levers.md`, mapped to
   the user's weak metrics, each suggestion labeled as a **heuristic** that
   must be A/B-verified in their own app. Never promise revenue outcomes.
6. **Set expectations** — note that mediation strategy comparison and
   multi-country benchmarking arrive in phase 3 of this project; today's
   advice is placement/frequency/format-level.

## Decision logic

| Observation | Heuristic direction (label as heuristic) |
| --- | --- |
| Low show rate (impressions ÷ matched) | Ads not ready at demand moments: check preloading and placement timing. |
| Low match rate | Thin demand for geo/format: consider mediation (phase 3) or different formats; verify no consent loss in EEA. |
| Low CTR on banners | Banner placement/type issues: inline vs anchored, position, refresh behavior. |
| Interstitial-heavy revenue but retention risk | Review frequency cap; interstitials must stay at natural breaks (policy). |
| Rewarded eCPM high | Add/expand user-initiated rewarded entry points (opt-in only). |
| One country dominates | Market-specific formats/consent setup; multi-country comparison lands in phase 3. |

Never suggest policy-violating tactics: incentivized/forced clicks, extra
interstitials beyond natural break points, ads disguised as UI, or begging
clicks. If the user asks for such, refuse and explain the policy risk
(account suspension).

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `AUTH_REQUIRED` | `ADMOB_ACCESS_TOKEN` missing/invalid for `admob_api` | Tell the user to create the token themselves (or switch to file export). Never ask for the raw credential in chat beyond the documented env var. |
| `INVALID_INPUT` | Bad date range/format | Correct per `hint`; re-run. |
| `COMMAND_FAILED` | File unreadable / malformed | Ask for a re-export; show the parse error. |
| `KNOWLEDGE_MISSING` | Benchmark knowledge missing | Analysis works from their data alone; note it. |
| `INTERNAL` | Unexpected | Report; retry once. |

## Output

- Metrics summary + dimension tables, in the user's language.
- Metric definitions (one line each).
- Ranked heuristic suggestions, explicitly labeled "启发式建议，需要在你的 App
  中验证" — no revenue promises.
- Data-source note (file export vs API vs community MCP) and the phase-3
  roadmap caveat.

## References

- `references/metrics-and-levers.md` — metric formulas, common
  misreadings, and the optimization lever catalog.

## Core rules

- Account authorization is the user's job, always.
- Label every recommendation as a heuristic; promise nothing.
- Never suggest anything that violates AdMob policy (click incentives,
  excessive interstitials, misleading placements).
- Base numbers on the user's actual data; never quote invented eCPM
  benchmarks.
