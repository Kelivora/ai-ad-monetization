---
name: ad-platform-selector
description: >-
  Recommends the best ad monetization platform (AdMob, AppLovin MAX, Unity
  LevelPlay) for a specific mobile project, and compares platforms on request.
  Use when the user asks which ad network/mediation to pick, "AdMob or MAX?",
  "compare ad platforms", or in Chinese 选哪个广告平台 / 广告平台对比 / AdMob 还是 MAX /
  广告变现选型. Explains support level per framework and never invents eCPM
  numbers.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad Platform Selector

Reply to the user in the user's language.

## When to use

- The user wants a platform recommendation or comparison for monetizing an app.
- Invoked by the `ad-monetization` orchestrator as its step 2–3.

## Prerequisites

- The MCP server **ad-monetization** must be available (tools like
  `analyze_project`, `recommend_ad_platform`, `compare_ad_platforms`). If the
  tools are missing, tell the user how to install the plugin's MCP server
  (repository root: `npm install && npm run build`, then restart the agent)
  and stop. Do not recommend from memory alone.

## Workflow

1. **Analyze the project** — call `analyze_project(projectPath)`. Read
   `data.framework`, `data.targets`, `data.existingAdSdks`. The framework
   determines which platforms can be automated for this user.
2. **Recommend** — call `recommend_ad_platform` with:
   `framework` (from step 1), `targets` (e.g. `["android","ios"]`),
   `markets`, `appCategory`, `goal` (`revenue|ux|balanced`), and
   `existingSdks` (names from `data.existingAdSdks`, if any).
   Read, per candidate: `platformId`, `score`, `reasons[]`, `cautions[]`,
   `supportLevel`, plus the returned `assumptions` note.
3. **Present the recommendation** — top pick first, with reasons and cautions
   translated for the user. Always disclose that the ranking **score is an
   editorial assessment maintained in this project's knowledge base, not an
   official figure**, and that eCPM/revenue claims are NOT included because
   they vary by app, geo and season.
4. **Compare (only when the user asks)** — call
   `compare_ad_platforms(platformIds, framework, markets)`. Render the
   dimension table (framework support, formats, mediation, setup difficulty,
   market fit, reporting API, official skill) as Markdown. If the user did not
   ask, skip this step.
5. **Check support level honestly** — see Decision logic. If the user chooses
   a platform whose support for their framework is not `automated`, say
   exactly what the plugin can and cannot do for them.

## Decision logic

| `supportLevel` of the chosen platform × framework | What to tell the user |
| --- | --- |
| `automated` (MVP: admob × flutter) | Full support: plan diff, apply, validate, verify all via tools. |
| `delegate-official-skill` (e.g. unity × levelplay; native android/ios × admob) | This plugin will not write the integration; it delegates to the vendor skill returned by `get_integration_guide` (`data.officialSkill.install`). We still provide selection, placement advice, compliance checklist and revenue analysis. |
| `guided` | Step-by-step instructions and docs via `get_integration_guide` / `get_platform_docs`; the user writes the code (or asks us to, with their consent, outside automated tooling). |
| `unsupported` | Say plainly it is not supported; offer the closest alternative. |

Additional rules:

- `data.existingAdSdks` non-empty → strongly prefer the already-integrated
  platform (switching means migration cost and policy risk); recommend change
  only with an explicit user decision.
- Never quote eCPM/CTR benchmarks as facts. If the user insists on numbers,
  explain they must come from their own reports (`ad-revenue-optimizer`
  skill).
- Treat `sources[].stale` results as a warning to the user: the knowledge may
  be outdated; verify against official docs.

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `INVALID_INPUT` | Bad parameter (e.g. unknown market code) | Fix the parameter from the error `hint`; re-run. |
| `UNSUPPORTED_FRAMEWORK` | Framework detected but no platform supports it | Report; suggest checking the support matrix resource `ad-monetization://capabilities`. |
| `KNOWLEDGE_MISSING` | A platform's knowledge entry is missing | Exclude it from the comparison; tell the user why. |
| `INTERNAL` | Unexpected error | Report message; retry once; then stop. |

## Output

- Recommended platform with reasons and cautions, in the user's language.
- Support level for the user's framework and what it means practically.
- If compared: a Markdown dimension table.
- The editorial-assessment disclaimer and any `stale` source warnings.
- Next step suggestion: `ad-unit-planner`.

## References

- `references/selection-criteria.md` — how scoring works, what is editorial,
  how to talk about support levels.

## Core rules

- Scores are editorial assessments — always label them as such.
- Never fabricate eCPM, fill-rate or revenue figures.
- Be explicit about automation support level; never imply `automated` support
  where there is none.
- Prefer keeping an already-integrated SDK unless the user decides otherwise.
