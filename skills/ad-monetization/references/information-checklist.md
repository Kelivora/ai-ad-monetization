# Information Checklist (orchestrator input collection)

Collect these four items **once**, before the workflow starts. Infer from the
project whenever possible; ask the user only for what remains unknown; use
defaults only when interaction is impossible.

## 1. Target markets

- What to ask: "这个 App 主要面向哪些市场？"（例如 美国、欧洲、日本、只在国内）
- Why it matters: markets drive the compliance path (GDPR vs US state laws vs
  none) in `ad-compliance-checker` and feed `recommend_ad_platform(markets)`.
- Inference: `analyze_project` does not reveal markets; if the user's original
  request already mentions regions ("面向美国和欧洲"), use that and do not ask.
- Non-interactive default: treat as `["US"]` and note the assumption. If the
  user later says EEA/UK/CH users exist, re-run the compliance skill.

## 2. App category

- What to ask: what kind of app/game is this (e.g. casual game, tool, news,
  social)?
- Why it matters: `plan_ad_placements(appCategory)` uses it to pick formats and
  frequency caps; child-related categories raise COPPA questions.
- Inference: from `analyze_project` `data.appName`, `pubspec.yaml` description,
  or visible screen list.
- Non-interactive default: omit the parameter (the tool applies neutral
  defaults) and note it.

## 3. Monetization goal

- Options: `revenue` (maximize income), `ux` (protect experience),
  `balanced`.
- What to ask: "更看重收益还是用户体验？"
- Why it matters: drives format priority and interstitial frequency caps in
  `plan_ad_placements(goal)` and `recommend_ad_platform(goal)`.
- Inference: none reliable — ask. If the user is unsure, use `balanced`.
- Non-interactive default: `balanced`.

## 4. Child-directed?

- What to ask: "App 是否主要面向儿童（13 岁以下）？"
- Why it matters: sets `childDirected` in `validate_ad_config`, triggers
  `CHILD_DIRECTED_TAG` rules, Google Play Families policy, and restricts
  ad formats (no personalized ads, no interstitials in Families programs).
- Inference: category hints (kids education, coloring apps) are only hints —
  confirm with the user; getting this wrong is a policy violation.
- Non-interactive default: `false`, and state the assumption prominently.

## Ad formats

- Default when not specified: `banner`, `interstitial`, `rewarded`
  (the MVP set). Adjust per goal: `ux` → rewarded first; `revenue` → all
  three. Always let `ad-unit-planner` refine placement before locking formats.

## Reporting defaults in the final report

Whenever a default was used, the final report must contain a section like:

> Assumed defaults (no interaction available): goal=balanced,
> formats=banner+interstitial+rewarded, childDirected=false, markets=[US].
> To change any of these, tell me and I will re-run the affected steps.
