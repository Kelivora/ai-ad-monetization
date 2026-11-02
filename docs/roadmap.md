# 扩展路线图与成本评估

MVP 只把 **AdMob × Flutter** 做成了全自动链路。AppLovin MAX 和 Unity LevelPlay 目前是 `knowledge-only`：可以参与选型、比较和文档查询，但不能自动接入。本文评估把它们以及其他广告网络做到同等程度需要多少工作。

估算单位为“人日”，按一名熟悉本仓库的开发者计算，包含测试与一次真实构建验证，不包含等待账号审核的时间。标注“需核实”的事实在动手前必须对照官方文档重新确认，不能直接写进知识库。

## 1. 新平台需要补哪些东西

架构上每个平台是一个 `PlatformAdapter`（`packages/mcp-server/src/adapters/types.ts`），各部分可以分阶段交付：

| 组成部分 | 内容 | 是否可复用 MVP |
| --- | --- | --- |
| 知识库 | `platform.json`、`sdk/<framework>.json`、隐私、错误码、文档摘要；每条都要有来源和核实日期 | 结构与校验脚本可复用 |
| 选型数据 | `editorial.selection` 评分与市场适配 | 已有（MAX、LevelPlay） |
| 接入指南 | `getIntegrationGuide` | 通用框架可复用 |
| 接入计划 | `planIntegration`：依赖、原生配置、生成代码 | `core/patch/*` 的 pubspec / Manifest / plist / Gradle / Podfile 补丁器可直接复用；Dart 模板需重写 |
| 校验规则 | `validationRules` | 规则引擎可复用；规则需按平台重写 |
| 构建验证 | `verify_ad_integration` | 与平台无关，直接复用 |
| 收益报表 | `fetchRevenue` + 字段映射 | `RevenueRow` 与指标分析可复用；需要新的 API 客户端和 CSV 列名映射 |
| 端到端脚本 | `e2e-build.sh` 增加平台参数 | 可复用 |

## 2. AppLovin MAX

**现状**：`knowledge-only`；Flutter 插件 `applovin_max` 版本未核实。

| 工作项 | 人日 | 说明 |
| --- | --- | --- |
| 知识库核实（插件版本、最低 Flutter/Android/iOS 版本、初始化 API、SKAdNetwork 列表、错误码） | 2 | AppLovin 在 GitHub 维护 `AppLovin-MAX-Flutter`，**需核实**是否为官方插件；确认后 Flutter 支持等级可从 `guided` 提升 |
| 接入计划与 Dart 模板（初始化、Banner/MREC、插屏、激励、生命周期） | 4 | API 是监听器风格，与 AdMob 差异大，不强行套用 AdMob 模板 |
| 隐私流程 | 2 | MAX 可以用自带的条款与隐私流程，也可以接 Google UMP，两者需二选一并写成规则 |
| 校验规则 | 2 | SDK Key 存在、广告单元 ID 格式、SKAdNetwork、隐私流程、dispose |
| 测试模式 | 1.5 | **关键差异**：MAX 没有类似 AdMob 的公共测试广告单元，测试依赖“测试设备注册 + Mediation Debugger”。“默认使用测试 ID”原则需要改为“默认开启测试模式并要求注册测试设备”，并在校验中体现 |
| Ad Review / 质量服务插件 | 1 | Gradle 插件与 iOS 脚本需要 Ad Review Key，属于账号授权项，只能引导用户配置 |
| 收益报表（MAX Revenue Reporting API，使用 Report Key） | 2 | 不需要 OAuth，但 Report Key 必须由用户提供，规则与 `ADMOB_ACCESS_TOKEN` 相同 |
| 测试与 e2e | 2.5 | 需要一个真实 SDK Key 才能做运行时验证 |
| **合计** | **约 17** | |

**风险**：账号与 SDK Key 获取需要用户完成；聚合网络适配器（Meta、Pangle 等）的版本矩阵会显著增加知识库维护量，建议首期只做 MAX 自有需求，聚合适配器放到第二期。

## 3. Unity LevelPlay

**现状**：Unity 引擎项目已委派官方 Skill（`npx skills add Unity-Technologies/skills`，beta，要求 LevelPlay 9.4.0+）；Flutter 插件 `unity_levelplay_mediation` 版本未核实。

| 工作项 | 人日 | 说明 |
| --- | --- | --- |
| 知识库核实（Flutter 插件归属与版本、App Key 初始化、广告单元 API、错误码） | 2 | LevelPlay 近年把 API 从“按格式全局实例”迁移到“按广告单元对象”，**需核实** Flutter 插件对应的是哪一套 |
| 接入计划与 Dart 模板 | 4 | |
| 隐私 | 1.5 | LevelPlay 本身不提供 CMP，需要接 Google UMP 或其他 CMP 并把同意状态传给 SDK |
| 校验规则 | 2 | |
| 测试模式 | 1.5 | 同样没有公共测试广告单元，依赖控制台测试设备与 Integration Test Suite |
| 收益报表 | 2.5 | Reporting API 细节在知识库中标为 `verified: false`，需要先核实认证方式与字段 |
| 测试与 e2e | 2.5 | |
| **合计** | **约 16** | Unity 引擎项目继续委派官方 Skill，不计入 |

**风险**：非游戏应用的选型评分偏低，投入产出比低于 MAX；建议排在 MAX 之后。

## 4. 通过 AdMob 聚合接入其他网络（成本最低）

Google 为 Flutter 发布了一系列 `gma_mediation_*` 聚合适配器包（例如 Meta Audience Network、AppLovin、Pangle、Liftoff、Mintegral、Unity Ads），**包名与版本需核实**。这条路线不需要新的 `PlatformAdapter`，只需扩展 AdMob 适配器：

| 工作项 | 每个网络人日 | 说明 |
| --- | --- | --- |
| 知识库：适配器包版本、对应原生 SDK 版本、额外的 Manifest / plist / SKAdNetwork 条目 | 0.5 | |
| plan：追加依赖与原生配置 | 0.5 | 复用现有补丁器 |
| 校验规则：适配器与 google_mobile_ads 版本兼容、隐私信号传递 | 0.5 | |
| 测试与构建验证 | 0.5–1 | |
| **合计** | **2–2.5 / 个** | 后台中的聚合组、瀑布流和出价配置仍需用户在 AdMob 控制台完成 |

## 5. 其他框架

| 组合 | 建议 | 人日 |
| --- | --- | --- |
| AdMob × 原生 Android / iOS / Unity | 继续委派 Google 官方 Skill，不重复实现 | 0 |
| AdMob × React Native | 社区库 `react-native-google-mobile-ads`，可做 `guided` 级；自动化需要 JS/TS 补丁器与 Expo 配置插件支持 | 8–10 |
| AdMob × Kotlin Multiplatform / Compose Multiplatform | 生态不成熟，暂不支持 | — |

## 6. 横向能力

| 能力 | 人日 | 说明 |
| --- | --- | --- |
| Android 构建验证在 CI 中常态化（JDK 17 + Android SDK） | 1 | MVP 在本机未验证 Android 构建，这是第一优先级 |
| 运行时自动验证（模拟器启动 + 日志断言 “Test Ad” / 初始化完成） | 4–5 | 用 `flutter drive` 或 integration_test 读取 SDK 日志；仍不能替代真机验证 |
| 知识库定时复核（CI 每周跑 `kb:check` 并开 issue） | 1 | |
| App Open 与 Native 广告格式（AdMob × Flutter） | 各 2–3 | Native 需要原生侧 factory，工作量偏大 |

## 7. 建议顺序

1. **M1（约 1 周）**：Android 构建在 CI 中验证；知识库定时复核；用两三个开源 Flutter 应用做接入回归。
2. **M2（约 2 周）**：AdMob 聚合适配器（Meta、AppLovin、Pangle 三个），App Open 广告。
3. **M3（约 3–4 周）**：AppLovin MAX × Flutter 全自动链路。
4. **M4（约 3 周）**：Unity LevelPlay × Flutter，或按用户需求改做 React Native。

每个里程碑沿用 MVP 的验收口径：静态校验、构建验证、运行时检查清单分开报告，未执行的项写明“未验证”。
