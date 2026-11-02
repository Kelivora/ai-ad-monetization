---
name: ad-sdk-integrator
description: >-
  Integrates an ad SDK into a Flutter project via the ad-monetization MCP
  server: checks compatibility, shows a plan with full diffs, and applies only
  after explicit user confirmation (plan hash protected). Use when the user
  says "integrate AdMob", "add the ads SDK", "wire up banner/interstitial/
  rewarded", or in Chinese 接入广告 SDK / 集成 AdMob / 帮我接入广告代码. MVP automates
  AdMob x Flutter; other frameworks are delegated or guided, never hand-written.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad SDK Integrator

Reply to the user in the user's language. This skill has **hard gates** —
never skip them.

## When to use

- The user wants the ad SDK actually added to their project (dependencies,
  config, generated ad code).
- Invoked by the `ad-monetization` orchestrator as its steps 6–9.

## Prerequisites

- The MCP server **ad-monetization** must be available (`analyze_project`,
  `get_sdk_compatibility`, `get_integration_guide`,
  `generate_ad_integration`, `verify_ad_integration`). If missing, tell the
  user how to install it (repository root: `npm install && npm run build`,
  then restart the agent) and **stop — do not write SDK code from memory**.
- Gates (all must pass before any code generation):
  1. `analyze_project` must have been run in this conversation on the target
     project (fresh results only).
  2. `data.framework` must be `flutter` AND `get_integration_guide` must
     return `strategy: "automated"`. Otherwise: do not write integration code
     — delegate to the official skill (`data.officialSkill.install`) or
     explain the support level honestly (see `ad-platform-selector`).
  3. `get_sdk_compatibility` must show **no `incompatible` items** for the
     project (Dart constraint, minSdk, iOS deployment target…). If any, stop
     and help the user resolve them first (upgrade Flutter, bump minSdk,
     raise deployment target) — with consent, since those are their files.
  4. If `data.existingAdSdks` contains `google_mobile_ads` or any other ad
     SDK: inform the user and get explicit confirmation before continuing.
     The tool will `skip` already-present config and never overwrite a real
     App ID — verify that in the plan.

## Workflow

1. **Re-analyze** — `analyze_project(projectPath)`; confirm gates above. Note
   `data.git.dirtyFiles`.
2. **Guide** — `get_integration_guide(platformId, framework, formats)`; read
   `data.strategy`. If not `automated`, stop per gate 2.
3. **Compatibility** — `get_sdk_compatibility(platformId, framework,
   projectPath)`; read the per-item comparison; act per gate 3.
4. **Plan** — `generate_ad_integration(projectPath, platformId, formats,
   mode: "plan")`. Read `data.plan.changes[]` (each with `path`, `action`
   create/modify/skip, `reason`, `diff`), `data.plan.manualSteps`, and
   `data.plan.planHash`. `usesTestIds` will be `true` — generated code uses
   Google test IDs only.
5. **Present and WAIT** — show every file change with its diff and reasons,
   plus manual steps, in the user's language. This is a mandatory checkpoint:
   apply nothing until the user explicitly confirms.
6. **Apply** — `generate_ad_integration(projectPath, platformId, formats,
   mode: "apply", confirm: true, expectedPlanHash: <the planHash shown>)`.
   Read the write results and backup path (files are backed up under
   `.ai-ad-monetization/backups/<timestamp>/`).
7. **Post-apply** — tell the user what was written (see
   `references/flutter-admob-integration.md` for what each generated file
   does and how to inject production IDs later with
   `--dart-define=ADMOB_ANDROID_BANNER_ID=...`), then recommend running the
   `ad-integration-tester` skill (`verify_ad_integration`). Also surface
   `references/manual-steps.md` items the user must do in the AdMob console.

## Decision logic

| Situation | Action |
| --- | --- |
| `strategy` is `delegate-official-skill` | Show `data.officialSkill.install`; no code generation here. |
| Compatibility shows `incompatible` | Stop generation; propose the concrete fix (from `hint`/diff) and ask for consent to modify the user's project files (e.g. `minSdk`, deployment target, Dart constraint). |
| Existing ad SDK present | Ask: continue alongside / migrate / abort. Default recommendation: keep existing. |
| Planned files dirty in git (`DIRTY_WORKTREE`) | Suggest committing first; pass `allowDirty: true` only on explicit user instruction. |
| User wants real ad IDs now | Only if the user provides them voluntarily; inject ad-unit IDs via `--dart-define` variables, never hardcode. Real **App ID** must go in AndroidManifest/Info.plist (no dart-define support) — see references. |
| `main.dart` has no recognizable `runApp(` | The tool moves that wiring into `manualSteps` — present it as a manual step; do not guess an insertion point. |

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `UNSUPPORTED_FRAMEWORK` | Not a flutter project (or undetected) | Do not generate; guide or delegate. |
| `UNSUPPORTED_COMBINATION` | Platform × framework not automated | Delegate/guide per `get_integration_guide`. |
| `DIRTY_WORKTREE` | Planned files have uncommitted changes | Suggest `git commit` first; `allowDirty` only with explicit user consent. |
| `CONFIRMATION_REQUIRED` | Apply without `confirm: true` | Re-present plan; get consent; re-apply. |
| `PLAN_MISMATCH` | Recomputed plan differs from `expectedPlanHash` | Re-run `mode: "plan"`, show the new diff, get fresh confirmation. Never force-apply. |
| `TOOLCHAIN_MISSING` | Tool versions cannot be verified | Resolve per gate 3 before planning. |
| `COMMAND_FAILED` | A step during apply failed | Report which file/step; the tool leaves backups — point the user to `.ai-ad-monetization/backups/`. |
| `KNOWLEDGE_MISSING` | SDK knowledge missing | Stop; never substitute remembered versions/IDs. |

## Output

- The full plan (files + diffs + reasons + manual steps) before apply; the
  write summary after apply, in the user's language.
- Explicit note that test IDs are in use and how/when to switch to production
  IDs (dart-define names, App ID location).
- The list of manual console steps the user still owns.

## References

- `references/flutter-admob-integration.md` — every generated file, the
  `// ai-ad-monetization:begin/end` markers, dart-define ID injection rules.
- `references/manual-steps.md` — AdMob console work (create app & ad units,
  UMP messages, app-ads.txt, test devices) that only the user can do.

## Core rules

- Never write SDK integration code yourself — it comes from
  `generate_ad_integration` or an official skill. Never hand-edit files the
  tool is about to modify to "help" it.
- Plan → user confirms → apply with `confirm: true` and the seen
  `planHash`. No exceptions, no silent re-plans.
- Never replace test IDs with real ones unless the user provided them; real
  ad-unit IDs go in via `--dart-define`, the real App ID via
  AndroidManifest/Info.plist.
- Existing config is `skip`ped, never overwritten; backups are written on
  every apply.
