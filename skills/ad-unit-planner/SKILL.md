---
name: ad-unit-planner
description: >-
  Plans ad placements for a mobile app: which ad formats to use, where banners
  go (inline vs anchored adaptive), where interstitials are allowed, how to
  place rewarded ads, and frequency caps. Use when the user asks "where should
  I put ads", "plan ad units/placements", "广告位规划 / 广告放在哪里 / 插屏放哪里",
  or as part of the ad-monetization workflow before SDK integration.
metadata:
  version: "0.1.0"
  category: AdMonetization
---

# Ad Unit Planner

Reply to the user in the user's language.

## When to use

- The user wants a placement plan (formats × locations × triggers) before or
  during integration.
- Invoked by the `ad-monetization` orchestrator as its step 4.

## Prerequisites

- The MCP server **ad-monetization** must be available (`plan_ad_placements`,
  `analyze_project`, `get_platform_docs`). If missing, tell the user how to
  install it (repository root: `npm install && npm run build`, then restart
  the agent) and stop. Do not invent placements from memory.

## Workflow

1. **Get screens** — call `analyze_project(projectPath)` and read
   `data.screens` (`{file, widget, scrollable}` — heuristic detection). If
   empty, ask the user to name the 2–4 main screens and whether each scrolls.
2. **Plan** — call `plan_ad_placements` with `appCategory`, `goal`
   (`revenue|ux|balanced`), `formats` (if already decided), and
   `screens: data.screens`. Read the returned placement list: each entry has
   format, screen, position, trigger, frequency cap, banner type
   (anchored/inline) and a reason.
3. **Enforce the hard placement rules** (Decision logic) against the returned
   plan — the tool applies the same knowledge base, but you are the final
   gate. If a proposed placement violates a rule (e.g. interstitial at app
   start), remove or move it and explain why.
4. **Check policy docs when unsure** — call
   `get_platform_docs(platformId, topic: "banner" | "interstitial" |
   "rewarded")` for format-specific official guidance; see
   `references/placement-guidelines.md` for links.
5. **Present the plan** — a Markdown table (Screen | Format | Trigger |
   Frequency | Why) plus a note on which components the SDK integration will
   generate (see Output).

## Decision logic

| Rule | Decision |
| --- | --- |
| Screen/container is scrollable | Inline adaptive banner (flows with content). |
| Screen is not scrollable | Large **anchored** adaptive banner (top or bottom). |
| Interstitial | Only at **natural breaks/transition points** (level end, tab switch after task completion), with a frequency cap (default ≥ 3–5 min interval and never twice in a row). |
| Rewarded | Must be **user-initiated** (explicit opt-in button/entry) with the reward stated in advance; never forced. |
| Never place interstitials | At app start/launch, at app exit, during text input, mid-action, or as a "punishment" for a misclick. |
| Never allow ads | Overlapping or obscuring content, placed where accidental clicks are likely (next to buttons), or interactive elements inside the ad area that invite clicks. |
| Child-directed app | Interstitials restricted; no personalized ad signals — coordinate with `ad-compliance-checker`. |

## Error handling

| `error.code` | Meaning | Action |
| --- | --- | --- |
| `INVALID_INPUT` | Bad `goal`/`formats` value | Correct per the error `hint`; re-run. |
| `KNOWLEDGE_MISSING` | Placement knowledge missing for the platform | Fall back to `references/placement-guidelines.md` + official policy links; tell the user. |
| `INTERNAL` | Unexpected error | Report; retry once; stop. |

## Output

- The placement table in the user's language.
- Explicit statement that the MVP integration generates **reusable components**
  (`AnchoredBannerAd`, `InterstitialAdController`, `RewardedAdController`
  under `lib/ads/`), and that **inserting these components into the user's own
  pages means modifying business UI**: ask for the user's consent first, and
  when given, make only the minimal insertion at the agreed spots (one widget
  or one call per placement — never restructure their layout).
- Policy-risk warnings for anything the user requested that bends the rules
  above.

## References

- `references/placement-guidelines.md` — detailed rules with AdMob policy
  links (placement policy, interstitial guidance).

## Core rules

- Interstitials only at natural break points, always frequency-capped.
- Rewarded ads are always opt-in with a clear reward.
- No ads at launch/exit, during input, covering content, or click-bait
  placement.
- Touching the user's own page code requires their explicit consent and stays
  minimal.
