# Platform Selection Criteria

## How the recommendation is produced

`recommend_ad_platform` scores each candidate platform for the user's exact
context (framework, targets, markets, app category, goal, existing SDKs) using
criteria maintained in this project's knowledge base
(`knowledge/common/benchmarks.json`). The scoring weights are **editorial
assessments** — opinions curated by this project's maintainers with sources —
**not official vendor statements**. Every recommendation must be presented
with that label.

## Criteria dimensions

| Dimension | What it captures | Notes |
| --- | --- | --- |
| Framework support | Can we automate integration for this framework? | Dominant factor; see SupportLevel below. |
| Format coverage | banner / interstitial / rewarded / native / app-open | Match against the user's placement plan. |
| Mediation | Does it run a unified auction across networks? | Matters at scale; MVP does not automate mediation setup. |
| Setup difficulty | Steps, account requirements, dashboard complexity | Editorial. |
| Market fit | Strength in the user's target geos | Editorial; never quote as fact. |
| Reporting API | Programmatic revenue access | Needed by `ad-revenue-optimizer`. |
| Official skill | Is there a vendor agent skill to delegate to? | Avoids duplicating official work. |

## Support levels (be precise with users)

- `automated` — the MCP server can generate patches, validate and verify.
  MVP: **admob × flutter only**.
- `delegate-official-skill` — a vendor skill exists and should do the code
  work (native android/ios × admob → Google official skills; unity ×
  levelplay → Unity official skill). Install command comes from
  `get_integration_guide` → `data.officialSkill.install`.
- `guided` — we provide ordered steps and documentation pointers; the user
  (or their agent, manually) writes the code.
- `unsupported` — no path offered by this plugin.

## Talking about money

- Do **not** state eCPM/fill-rate numbers for any platform or geo.
- If asked "which pays more": explain payout depends on the app's traffic
  (geo, category, retention, placements), and the honest way to answer is to
  run one platform, collect real data, and analyze it with the
  `ad-revenue-optimizer` skill.

## Existing SDK rule

If `analyze_project` → `data.existingAdSdks` is non-empty, the existing
platform gets a strong preference bonus (migration cost, dual-SDK policy risk
such as overlapping ad rendering). Switching is a user decision, presented
with trade-offs, not a default.
