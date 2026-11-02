---
name: ad-compliance-checker
description: >-
  Determines privacy and advertising compliance requirements for a mobile app
  by target market (GDPR for EEA/UK/CH, US state privacy laws, COPPA for
  child-directed apps, Apple ATT on iOS) and checks the project against them
  via UMP/consent-aware validation. Use when the user asks about ad privacy,
  consent, GDPR, CCPA, ATT, COPPA, children's ads policy, or in Chinese
  合规 / 隐私 / 同意弹窗 / 儿童应用广告 / 广告合规要求. Technical guidance only —
  not legal advice.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad Compliance Checker

Reply to the user in the user's language.

**Disclaimer (always include in output): this skill provides technical
integration guidance, not legal advice. Which laws apply depends on the app's
users and data practices; consult legal counsel for determination.**

## When to use

- The user asks about privacy/consent requirements for ads in specific
  markets, or the app is child-directed.
- Invoked by the `ad-monetization` orchestrator as its step 5 — **before**
  SDK integration, so requirements shape the integration (e.g. UMP is always
  wired in).

## Prerequisites

- The MCP server **ad-monetization** must be available (`get_platform_docs`,
  `validate_ad_config`). If missing, tell the user how to install it
  (repository root: `npm install && npm run build`, then restart the agent)
  and stop. Do not answer compliance questions from memory.
- Inputs: target markets and whether the app is child-directed. If unknown,
  ask once; if non-interactive, assume `markets: ["US"]`,
  `childDirected: false` and state the assumption.

## Workflow

1. **Fetch official privacy knowledge** — call
   `get_platform_docs(platformId, topic: "privacy")`. Read the entry body,
   `sources[]` (report any `stale: true` to the user) and use it — not
   memory — as the basis for requirements.
2. **Map markets → requirements** using the Decision logic table below (detail
   in `references/privacy-by-market.md`).
3. **Validate the project (if integration exists)** — call
   `validate_ad_config(projectPath, platformId, profile: "development",
   markets, childDirected)`. Read `data.findings[]`: focus on
   `CONSENT_FLOW`, `CAN_REQUEST_ADS_GATE`, `PRIVACY_OPTIONS_ENTRY`,
   `CHILD_DIRECTED_TAG`, `IOS_SKADNETWORK`, plus any `fail`/`warning`.
4. **Produce the compliance checklist** — what the tool/agent handles vs what
   only the user can do (UMP messages in AdMob console, store declarations).

## Decision logic

| Target market / property | Requirement | Who implements |
| --- | --- | --- |
| EEA / UK / CH users | GDPR: UMP consent flow **required**. User must create & publish a GDPR message in AdMob console (Privacy & messaging). App must expose a privacy-options entry (the generated `ads_consent.dart` provides `showPrivacyOptionsForm`). | Console: user. Code: generated; validation confirms. |
| US users | State privacy laws (e.g. CCPA/CPRA and successors): recommend configuring the UMP US states regulation message. | Console: user (recommended). |
| Child-directed app (any market) | `tagForChildDirectedTreatment` set (rule `CHILD_DIRECTED_TAG`); Google Play **Families policy** applies — format & data limits; remind the user to review Families requirements before shipping. | Code/config: validated. Policy: user. |
| iOS target | ATT is **optional**, but if the app accesses IDFA it must show ATT prompt with `NSUserTrackingUsageDescription` in Info.plist; SKAdNetwork IDs should be present. | Code/config: validated/patched. Prompt copy: user. |
| All markets | Store privacy declarations: Google Play **Data safety**, App Store **App Privacy** — filled by the account owner. | User only. |

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `INVALID_INPUT` | Unknown market code / bad params | Correct from `hint`; re-run. |
| `PROJECT_NOT_FOUND` | Path is not a project | Ask for the correct path; compliance mapping alone can still be delivered. |
| `UNSUPPORTED_FRAMEWORK` | Project framework unsupported for validation | Deliver the market checklist (steps 1–2, 4); note validation unavailable. |
| `KNOWLEDGE_MISSING` | Privacy topic missing from knowledge base | Warn; link official docs (references); do not improvise requirements. |

## Output

- The disclaimer (top of output).
- A per-market requirements table in the user's language.
- A split checklist: automated/validated items vs **user-owned** items (publish
  UMP GDPR & US messages, app-ads.txt, Play Data safety, App Store App
  Privacy, Families program review if child-directed).
- Validation findings summary (if step 3 ran), and any `stale` source
  warnings.

## References

- `references/privacy-by-market.md` — per-market detail: GDPR/UMP, US state
  laws, COPPA/Families, ATT, store declarations, official links.

## Core rules

- Always include the "technical guidance, not legal advice" disclaimer.
- EEA/UK/CH → UMP is mandatory and the GDPR message must be **published by
  the user** in the AdMob console — never claim it is done until the user
  confirms.
- Child-directed → say so changes formats/personalization and triggers
  Families policy review.
- Base requirements on `get_platform_docs` output, not memory; report stale
  sources.
