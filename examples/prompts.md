# 示例提示词

可以直接复制给已安装本插件的 Agent。括号里是预期触发的 Skill。

## 选型

- 我做的是一个 Flutter 记账工具，用户主要在日本和美国，第一次做广告变现，推荐用哪个平台？（ad-platform-selector）
- 对比 AdMob、AppLovin MAX 和 Unity LevelPlay 在 Flutter 休闲游戏上的优劣，重点看接入难度和聚合能力。（ad-platform-selector）
- google_mobile_ads 最新版本要求的 Flutter、Android minSdk 和 iOS 部署目标分别是多少？我的工程 `./` 是否满足？（ad-sdk-integrator → get_sdk_compatibility）

## 广告位规划

- 这是一个新闻阅读应用，帮我规划横幅、插屏和激励视频应该放在哪里、频控怎么设，避免影响阅读体验。（ad-unit-planner）
- 检查 `lib/pages/feed_page.dart` 适不适合放横幅，会不会和底部导航冲突造成误点。（ad-unit-planner）

## 接入

- 给 `examples/flutter_demo_app` 的副本接入 AdMob 横幅、插屏和激励视频，先给我看改动计划，确认后再写入。（ad-monetization → ad-sdk-integrator）
- 我的工程已经接了 google_mobile_ads 的横幅，只帮我补一个激励视频，不要动现有代码。（ad-sdk-integrator）
- 我们的应用面向 13 岁以下儿童，接入广告要注意什么？（ad-compliance-checker）

## 校验与验证

- 检查当前工程的广告配置，按欧洲和美国市场的上线标准。（ad-config-validator）
- 跑一遍广告接入验证：静态检查、iOS 模拟器构建，再给我一份运行时手动检查清单。（ad-integration-tester）
- 生成一份接入报告，列出改了哪些文件、哪些还没验证、上线前我还要做什么。（ad-integration-tester → build_integration_report）

## 收益分析

- 分析 `~/Downloads/admob_october.csv`，按广告格式和国家看 eCPM、填充率和展示率，有哪些可以优化的地方？（ad-revenue-optimizer）
- 我已经设置了 `ADMOB_ACCESS_TOKEN`，拉取 pub-1234567890123456 上个月的收益并和前一个月对比。（ad-revenue-optimizer）

## 预期会被拒绝或转交的请求

- 帮我登录 AdMob 后台创建广告单元。→ 账号操作必须由你本人完成，工具只给出步骤。
- 给我的 Unity 游戏接入 LevelPlay。→ 转交 Unity 官方 Skill：`npx skills add Unity-Technologies/skills`。
- 给原生 Android 应用接入 AdMob。→ 转交 Google 官方 Skill：`npx skills add google/skills/skills/ads`。
- 帮我在用户不知情时自动点击广告提高收入。→ 违反 AdMob 政策，拒绝。
