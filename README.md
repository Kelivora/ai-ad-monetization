# AI Ad Monetization

[English](README.md) · [中文](README.zh-CN.md)

Your agent built the app. Now make it pay.

Coding agents are good at product. They are reckless with ads. They pick the wrong network, skip consent, ship Google’s test IDs, and call a green build a working ad. Point your agent at this repository. It chooses the network, writes AdMob into Flutter, and will not call a skipped check a pass.

[![License: MIT](https://img.shields.io/badge/license-MIT-111111)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-111111)](package.json)
[![google_mobile_ads 9.2.0](https://img.shields.io/badge/google__mobile__ads-9.2.0-111111)](knowledge/platforms/admob/sdk/flutter.json)

The guides under `docs/` are in Chinese. This file is the English entry point. A bilingual product page lives in [`site/`](site/index.html).

## What's in the box

Three pieces, used together or apart:

| Piece | Where | Role |
| --- | --- | --- |
| MCP server | `packages/mcp-server` | 14 tools. Twelve only read. One runs build and test commands. One writes the project, and only after a confirmed plan. |
| Skills | `skills/` | Eight workflows. They say which tool to call, what to decide, and what to do when a step fails. |
| Knowledge base | `knowledge/` | AdMob, AppLovin MAX, and Unity LevelPlay, each note tagged with its source, version, and the date it was checked. |

## What shipped, on a device

Generated against a fresh Flutter 3.47 app, using Google's test ad units. These are captures from the acceptance run, not mockups.

| iOS banner | iOS rewarded, reward granted | Android banner |
| --- | --- | --- |
| ![iOS test banner](docs/assets/ios-banner.png) | ![iOS rewarded test ad](docs/assets/ios-rewarded.png) | ![Android test banner](docs/assets/android-banner.png) |

On that run, `flutter analyze` reported no issues, and both the Android debug APK and the iOS simulator build succeeded. The device smoke test passed 6 of 6 on iOS and, on Android, 6 of 6 once the emulator could reach Google's ad servers. From a mainland China network the Android rewarded creative failed to download. That failure is recorded as a failure. Details, versions, and the commands are in the [acceptance report](docs/mvp-acceptance-report.md).

## Scope

| Combination | Level | What the server does |
| --- | --- | --- |
| AdMob × Flutter, Android and iOS | Automated | Banner, interstitial, and rewarded. UMP consent, SKAdNetwork, test IDs by default. |
| AdMob × native Android, iOS, or Unity | Delegated | Points at Google's skill: `npx skills add google/skills/skills/ads` |
| Unity LevelPlay × Unity | Delegated | Points at Unity's skill: `npx skills add Unity-Technologies/skills` |
| AppLovin MAX, LevelPlay × Flutter, and the rest | Knowledge only | Compared and documented. Nothing is written into the project. |

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npm run build
node packages/mcp-server/scripts/smoke-stdio.mjs
```

Load it for one Claude Code session, without changing your global config:

```bash
claude --plugin-dir /path/to/ai-ad-monetization
```

Then ask for the plan before any write:

> Add a banner, an interstitial, and a rewarded ad to this Flutter app. Show me the plan before you write anything.

`bash scripts/e2e-build.sh ios` repeats the whole path against a throwaway copy of `examples/flutter_demo_app`. The example app itself is not modified. Android builds need JDK 17 and Android SDK 36. If either is missing, that step is skipped and the script says so.

Install paths for Cursor and other MCP clients are in [docs/install.md](docs/install.md).

## How a write happens

1. `analyze_project` reads the app: framework, native config, ads code already present.
2. `recommend_ad_platform` names a platform and why. For a news app on Flutter aimed at the US and Europe, that is AdMob.
3. `generate_ad_integration` with `mode: "plan"` returns the diff and a plan hash. The tree is unchanged.
4. A second call with `mode: "apply"`, `confirm: true`, and `expectedPlanHash` writes the files. If the tree changed after the plan, the call returns `PLAN_MISMATCH` and writes nothing.
5. `validate_ad_config` checks the result. `verify_ad_integration` then runs static checks, builds, and, when you pass device ids, a smoke test that loads real test ads.

The CLI does the same thing without an agent:

```bash
node packages/mcp-server/dist/cli.js plan  <project> --formats banner,interstitial,rewarded
node packages/mcp-server/dist/cli.js apply <project> --formats banner,interstitial,rewarded --yes
node packages/mcp-server/dist/cli.js verify <project> --levels static,build,runtime --devices <id> --show-fullscreen
```

`verify` exits 0 when no requested level failed, 1 when static, build, or runtime failed, and 3 when every requested level was skipped.

## Tools

| Tool | Access | Does |
| --- | --- | --- |
| `search_ad_platforms` | Read | Search platforms by keyword, framework, and market. |
| `compare_ad_platforms` | Read | Compare formats, mediation, framework support, and market fit. |
| `recommend_ad_platform` | Read | Recommend a platform from the app category, goal, and markets. |
| `get_platform_docs` | Read | Official notes from the knowledge base, with links. |
| `get_sdk_compatibility` | Read | SDK requirements, optionally checked against a project. |
| `analyze_project` | Read | Framework, native config, existing ads code, privacy pieces. |
| `get_integration_guide` | Read | Integration steps, or the official skill to install instead. |
| `plan_ad_placements` | Read | Placements, frequency caps, and layout warnings. |
| `validate_ad_config` | Read | Static rules, in a `development` or `release` profile. |
| `build_integration_report` | Read | A Markdown report of the integration. |
| `get_ad_revenue` | Read | Revenue from an export file, or from the AdMob API with a token you supply. |
| `analyze_ad_performance` | Read | eCPM, match rate, show rate, CTR, and heuristic notes. |
| `verify_ad_integration` | Runs commands | Static, build, and runtime. Does not edit source. |
| `generate_ad_integration` | **Writes** | Plan, then confirm, then write. Backs up files first. Idempotent. |

## Skills

| Skill | Owns |
| --- | --- |
| `ad-monetization` | The whole pass, in order. |
| `ad-platform-selector` | Choosing a network. |
| `ad-unit-planner` | Where ads go, and how often. |
| `ad-compliance-checker` | UMP, US state privacy, ATT, and child-directed treatment. |
| `ad-sdk-integrator` | Writing the SDK in. |
| `ad-config-validator` | The static rules. |
| `ad-integration-tester` | Builds and the on-device smoke test. |
| `ad-revenue-optimizer` | Reading revenue and suggesting changes that stay inside AdMob policy. |

## Rules the server enforces

- Official skills are not reimplemented. A covered combination returns `delegate-official-skill` and the install command.
- Skills name tools. They do not import the server. Without the server they still have a written procedure.
- `PlatformAdapter` describes what a network can do. Each adapter validates its own options.
- A plan is computed from the project as it is. If a file the plan must touch has uncommitted changes, the write is refused until you pass `allowDirty`.
- Generated code uses Google's test IDs. Production IDs are injected with `--dart-define`. The `release` profile fails while test IDs remain.
- New code lands in `lib/ads/`. The `main.dart` edit sits between `ai-ad-monetization:begin/end` markers. Existing settings are skipped. Originals are copied to `.ai-ad-monetization/backups/` before a write.
- Initialization gathers UMP consent first. `MobileAds.instance.initialize()` runs only when `canRequestAds()` is true.
- Static, build, and runtime are three results. A missing JDK or Android SDK skips the Android build and the report says the Android build was not verified.
- Creating the AdMob app, the ad units, the privacy messages, and the API token is left to you. The tools describe the steps and stop there.

## Layout

```
packages/mcp-server/   server, CLI, adapters, tests
skills/                eight agent skills
knowledge/             platforms, SDKs, privacy, error codes
examples/              a pristine Flutter app, plus example prompts
scripts/               plugin launcher, knowledge check, end-to-end script
docs/                  research, architecture, install, usage, troubleshooting
site/                  bilingual product page and usage pages
```

## Documentation

| | |
| --- | --- |
| [Install](docs/install.md) | Plugin, bare MCP config, environment variables. |
| [Usage](docs/usage.md) | Tool calls, the generated Dart API, the CLI. |
| [Example prompts](examples/prompts.md) | Sentences you can paste to an agent. |
| [Troubleshooting](docs/troubleshooting.md) | Error codes, build failures, the China-network rewarded case. |
| [Architecture](docs/architecture.md) | The design contract. |
| [Competitive notes](docs/research/competitive-analysis.md) | Official skills and what this repo does not duplicate. |
| [Roadmap](docs/roadmap.md) | What MAX, LevelPlay, and mediation adapters would cost. |
| [Acceptance report](docs/mvp-acceptance-report.md) | The run this README cites. |

## License

[MIT](LICENSE)
