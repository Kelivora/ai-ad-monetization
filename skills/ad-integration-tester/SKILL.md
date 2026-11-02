---
name: ad-integration-tester
description: >-
  Verifies an ad integration at three independent levels — static rule
  checks, real builds (flutter analyze / build apk / build ios), and a manual
  runtime checklist (test ads on emulator, UMP form, rewarded callbacks) —
  then builds the final integration report. Use when the user says "test the
  ads", "verify the integration", "build fails after adding ads", or in
  Chinese 验证广告接入 / 测试广告 / 构建失败 / 广告不显示怎么办. Never reports a skipped
  level as passed.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad Integration Tester

Reply to the user in the user's language.

## When to use

- After `generate_ad_integration` apply (or any manual integration change).
- Build failures or "ads don't show" triage.
- Invoked by the `ad-monetization` orchestrator as its steps 11–12.

## Prerequisites

- The MCP server **ad-monetization** must be available
  (`verify_ad_integration`, `build_integration_report`). If missing, tell the
  user how to install it (repository root: `npm install && npm run build`,
  then restart the agent) and stop. Do not fake verification results.
- A successful build proves compilation only — **a green build does not mean
  ads can serve**. Runtime needs the manual checklist.

## Workflow

1. **Run verification** — `verify_ad_integration(projectPath, levels:
   ["static","build","runtime"], targets: ["android","ios"])` (trim targets
   to the project's actual targets from `analyze_project`). Read each level's
   `status` (`passed|failed|skipped|requires_manual_verification`) and its
   step details (command, exit code, duration, log tail).
2. **Report the three levels separately** — never merge them into one
   verdict:
   - **static**: which validation rules passed/failed.
   - **build**: per-target compile results. If `skipped` (e.g.
     `TOOLCHAIN_MISSING`), report it as **NOT verified** — never as passed —
     and name the missing tool.
   - **runtime**: always `requires_manual_verification`; hand the user the
     checklist (step 4).
3. **Triage build failures** — read the returned log tail and match against
   `references/troubleshooting.md` (minSdk, iOS deployment target,
   CocoaPods/SPM, missing App ID crash, Dart SDK constraint, NO_FILL).
   Propose the fix; apply changes only via tools/user consent.
4. **Runtime checklist (manual)** — give the user this list (details in
   `references/runtime-checklist.md`):
   - [ ] Ads on emulator/device show the **"Test Ad"** badge.
   - [ ] Logs show SDK initialization completed.
   - [ ] With EEA debug geography (`ConsentDebugSettings(debugGeography: EEA)`
     on a registered test device), the UMP consent form appears and the
     privacy-options entry reopens it.
   - [ ] Rewarded ad: reward callback fires on completion.
   - [ ] Airplane mode: ad fails gracefully, no crash, app stays usable.
5. **Final report** — `build_integration_report(projectPath)`; read the
   Markdown report. Ask the user: "是否写入 `docs/ad-integration-report.md`？"
   Write the file only on consent (or offer to paste it).

## Decision logic

| Result | Verdict wording |
| --- | --- |
| static `passed`, build `passed` | "配置与构建验证通过；运行时行为仍需人工核对（见清单）". |
| build `skipped` (TOOLCHAIN_MISSING) | "**构建未验证**（缺少工具链：flutter/xcodebuild）" — never "通过/基本通过". |
| build `failed` | "构建失败" + failing step + log tail + troubleshooting match. |
| runtime | Always "requires manual verification" until the user confirms checklist items; then record their confirmations as user-reported, not tool-verified. |
| static `failed` | Fix via `ad-config-validator` fix loop first; build after. |

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `PROJECT_NOT_FOUND` | Bad path | Ask for the correct project path. |
| `TOOLCHAIN_MISSING` | flutter/xcodebuild/java missing | Report level as not verified; list what to install; continue other levels. |
| `COMMAND_FAILED` | A build/analyze command failed | Show command + log tail; route to troubleshooting reference. |
| `UNSUPPORTED_FRAMEWORK` | Framework has no build verification | Static checks + runtime checklist only; say build not verified. |
| `INTERNAL` | Unexpected | Report; retry once. |

## Output

- Three separate verdicts (static / build / runtime) with per-step details,
  in the user's language.
- The manual runtime checklist when applicable.
- The final report (after `build_integration_report`), written to
  `docs/ad-integration-report.md` only if the user agrees.

## References

- `references/runtime-checklist.md` — the full manual runtime verification
  list with how-to details.
- `references/troubleshooting.md` — common build/run failures and fixes.

## Core rules

- Report each level separately; `skipped` means **not verified**, never
  passed.
- Compile success ≠ ads can serve — runtime confirmation is always manual.
- Diagnose from returned log tails and the troubleshooting reference, not
  guesswork.
- Write the report file only with user consent.
