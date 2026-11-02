# AI Ad Monetization

[English](README.md) · [中文](README.zh-CN.md)

应用已经写好。现在让它赚钱。

写代码的 Agent 擅长把产品做出来，一到广告就容易出错。它们会选错平台，跳过隐私同意，把 Google 的测试 ID 打进正式包，还会把编译通过当成广告已经能播。把这个仓库交给你的 Agent。它会选定平台，把 AdMob 写进 Flutter。某项检查如果没有真正跑过，就不会被标成通过。

[![License: MIT](https://img.shields.io/badge/license-MIT-111111)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-111111)](package.json)
[![google_mobile_ads 9.2.0](https://img.shields.io/badge/google__mobile__ads-9.2.0-111111)](knowledge/platforms/admob/sdk/flutter.json)

`docs/` 里的指南是中文。英文说明在 [README.md](README.md)。中英文产品页在 [kelivora.github.io/ai-ad-monetization](https://kelivora.github.io/ai-ad-monetization/)。

## 里面有什么

三部分可以一起用，也可以拆开用。

| 部分 | 位置 | 作用 |
| --- | --- | --- |
| MCP 服务器 | `packages/mcp-server` | 14 个工具。12 个只读，1 个执行构建和测试命令，1 个写入工程。写入之前必须先确认计划。 |
| Skills | `skills/` | 8 个工作流。每个工作流写明调用哪个工具、怎么取舍，以及某一步失败后怎么办。 |
| 知识库 | `knowledge/` | AdMob、AppLovin MAX、Unity LevelPlay。每条记录都标明来源、版本和核对日期。 |

## 已在设备上跑通

下面三张图来自一次验收。工程是新建的 Flutter 3.47 应用，广告位用的是 Google 官方测试 ID。不是效果图。

| iOS 横幅 | iOS 激励视频，奖励已发放 | Android 横幅 |
| --- | --- | --- |
| ![iOS 测试横幅](docs/assets/ios-banner.png) | ![iOS 激励测试广告](docs/assets/ios-rewarded.png) | ![Android 测试横幅](docs/assets/android-banner.png) |

同一次运行里，`flutter analyze` 没有报错。Android debug APK 和 iOS 模拟器都构建成功。在设备上试播测试广告时，iOS 的 6 项全部通过。Android 的 6 项，要等模拟器能够访问 Google 广告服务器之后才会全部通过。从中国大陆网络访问时，Android 激励视频的素材下载失败，这一项记为失败。版本、命令和完整记录见[验收报告](docs/mvp-acceptance-report.md)。

## 范围

| 组合 | 等级 | 服务器的行为 |
| --- | --- | --- |
| AdMob × Flutter，Android 与 iOS | 自动接入 | 横幅、插屏、激励视频。包含 UMP 同意流程和 SKAdNetwork，默认使用测试 ID。 |
| AdMob × 原生 Android、iOS 或 Unity | 交给官方 Skill | 使用 Google 官方 Skill：`npx skills add google/skills/skills/ads` |
| Unity LevelPlay × Unity | 交给官方 Skill | 使用 Unity 官方 Skill：`npx skills add Unity-Technologies/skills` |
| AppLovin MAX、LevelPlay × Flutter，以及其他 | 仅知识库 | 可以比较，也可以查文档。不会写入工程。 |

## 快速开始

需要 Node.js 20 或更新版本。

```bash
npm install
npm run build
node packages/mcp-server/scripts/smoke-stdio.mjs
```

只给当前 Claude Code 会话加载插件，不改全局配置：

```bash
claude --plugin-dir /path/to/ai-ad-monetization
```

先让它给出计划，你确认之后再写入：

> 给这个 Flutter 应用加横幅、插屏和激励视频。写入之前先给我看计划。

`bash scripts/e2e-build.sh ios` 会把 `examples/flutter_demo_app` 复制到临时目录，再把整条流程跑一遍。示例工程本身不会被改动。Android 构建需要 JDK 17 和 Android SDK 36。缺其中任何一个，对应步骤会跳过，输出里会写明原因。

Cursor 和其他 MCP 客户端的安装方式见 [docs/install.md](docs/install.md)。

## 写入是怎么进行的

1. `analyze_project` 读取应用，包括框架、原生配置，以及已经存在的广告代码。
2. `recommend_ad_platform` 给出平台和理由。面向美国和欧洲的 Flutter 新闻应用，推荐的是 AdMob。
3. `generate_ad_integration` 在 `mode: "plan"` 下返回 diff 和计划哈希。这一步不改文件。
4. 再次调用时带上 `mode: "apply"`、`confirm: true` 和 `expectedPlanHash`，才会写入。如果计划生成之后工程又被改过，调用会返回 `PLAN_MISMATCH`，并且什么都不写。
5. `validate_ad_config` 做静态检查。`verify_ad_integration` 接着跑静态检查和构建。如果传入了设备 id，还会在设备上加载真实的测试广告。

不经过 Agent，用 CLI 也是同样的步骤：

```bash
node packages/mcp-server/dist/cli.js plan  <project> --formats banner,interstitial,rewarded
node packages/mcp-server/dist/cli.js apply <project> --formats banner,interstitial,rewarded --yes
node packages/mcp-server/dist/cli.js verify <project> --levels static,build,runtime --devices <id> --show-fullscreen
```

`verify` 的退出码：所请求的级别都没有失败时是 0；静态检查、构建或运行时有失败时是 1；所请求的级别全部被跳过时是 3。

## 工具

| 工具 | 权限 | 作用 |
| --- | --- | --- |
| `search_ad_platforms` | 只读 | 按关键词、框架、市场检索平台。 |
| `compare_ad_platforms` | 只读 | 比较格式、聚合、框架支持和市场适配。 |
| `recommend_ad_platform` | 只读 | 按应用类别、目标和市场给出推荐。 |
| `get_platform_docs` | 只读 | 返回知识库里的官方摘要和链接。 |
| `get_sdk_compatibility` | 只读 | SDK 版本要求，可以对照具体工程。 |
| `analyze_project` | 只读 | 框架、原生配置、已有广告代码、隐私组件。 |
| `get_integration_guide` | 只读 | 接入步骤，或者应该安装的官方 Skill。 |
| `plan_ad_placements` | 只读 | 广告位、频控和布局风险。 |
| `validate_ad_config` | 只读 | 按 `development` 或 `release` 两套标准做静态检查。 |
| `build_integration_report` | 只读 | 生成 Markdown 接入报告。 |
| `get_ad_revenue` | 只读 | 从导出文件读取收益，或用你自己提供的令牌调用 AdMob API。 |
| `analyze_ad_performance` | 只读 | eCPM、填充率、展示率、点击率，以及据此给出的说明。 |
| `verify_ad_integration` | 执行命令 | 静态、构建、运行时。不改源码。 |
| `generate_ad_integration` | **写入** | 先给出计划，确认后再写。写入前会备份，重复执行不会把同一段代码再插一次。 |

## Skills

| Skill | 负责 |
| --- | --- |
| `ad-monetization` | 按顺序走完一次接入。 |
| `ad-platform-selector` | 选择广告平台。 |
| `ad-unit-planner` | 决定广告放在哪里、多久出现一次。 |
| `ad-compliance-checker` | 检查 UMP、美国各州隐私要求、ATT，以及儿童向处理。 |
| `ad-sdk-integrator` | 把 SDK 写进工程。 |
| `ad-config-validator` | 做静态检查。 |
| `ad-integration-tester` | 构建应用，并在设备上试播。 |
| `ad-revenue-optimizer` | 读取收益，并给出不违反 AdMob 政策的调整。 |

## 服务器遵守的规则

- 不重写官方 Skill。如果某个组合已经有官方 Skill，服务器会返回 `delegate-official-skill` 和安装命令。
- Skill 只写出要调用的工具名，不引用服务器的实现。没有 MCP 时，Skill 里仍然有一套可以照着做的步骤。
- `PlatformAdapter` 只描述一个广告平台能做什么。每个适配器检查自己的参数。
- 计划按工程当时的内容生成。如果计划要改的文件还有未提交的改动，默认拒绝写入，除非传入 `allowDirty`。
- 生成的代码使用 Google 测试 ID。正式 ID 通过 `--dart-define` 传入。在 `release` 标准下，测试 ID 还在，检查就会失败。
- 新代码放在 `lib/ads/`。`main.dart` 的改动夹在 `ai-ad-monetization:begin` 和 `ai-ad-monetization:end` 之间。已经存在的配置不会被覆盖。写入前，原文件会复制到 `.ai-ad-monetization/backups/`。
- 初始化时先走 UMP 同意流程。只有 `canRequestAds()` 为 true，才会调用 `MobileAds.instance.initialize()`。
- 静态检查、构建和运行时测试是三项分开的结果。缺少 JDK 或 Android SDK 时，Android 构建记为跳过，报告里会写明它没有被验证。
- AdMob 应用、广告位、隐私消息和 API 令牌需要你自己创建。工具只说明步骤，然后停下来。

## 目录

```
packages/mcp-server/   服务器、CLI、适配器、测试
skills/                8 个 Agent Skill
knowledge/             平台、SDK、隐私、错误码
examples/              未改动的 Flutter 示例工程，以及示例提示词
scripts/               插件启动、知识库检查、端到端脚本
docs/                  调研、架构、安装、使用、排错
site/                  双语产品页和使用说明页
```

## 文档

| | |
| --- | --- |
| [安装](docs/install.md) | 插件、单独的 MCP 配置、环境变量。 |
| [使用](docs/usage.md) | 工具调用、生成的 Dart API、CLI。 |
| [示例提示词](examples/prompts.md) | 可以直接贴给 Agent 的句子。 |
| [故障排查](docs/troubleshooting.md) | 错误码、构建失败、中国大陆网络下的激励视频。 |
| [架构](docs/architecture.md) | 这套服务器遵循的设计。 |
| [竞品笔记](docs/research/competitive-analysis.md) | 官方 Skill，以及本仓库不重复实现的部分。 |
| [路线图](docs/roadmap.md) | 接入 MAX、LevelPlay 和聚合适配器需要多少工作。 |
| [验收报告](docs/mvp-acceptance-report.md) | 上文提到的那次验收。 |

## 许可证

[MIT](LICENSE)
