# Metrics and Optimization Levers

## Metric definitions (use exactly these)

| Metric | Formula | Read it as |
| --- | --- | --- |
| eCPM | revenue ÷ impressions × 1000 | Effective revenue per thousand ad impressions. |
| Match rate (填充率) | matched requests ÷ ad requests | How often a request found any ad to serve. |
| Show rate | impressions ÷ matched requests | How often a matched ad actually displayed (readiness & placement timing). |
| CTR | clicks ÷ impressions | Click-through rate. |

Common confusions to correct for users:

- "Fill rate" in AdMob reporting is **match rate**; a low match rate is a
  demand/inventory issue, not a code bug.
- High match rate + low show rate usually means the ad wasn't ready at the
  moment the app wanted to show it (preloading or placement timing), or the
  ad surface was never actually shown.
- eCPM varies enormously by country, format, season and app category —
  never compare against quoted "typical eCPM" numbers.

## Optimization lever catalog (all heuristics)

Each lever targets a metric; every suggestion must be labeled heuristic and
verified in the user's app.

### Show rate

- Preload interstitials/rewarded ahead of natural break points (the
  generated controllers already do this — verify usage).
- Show ads only when actually ready; never queue a bad experience waiting.

### Match rate / eCPM (demand side)

- Mediation (multiple networks competing per impression) — the main lever at
  scale; **phase 3** of this project (AdMob mediation / MAX / LevelPlay
  comparison).
- Ensure consent is not silently degrading requests in EEA (unpublished GDPR
  message → limited ads).
- Country mix: multi-country benchmarking arrives in phase 3; today, break
  down by country dimension from their data.

### Format & placement mix

- Rewarded typically carries the highest eCPM and the least UX damage when
  opt-in — expand user-initiated entry points.
- Banners: adaptive sizes (anchored/inline) beat fixed sizes; position
  matters (inline in feeds vs anchored on static screens).
- Interstitials: revenue-dense but policy- and retention-sensitive — keep
  natural-break placement and frequency caps; do not loosen caps to chase
  eCPM.

### Housekeeping

- app-ads.txt published (prevents revenue leakage to spoofers).
- Test IDs never in production (would show test ads, zero revenue).
- Ad unit activation in the AdMob console before launch.

## Policy red lines (never recommend)

- Incentivizing or forcing clicks; "click ads to unlock".
- Interstitials at app launch/exit, mid-action, or back-to-back.
- Ads overlapping content or placed to bait accidental clicks.

Violations risk ad serving limits or account suspension — refuse these asks
and explain why.

## Data sources

1. AdMob console report export (CSV/JSON) → `get_ad_revenue(source: "file")`.
2. AdMob API with the user's token in `ADMOB_ACCESS_TOKEN` →
   `get_ad_revenue(source: "admob_api")`.
3. Community AdMob MCP for live access: https://github.com/jerry2247/admob-mcp
   (user installs & authorizes) — then feed rows to `analyze_ad_performance`.

## Roadmap note

Phase 3 of this project adds: mediation strategy comparison, multi-country
benchmarks, and (potentially) more reporting adapters. Tell users asking for
those that they are coming, so recommendations today stay
placement/frequency-level.
