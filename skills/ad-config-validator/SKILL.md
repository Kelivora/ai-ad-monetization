---
name: ad-config-validator
description: >-
  Validates an ad SDK configuration (AdMob x Flutter) against a rule set in
  two modes: development (test IDs pass) and release (test IDs fail). Produces
  a pass/warning/fail Markdown report per check. Use when the user asks to
  check ad config, audit before release, "为什么广告不显示", or in Chinese 检查广告配置 /
  上线前检查 / 广告配置审计 / 发布前审查.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad Config Validator

Reply to the user in the user's language.

## When to use

- The user wants a config audit (any time after integration).
- Pre-release review: run with `profile: "release"`.
- Invoked by the `ad-monetization` orchestrator as its step 10.

## Prerequisites

- The MCP server **ad-monetization** must be available (`validate_ad_config`).
  If missing, tell the user how to install it (repository root:
  `npm install && npm run build`, then restart the agent) and stop. Do not
  eyeball configs from memory — the rule engine owns the checks.

## Workflow

1. **Pick the profile** — ask or infer:
   - `development`: actively integrating/testing (test IDs are expected).
   - `release`: preparing a store build (test IDs are a **fail**).
   If the user says "上线 / 发布 / release build", use `release`.
2. **Run** — `validate_ad_config(projectPath, platformId, profile, markets,
   childDirected)` (pass `markets`/`childDirected` when known — they enable
   compliance rules such as `CHILD_DIRECTED_TAG`).
3. **Read the result** — `data.findings[]`: each has `ruleId`, `status`
   (`pass|warning|fail|na`), `message`, optional `file`, `fix`, `source`.
   Also read the summary counts.
4. **Report** — render the Google-validate-style Markdown table (below),
   **only including rules that were actually checked** (skip `na` unless
   notable). For each non-pass item, include its `fix`.
5. **Fix loop** — for `fail` items the user wants fixed: apply the `fix`
   via the appropriate tool (re-running `generate_ad_integration` in plan
   mode if config needs patching) — never hand-edit what a tool owns. Then
   re-validate.

### Output table format

```markdown
| Check | Status | Findings | Next Steps |
| :--- | :---: | :--- | :--- |
| <rule title> | PASS / WARNING / FAIL / N/A | <message, file> | <fix or —> |
```

## Decision logic

| Rule status | Meaning | Your action |
| --- | --- | --- |
| `pass` | Rule satisfied | Report as PASS. |
| `warning` | Satisfied but risky / informational | Report; explain consequence; suggest fix. |
| `fail` | Violation | Must fix before proceeding (in `release` profile: blocks launch). |
| `na` | Not applicable (e.g. iOS rules on Android-only project) | Omit from table or mark N/A. |

Profile semantics: the same finding differs by profile — test App ID / test
ad-unit IDs (`TEST_APP_ID`, `TEST_AD_UNIT`) are `pass` (+提示) under
`development` and `fail` under `release`. Always state which profile was used.
Full rule list and meanings: `references/rules.md`.

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `PROJECT_NOT_FOUND` | Path invalid / no project | Ask for the correct project path. |
| `UNSUPPORTED_FRAMEWORK` | Project not supported by the rule set | Report; suggest `ad-sdk-integrator` guidance path. |
| `INVALID_INPUT` | Bad platformId/profile | Correct from `hint`; re-run. |
| `KNOWLEDGE_MISSING` | Rule data missing | Report which rules could not run; suggest official docs. |

## Output

- The Markdown table (only checked rules), summary counts (X pass /
  Y warning / Z fail), the profile used, and next steps for each non-pass
  finding — all in the user's language.
- Note any `sources[].stale` knowledge warnings.

## References

- `references/rules.md` — the full rule ID catalog with meanings and which
  profile each applies to.

## Core rules

- Always name the profile used; never mix dev expectations into a release
  audit.
- Test IDs in a release audit are a hard fail — never soften it.
- Fixes go through tools (`generate_ad_integration` plan mode), not manual
  edits of tool-owned files.
- Only report rules that actually ran.
