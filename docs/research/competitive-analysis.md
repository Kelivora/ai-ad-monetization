# 竞品调研：AI 广告变现 Agent 生态

> 调研日期：2026-11-02。源码均为当日 `git clone --depth 1` 的 main 分支快照（本地路径 `research/vendor/`，不入库）。
> 结论先行：**官方 Skills 已经把"单一平台 × 原生框架"的接入写得很好，但没有任何一家覆盖 Flutter，也没有任何一家做跨平台选型、合规串联和"静态检查 / 构建验证 / 真实投放"三级验证。** 这就是本项目的位置。

## 1. 调研对象一览

| 竞品 | 形态 | 覆盖 | 是否开源 | 与本项目的关系 |
| --- | --- | --- | --- | --- |
| Google Mobile Ads Agent Skills (`google/skills/skills/ads`) | 纯 Skills | AdMob/Ad Manager × Android / iOS / Unity | 是 | **委派对象**：原生 Android/iOS/Unity 直接调用 |
| Unity LevelPlay Skill (`Unity-Technologies/skills`) | 纯 Skill（beta） | LevelPlay × Unity | 是 | **委派对象**：Unity 引擎项目直接调用 |
| AdMob MCP（社区：`jerry2247/admob-mcp`、`willhou/admob-mcp`、`kunny/admob-mcp-server`） | MCP Server | AdMob API：账户、应用、广告单元、报表、聚合 | 是 | **组合对象**：收益/报表读取可复用；安全模型直接借鉴 |
| AppLovin MCP（官方 `applovin-mcp`） | MCP Server | Axon 投放侧（广告主），白名单 beta | npm 包 | 不覆盖 MAX 变现侧；MAX 收益需走 Revenue Reporting API |
| RevenueCat AI Toolkit (`RevenueCat/ai-toolkit`) | Plugin = Skills + 远程 MCP + CLI | 订阅变现，iOS/Android/Flutter/RN/KMP | 是 | **架构范本**：插件打包、多 Agent 清单、平台探测算法 |

Google Ads MCP（`googleads/google-ads-mcp`）是投放侧，不是变现侧，不在范围内。

## 2. 逐个分析

### 2.1 Google Mobile Ads Agent Skills

**目录结构**（每个 Skill 一个目录，`SKILL.md` + `references/<platform>-<topic>.md`）：

```
skills/ads/
├── google-mobile-ads-get-started/      SKILL.md + references/{android,ios,unity}-get-started.md
├── google-mobile-ads-banner/           SKILL.md + references/{android,ios,unity}-banner.md
├── google-mobile-ads-interstitial/
├── google-mobile-ads-rewarded/
├── google-mobile-ads-validate/         SKILL.md + references/{application-id,ad-units,google-skadnetwork-ids,mediation-adapter-compatibility,ad-preloading}.md
└── google-mobile-ads-android-migrate-to-next-gen/
```

安装：`npx skills add google/skills/skills/ads`（兼容 Claude Code、Codex、Cursor、Antigravity）。

**设计要点**

- SKILL.md 很短，只做"工作流骨架"：判断平台 → 读对应 reference → 按清单执行 → 提醒替换测试 ID。细节全部下沉到 references，按需加载，节省上下文。
- 广告位决策写成硬规则：父容器可滚动用 Inline Adaptive，不可滚动用 Large Anchored Adaptive；不确定位置就问。
- `validate` Skill 给出了可复用的检查口径：App ID 正则 `^(ca-app-pub-[a-zA-Z0-9\-]+)~(.*)$`、广告单元正则 `^(ca-app-pub-[a-zA-Z0-9\-]+)/([a-zA-Z0-9_\-]+)(/.*)?$`、测试 ID 前缀 `ca-app-pub-3940256099942544`、Google SKAdNetwork ID 全集、Pass / Warning / Fail / N/A 四级评分和 Markdown 报告模板。
- 版本策略："ALWAYS look up and use the latest stable version. Do not assume a version number."

**能力边界**

- 只支持 Android、iOS、Unity，**没有 Flutter、React Native**。
- 没有平台选型、广告位规划、隐私合规（UMP）串联、构建验证，也没有收益分析。
- 纯文本指令，没有可执行工具，结果是否正确依赖 Agent 自觉。

**可复用**：Skill 目录形态、validate 检查项与正则、SKAdNetwork ID 列表、测试 ID 表；原生项目直接委派给它们。

### 2.2 Unity LevelPlay Agent Skill

单个大 Skill `levelplay-unity-integration`：`SKILL.md`（约 440 行的工作流脊柱）+ 12 个 references（初始化、各格式 API、隐私、iOS、依赖解析、测试、排错、SDK 9 迁移、ILRD）。

**设计要点（最值得借鉴的部分）**

- **硬门禁**：在 `Packages/packages-lock.json` 读到 `com.unity.services.levelplay` 之前不写任何 LevelPlay 代码；**禁止 Agent 自己往 lock 文件里写条目来"制造证据"**；没有 Editor 时明确说明并停下。这正对应本项目"编译成功 ≠ 投放成功""不能把未经验证的代码当确定答案"的要求。
- 用业务目标驱动广告策略：Revenue / UX / Balanced 三档，映射成格式优先级和频控（插屏 3–5 分钟 / 5–7 分钟）。
- 版本感知：同一个 API 在 9.4.x 和 9.5.0+ 的正确写法不同，Skill 里显式分支。
- 合规声明："不是法律建议"，隐私设置必须在 Init 之前。
- 一步一问、检查点确认，代价是在无人值守流水线里会卡住（Unity 官方文档也承认这一点）。

**能力边界**：只覆盖 Unity 引擎 + LevelPlay；明确禁止评价竞品；没有工具层。

**可复用**：硬门禁写法、目标→策略映射表、版本分支写法、合规免责声明；Unity 项目直接委派。

### 2.3 AdMob MCP Server（社区）

以 `jerry2247/admob-mcp`（TypeScript，`@modelcontextprotocol/sdk` 1.29 + zod 4 + `@googleapis/admob`）为代表：

```
src/
├── index.ts / server.ts      stdio 入口与注册
├── tools/{accounts,inventory,mediation,reports,experiments}.ts
├── lib/{confirm,errors,result,log}.ts
├── auth/{oauth,scopes,store}.ts
├── capabilities.ts           admob://capabilities 资源：哪些能力 API 不支持
└── resources/ prompts/
```

**设计要点**

- 读写分离：读工具 `readOnlyHint: true`；写工具 `destructiveHint: true`，并带 `_meta: {"anthropic/requiresUserInteraction": true}` 强制每次人工确认，且支持 `dryRun` 返回将要发出的请求。
- "API first"：只暴露官方 API 真实支持的操作，UMP 消息、app-ads.txt、测试设备、支付等没有 API 的能力在 `capabilities` 资源里明确列出，不用浏览器自动化绕过。
- v1beta 写接口需要 Google 白名单，403 被翻译成可读错误。

**能力边界**：只管账户与报表，不碰 App 工程和 SDK 接入。

**可复用**：读写注解 + 强制确认 + dryRun 的安全模型；"能力边界资源"的做法；收益查询阶段可直接建议用户并装它，而不是重写 AdMob API 客户端。

### 2.4 AppLovin MCP

- 官方 `npx -y applovin-mcp@latest`，面向 **Ads Manager / Axon（广告主投放侧）**，白名单 beta，需要 Campaign Management + Reporting 两把 key，`APPLOVIN_READONLY=true` 可关掉写工具。官方声明"优化建议是 LLM 的解读，不是 AppLovin 官方建议"。
- **MAX 变现侧没有官方 MCP**。收益数据走 Revenue Reporting API `https://r.applovin.com/maxReport`（`start`/`end`/`format`/`columns`，维度含 `ad_format`、`country`、`network`、`max_ad_unit_id`，指标含 `impressions`、`estimated_revenue`、`ecpm`、`fill_rate`）。社区有 Go 写的 PoC（`FurkanEmiroglu/Applovin-Max-MCP-Server`），作者自己标注不可用于生产。

**结论**：第二阶段接 MAX 时，收益适配器直接对接 `maxReport`；SDK 接入没有官方 Skill 可委派，需要自己写知识库和 Flutter 接入（`applovin_max` 插件）。

### 2.5 RevenueCat AI Toolkit

**目录结构**（一个仓库，多 Agent 清单，一次安装 = Skills + MCP）：

```
.claude-plugin/marketplace.json   .cursor-plugin/marketplace.json   .agents/plugins/marketplace.json
revenuecat/
├── .claude-plugin/plugin.json  .codex-plugin/plugin.json  .cursor-plugin/plugin.json  gemini-extension.json
├── .mcp.json                   远程 MCP：https://mcp.revenuecat.ai/mcp（OAuth 或 API v2 key）
└── skills/                     25 个 Skill，含 integrate-revenuecat、revenuecat-sdk-compatibility、revenuecat-troubleshoot、revenuecat-ad-tracking …
```

CI 会校验所有 JSON 清单是否符合 Agent Plugins 1.0.0 schema。

**设计要点**

- 明确分工："Skills carry procedural knowledge; the MCP server carries access."
- `integrate-revenuecat` 的平台探测算法：按 RN → Flutter → KMP → Android → iOS 顺序取第一个命中，多命中时取"最外层、拥有构建的那个工程"（例如 Flutter 工程里的 `ios/` 不算原生 iOS）。
- 验收口径："Do not claim setup is complete until the project builds, the app launches and logs the configuration banner"——同样区分了构建和运行时。
- 无法交互时不要卡住：采用推荐默认值，并在总结里说明选了什么、如何切换。
- 公钥/私钥分级：客户端只放公钥。
- 有 `revenuecat-sdk-compatibility` 这类"版本 × 功能"查询 Skill，对应我们的 `get_sdk_compatibility`。

**可复用**：插件打包方式（Claude Code / Codex / Cursor 一次安装）、平台探测算法、"无交互时取默认值并说明"、验证口径。

## 3. 横向对比与空白

| 能力 | Google Skills | LevelPlay Skill | AdMob MCP | AppLovin MCP | RevenueCat | **本项目 MVP** |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 跨平台选型/推荐 | – | 明确禁止 | – | – | – | ✅ |
| Flutter 广告接入 | – | – | – | – | 订阅有，广告无 | ✅ |
| 项目分析（已有 SDK/依赖） | 部分 | ✅（读 lock 文件） | – | – | ✅ | ✅（工具化） |
| 广告位规划 | 规则 | 目标→策略 | – | – | – | ✅ |
| 隐私合规（UMP/ATT）串联 | – | ✅ | 声明无 API | – | – | ✅ |
| 可执行的配置检查 | 文本清单 | 文本 | – | – | – | ✅（工具 + 规则） |
| 构建验证 | – | 让用户看 Console | – | – | 要求构建 | ✅（工具执行） |
| 三级验证分离 | – | 部分 | – | – | 部分 | ✅ |
| 收益报表 | – | – | ✅ | 投放侧 | 订阅 | 导入/组合 |
| 知识来源与时效标注 | – | 版本分支 | – | – | – | ✅ |

## 4. 对本项目的设计结论

1. **不重写官方能力，改为路由**。知识库为每个"平台 × 框架"记录 `officialSkill`；原生 Android/iOS/Unity + AdMob 时，`get_integration_guide` 返回 `strategy: "delegate-official-skill"` 和安装命令（`npx skills add google/skills/skills/ads`），Unity + LevelPlay 同理。我们只自动化官方空白：**Flutter**。
2. **Skills 管流程，MCP 管能力**（RevenueCat 的分工）。Skill 里写判断逻辑与检查点；MCP 工具负责确定性操作：探测、比较、生成补丁、检查、跑构建。
3. **安全模型照搬 AdMob MCP**：读写注解、写工具强制确认、`plan`（dry run）先于 `apply`。
4. **门禁照搬 LevelPlay**：没读到依赖就不写代码；构建工具缺失就如实报告"未验证"，不伪造通过。
5. **验证分三级**：`static`（配置/代码静态检查）→ `build`（`flutter analyze` + `flutter build`）→ `runtime`（真机/模拟器上出现 Test Ad 标签，需人工确认）。报告中三级各自独立给结论。
6. **知识库带出处与时效**：每条事实带 `sourceUrl`、`retrievedAt`、`verifiedVersion`，超期自动标记 `stale`，工具输出里附来源。
7. **收益侧组合而非重写**：MVP 支持导入 AdMob 报表（CSV/JSON）做分析；在线查询建议并装社区 AdMob MCP 或由用户提供 OAuth token，账号授权始终由用户本人完成。
8. **打包对齐 RevenueCat**：同一仓库提供 Claude Code / Codex / Cursor 插件清单 + `npx skills add` 兼容的 `skills/` 目录。

## 5. MVP 依据的官方事实（已写入知识库）

| 事实 | 值 | 来源 |
| --- | --- | --- |
| Flutter 插件 | `google_mobile_ads` 9.2.0（2026-10 发布） | https://pub.dev/packages/google_mobile_ads/changelog |
| Flutter / Dart 最低版本 | Flutter ≥ 3.38.1，Dart ≥ 3.10.0 | 插件 `pubspec.yaml`；https://developers.google.com/admob/flutter/quick-start |
| Android | minSdk 24，compileSdk 36；默认 `play-services-ads` 25.5.0，可选 Next-Gen SDK 1.5.0 | 插件 `android/build.gradle` |
| iOS | 部署目标 13.0；`Google-Mobile-Ads-SDK ~> 13.11`；支持 CocoaPods 与 SPM | 插件 podspec / `Package.swift` |
| UMP | Android 4.0.0，iOS 3.1.0；`requestConsentInfoUpdate` → `loadAndShowConsentFormIfRequired` → `canRequestAds` | https://developers.google.com/admob/flutter/privacy |
| 测试 App ID | Android `ca-app-pub-3940256099942544~3347511713`；iOS `ca-app-pub-3940256099942544~1458002511` | Google skills `get-started` references |
| 测试广告单元 | Banner（自适应）A `…/9214589741` / i `…/2435281174`；插屏 A `…/1033173712` / i `…/4411468910`；激励 A `…/5224354917` / i `…/1712485313` | https://developers.google.com/admob/flutter/banner 、/interstitial 、/rewarded |
| Banner 尺寸 API | `AdSize.getLargeAnchoredAdaptiveBannerAdSize(width)`（8.0.0 起旧 API 废弃） | changelog 8.0.0；banner 文档 |
| 平台限制 | 插件只支持 Android 与 iOS，不支持 Web/桌面 | quick-start |
