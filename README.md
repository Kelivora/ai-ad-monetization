# AI Ad Monetization

面向 AI 应用开发者的跨平台广告变现助手。它由三部分组成：

- **MCP 服务器**（`packages/mcp-server`）：14 个工具，覆盖平台选型、工程分析、接入、校验、构建验证和收益分析。
- **Agent Skills**（`skills/`）：8 个工作流 Skill，告诉 Agent 何时调用哪个工具、怎么做决策、出错怎么办。
- **知识库**（`knowledge/`）：AdMob、AppLovin MAX、Unity LevelPlay 的官方资料摘要。每条都记录来源、核实版本和日期。

## 当前范围（MVP）

| 平台 × 框架 | 支持等级 | 说明 |
| --- | --- | --- |
| AdMob × Flutter（Android + iOS） | **自动接入** | Banner、Interstitial、Rewarded；含 UMP 同意流程、SKAdNetwork、测试 ID |
| AdMob × 原生 Android / iOS / Unity | 委派官方 Skill | `npx skills add google/skills/skills/ads` |
| Unity LevelPlay × Unity | 委派官方 Skill | `npx skills add Unity-Technologies/skills` |
| AppLovin MAX、LevelPlay × Flutter 等 | 仅知识库 | 可参与选型与对比，提供文档引导，不自动写入 |

本项目刻意只把一条链路做扎实。在 Flutter 3.47 新建工程上完成接入后：

- `flutter analyze` 无问题，Android 与 iOS debug 构建都通过，静态校验 0 失败。
- 在 iOS 和 Android 模拟器上都自动加载了横幅、插屏和激励三种 Google 测试广告，并触发了奖励回调。
- 在中国大陆网络出口下，Android 激励视频的素材会被拦截而加载失败，换网络即可（见[故障排查](docs/troubleshooting.md)）。

详见 [MVP 验收报告](docs/mvp-acceptance-report.md)。当前状态适合小规模公开试用。

## 快速开始

```bash
npm install && npm run build
node packages/mcp-server/scripts/smoke-stdio.mjs     # 列出全部工具
bash scripts/e2e-build.sh ios                        # 在示例工程副本上跑完整链路
```

在 Claude Code 中只为当前会话加载插件（不修改全局配置）：

```bash
claude --plugin-dir /path/to/ai-ad-monetization
```

长期安装、Cursor 或其他 MCP 客户端的接入方法见 [安装指南](docs/install.md)。

## 工具

只读工具和修改工程的工具是分开的。唯一会写入用户工程的是 `generate_ad_integration`，它要求先生成计划、再带确认标志和计划哈希执行。

| 工具 | 类型 | 作用 |
| --- | --- | --- |
| `search_ad_platforms` | 只读 | 按关键词、框架、市场检索平台 |
| `compare_ad_platforms` | 只读 | 多平台对比（格式、聚合、框架支持、市场适配） |
| `recommend_ad_platform` | 只读 | 按应用类别、目标、市场给出推荐与理由 |
| `get_platform_docs` | 只读 | 返回知识库中的官方文档摘要与链接 |
| `get_sdk_compatibility` | 只读 | SDK 版本要求，可对照具体工程检查 |
| `analyze_project` | 只读 | 识别框架、原生配置、已有广告代码和隐私组件 |
| `get_integration_guide` | 只读 | 接入指南；非自动化组合给出官方 Skill 或文档步骤 |
| `plan_ad_placements` | 只读 | 广告位、频控与布局建议 |
| `validate_ad_config` | 只读 | 静态规则校验（development / release 两种口径） |
| `build_integration_report` | 只读 | 生成 Markdown 接入报告 |
| `get_ad_revenue` | 只读 | 读取收益数据（导出文件或用户自备令牌的 AdMob API） |
| `analyze_ad_performance` | 只读 | eCPM、填充率、展示率、CTR 与启发式建议 |
| `verify_ad_integration` | 执行命令 | 三级验证：静态、构建、运行时（指定设备时在模拟器或真机上自动跑冷烟测试）；不修改源码 |
| `generate_ad_integration` | **写入** | 计划 → 确认 → 写入；自动备份，幂等，不覆盖业务代码 |

## Skills

| Skill | 职责 |
| --- | --- |
| `ad-monetization` | 总入口，按阶段编排下面的 Skill |
| `ad-platform-selector` | 平台选型 |
| `ad-unit-planner` | 广告位规划 |
| `ad-compliance-checker` | 隐私与合规（GDPR/UMP、美国州隐私法、ATT、儿童） |
| `ad-sdk-integrator` | SDK 接入 |
| `ad-config-validator` | 配置校验 |
| `ad-integration-tester` | 构建验证与运行时检查 |
| `ad-revenue-optimizer` | 收益分析与优化 |

## 设计原则在代码中的体现

- **不重复官方 Skill**：官方已覆盖的组合返回 `delegate-official-skill` 和安装命令。
- **MCP 与 Skills 解耦**：Skills 只引用工具名和返回字段；没有 MCP 时也能按文档引导。
- **统一但不强求一致的适配器**：`PlatformAdapter` 只规定能力边界，平台专属参数由各适配器的 `optionsSchema` 自己校验。
- **先检查再修改**：生成计划前先分析工程现有代码与依赖；计划涉及的文件在 git 中有未提交改动时默认拒绝写入。
- **默认测试 ID**：生成代码默认使用 Google 官方测试 ID，真实 ID 通过 `--dart-define` 注入；`release` 校验会把测试 ID 判为失败。
- **不覆盖业务逻辑**：只新增 `lib/ads/` 下的文件，`main.dart` 插入的代码在标记块内；已有配置跳过；写入前备份原文件。
- **合规是接入流程的一部分**：生成的初始化代码先走 UMP 同意流程，`canRequestAds()` 为 true 才初始化 SDK。
- **三级验证分开报告**：静态通过、构建通过、真实广告展示是三件事，跳过的步骤标记为 `skipped`，不算通过。
- **账号操作由用户完成**：创建广告单元、发布隐私消息、获取 API 令牌都只给步骤，不代为操作。

## 目录

```
packages/mcp-server/   MCP 服务器、CLI、适配器、测试
skills/                8 个 Agent Skill
knowledge/             知识库（平台、SDK、隐私、错误码、文档摘要）
examples/              示例 Flutter 工程（只读）与提示词
scripts/               插件启动脚本、知识库检查、端到端脚本
docs/                  架构、调研、安装、使用、排错、路线图、验收报告
```

## 文档

- [竞品调研](docs/research/competitive-analysis.md)
- [架构设计](docs/architecture.md)
- [安装指南](docs/install.md)
- [使用示例](docs/usage.md) 与 [示例提示词](examples/prompts.md)
- [故障排查](docs/troubleshooting.md)
- [扩展路线图与成本评估](docs/roadmap.md)
- [MVP 验收报告](docs/mvp-acceptance-report.md)

## 许可证

MIT
