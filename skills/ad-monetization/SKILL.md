---
name: ad-monetization
description: >-
  Orchestrates the complete ad-monetization workflow for a mobile app: analyzes
  the project, recommends an ad platform, plans ad placements, checks privacy
  compliance, integrates the SDK, validates config, verifies the build, and
  produces a final report. Use when the user says "add ads to my app",
  "monetize this app with ads", "set up ad revenue", or in Chinese
  帮我接入广告 / 广告变现 / 接入广告 / 给 App 加广告 / 广告收益.
  MVP fully automates AdMob x Flutter (banner / interstitial / rewarded);
  native Android / iOS / Unity projects are delegated to official vendor
  skills, and other combinations get knowledge-based guidance.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad Monetization (orchestrator)

You are the orchestrator. You do not write SDK code yourself — you drive the
specialized skills in this plugin and the `ad-monetization` MCP tools, and you
relay results. Always reply to the user in the user's language (中文用户用中文回复).

## When to use

- The user wants to add advertising / ad monetization to a mobile app end to
  end ("帮我给这个 App 接入广告变现，主要面向美国和欧洲用户").
- The user asks for a broad combination (e.g. "选平台 + 接入 + 合规 + 验证") rather
  than a single narrow step. For a single step, invoke the matching skill
  directly instead of this one.

## Prerequisites

- The MCP server **ad-monetization** must be connected and its tools available
  (14 tools such as `analyze_project`, `generate_ad_integration`). If the tools
  are missing, tell the user how to install (in this plugin's repository root
  run `npm install && npm run build`, then restart the agent so the MCP server
  in `.mcp.json` starts) and **stop**. Do not write SDK code from memory.
- Know the user's project path. If not given, use the current working
  directory; if it is not a recognizable mobile project, ask once.

## Workflow

Collect missing information **once, up front** (see
`references/information-checklist.md`): target markets, app category,
monetization goal (revenue / ux / balanced), child-directed or not. Infer what
you can from the project (`analyze_project`); only ask what remains. If you
cannot interact (CI / one-shot mode), use defaults — `balanced`,
`banner+interstitial+rewarded`, not child-directed — and state clearly in the
final report which defaults were assumed and how to change them.

Then run the 12-step flow. Each numbered step names the tool or skill to use,
what to pass, and which returned field to look at:

1. **Analyze the tech stack** — call `analyze_project(projectPath)`. Read
   `data.framework`, `data.targets`, `data.existingAdSdks`, `data.git`,
   `data.toolchain`. If `data.issues` is non-empty, surface it to the user.
2. **Recommend a platform** — invoke the `ad-platform-selector` skill, which
   calls `recommend_ad_platform(framework, targets, markets, appCategory, goal)`.
   Read `data[].platformId`, `data[].supportLevel`, `data[].reasons`.
3. **Compare alternatives (only if the user asks)** — the selector skill calls
   `compare_ad_platforms(platformIds, framework, markets)`.
4. **Plan ad placements** — invoke the `ad-unit-planner` skill, which calls
   `plan_ad_placements(appCategory, goal, formats, screens)` passing the
   `data.screens` array from step 1. Read `data.placements`.
5. **Determine compliance requirements BEFORE integration** — invoke the
   `ad-compliance-checker` skill (uses `get_platform_docs` and
   `validate_ad_config` with `markets` and `childDirected`). Its output becomes
   part of the final report's manual-steps section.
6. **Check SDK compatibility** — invoke the `ad-sdk-integrator` skill; it calls
   `get_sdk_compatibility(platformId, framework, projectPath)`. Any
   `incompatible` item must be resolved before code generation.
7. **Generate an integration plan** — the integrator skill calls
   `generate_ad_integration(projectPath, platformId, formats, mode: "plan")`.
   Read `data.plan.changes[]` (path / action / reason / diff),
   `data.plan.manualSteps`, `data.plan.planHash`.
8. **CHECKPOINT (the only mandatory stop)** — present the plan and every diff
   to the user in their language and wait for explicit confirmation. Never
   apply without it.
9. **Apply** — after confirmation the integrator calls
   `generate_ad_integration(..., mode: "apply", confirm: true,
   expectedPlanHash: <planHash from step 7>)`.
10. **Validate config** — invoke the `ad-config-validator` skill
    (`validate_ad_config(projectPath, platformId, profile: "development",
    markets, childDirected)`); report `data.findings[]` warnings and fails.
11. **Verify** — invoke the `ad-integration-tester` skill
    (`verify_ad_integration(projectPath, levels: ["static","build","runtime"],
    targets)`). Report each level's `status` separately; `skipped` is NOT a
    pass.
12. **Report** — invoke the `ad-integration-tester` skill's reporting step via
    `build_integration_report(projectPath)`, then ask the user whether to write
    it to `docs/ad-integration-report.md`.

## Decision logic

| Situation (from `analyze_project` / `get_integration_guide`) | Action |
| --- | --- |
| `framework` is `flutter`, platform `admob` | Full automated path (steps 6–11). |
| `framework` is `android` / `ios` / `unity`, or `get_integration_guide` returns `strategy: "delegate-official-skill"` | Do NOT generate integration code. Show `data.officialSkill.install` and `docsUrl`, offer to install/delegate to the official vendor skill. Still run steps 2–5 (selection, placement advice, compliance checklist) and, later, revenue analysis. |
| `supportLevel` is `guided` or `unsupported` | Say so plainly; provide `get_integration_guide` steps and `get_platform_docs` material, no code generation. |
| `existingAdSdks` is non-empty | Prefer keeping the existing SDK; confirm with the user before adding another. |
| `git.isRepo` is false or `dirtyFiles` covers planned files | Stop at step 7 and let `DIRTY_WORKTREE` handling apply (suggest committing first). |
| Non-interactive session | Use the documented defaults, run steps 1–7 and 10–12, skip the apply in step 9 unless pre-authorized, and flag the assumption in the report. |

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `UNSUPPORTED_FRAMEWORK` | Project framework not recognized or not supported | Report to user; ask whether they meant a different project; do not guess. |
| `UNSUPPORTED_COMBINATION` | Platform × framework has no automation | Fall back to guidance mode (table above); link official docs. |
| `DIRTY_WORKTREE` | Planned files have uncommitted changes | Suggest committing first; only pass `allowDirty` if the user explicitly agrees. |
| `CONFIRMATION_REQUIRED` | Apply attempted without `confirm` / hash | Re-present the plan and get explicit user consent. |
| `PLAN_MISMATCH` | Plan changed since user confirmed | Re-run `mode: "plan"`, re-present the new diff, get fresh confirmation. |
| `TOOLCHAIN_MISSING` | flutter/xcodebuild not installed | Continue with static checks; report build as **not verified**. |
| `KNOWLEDGE_MISSING` | Knowledge base entry absent | Say the data is unavailable; point to official docs; never substitute memory. |
| `INTERNAL` | Unexpected server error | Report the message; suggest re-running the step once; then stop. |

## Output

A final summary in the user's language containing: chosen platform and why
(noting scores are editorial); placement plan; compliance requirements and
which ones the user must do manually (AdMob console, UMP messages,
app-ads.txt, store privacy declarations); what was written to the project
(files + diff summary); three-level verification results (static / build /
runtime, each stated separately); and all defaults assumed. If any
`sources[].stale` was true, warn the user that knowledge may be outdated.

## References

- `references/information-checklist.md` — what to collect up front, inference
  rules, non-interactive defaults.
- MCP resources: `ad-monetization://capabilities` (platform × framework
  support matrix).

## Core rules

- Never write or paste SDK integration code yourself; code comes only from
  `generate_ad_integration` (or an official vendor skill via delegation).
- The plan→confirm→apply checkpoint is mandatory; apply requires
  `confirm: true` and the `planHash` the user saw.
- Compliance requirements are determined **before** integration, and manual
  compliance steps (UMP messages, store declarations) are always listed in the
  final report.
- Report `skipped` verification as "not verified", never as passed.
- State assumed defaults explicitly in the final report.
