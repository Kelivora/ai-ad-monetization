# 使用示例

下面的示例分三种用法：直接对 Agent 说话（Skills 会编排工具调用）、手动调用 MCP 工具、使用 CLI。更多可直接复制的提示词见 [`examples/prompts.md`](../examples/prompts.md)。

## 1. 用对话完成一次完整接入

> 帮我给 `~/code/news_app` 这个 Flutter 应用接入广告，主要用户在美国和欧洲，想要底部横幅、文章之间的插屏和一个“看广告解锁”的激励视频。

`ad-monetization` Skill 会按下面的顺序推进，每一步都会给你看结果：

1. `analyze_project`：识别框架、Android/iOS 配置、已有广告 SDK 和隐私组件。
2. `recommend_ad_platform` / `compare_ad_platforms`：给出推荐平台和理由（新闻类 + Flutter + US/EEA 通常推荐 AdMob）。
3. `plan_ad_placements`：建议广告位、频控和避免误点的布局。
4. `ad-compliance-checker`：确认 EEA 需要 UMP 同意流程、iOS 需要 SKAdNetwork 和 ATT 说明、是否面向儿童。
5. `generate_ad_integration`（`mode: "plan"`）：列出将新增或修改的文件和 diff，**不写盘**。
6. 你确认后，再以 `mode: "apply"`、`confirm: true`、`expectedPlanHash` 写入。
7. `validate_ad_config` → `verify_ad_integration` → `build_integration_report`。

## 2. 直接调用 MCP 工具

### 只读：分析与选型

```json
{ "tool": "analyze_project", "arguments": { "projectPath": "/Users/me/code/news_app" } }
```

```json
{
  "tool": "recommend_ad_platform",
  "arguments": {
    "framework": "flutter",
    "targets": ["android", "ios"],
    "markets": ["US", "EEA"],
    "appCategory": "news",
    "goal": "balanced"
  }
}
```

```json
{ "tool": "get_sdk_compatibility", "arguments": { "platformId": "admob", "framework": "flutter", "projectPath": "/Users/me/code/news_app" } }
```

### 写入：两步确认

第一步只生成计划：

```json
{
  "tool": "generate_ad_integration",
  "arguments": {
    "projectPath": "/Users/me/code/news_app",
    "platformId": "admob",
    "formats": ["banner", "interstitial", "rewarded"],
    "mode": "plan"
  }
}
```

返回的 `data.planHash` 和每个文件的 diff 需要你过目。确认后第二步：

```json
{
  "tool": "generate_ad_integration",
  "arguments": {
    "projectPath": "/Users/me/code/news_app",
    "platformId": "admob",
    "formats": ["banner", "interstitial", "rewarded"],
    "mode": "apply",
    "confirm": true,
    "expectedPlanHash": "<上一步返回的 planHash>"
  }
}
```

计划生成后如果工程又被修改，会返回 `PLAN_MISMATCH`，需要重新生成计划。

### 校验与验证

```json
{ "tool": "validate_ad_config", "arguments": { "projectPath": "/Users/me/code/news_app", "profile": "development", "markets": ["US", "EEA"] } }
```

```json
{ "tool": "verify_ad_integration", "arguments": { "projectPath": "/Users/me/code/news_app", "levels": ["static", "build", "runtime"] } }
```

`verify_ad_integration` 的结果分三级返回：`static` 和 `build` 实际执行，`runtime` 只返回人工检查清单（状态为 `requires_manual_verification`）。

### 收益分析

```json
{
  "tool": "get_ad_revenue",
  "arguments": {
    "platformId": "admob",
    "source": "file",
    "filePath": "/Users/me/Downloads/admob_report.csv",
    "startDate": "2026-10-01",
    "endDate": "2026-10-31"
  }
}
```

```json
{ "tool": "analyze_ad_performance", "arguments": { "filePath": "/Users/me/Downloads/admob_report.csv", "groupBy": ["format", "country"] } }
```

使用 `source: "admob_api"` 时需要先自行设置 `ADMOB_ACCESS_TOKEN` 并传入 `publisherId`（`pub-` 开头）。性能洞察都标记为启发式，不构成收益保证。

## 3. 在业务代码中使用生成的组件

接入后 `lib/ads/` 下会生成以下文件，`main.dart` 会被插入两行初始化代码（位于 `// ai-ad-monetization:begin/end` 标记之间）：

| 文件 | 作用 |
| --- | --- |
| `ads.dart` | 统一导出 |
| `ad_unit_ids.dart` | 广告单元 ID，默认是 Google 官方测试 ID，可用 `--dart-define` 覆盖 |
| `ads_consent.dart` | UMP 同意流程封装 |
| `ads_initializer.dart` | 先走同意流程，`canRequestAds()` 为 true 才初始化 SDK |
| `anchored_banner_ad.dart` | 自适应锚定横幅 Widget |
| `interstitial_ad_controller.dart` | 插屏：预加载、频控（默认 180 秒）、关闭后自动重新加载 |
| `rewarded_ad_controller.dart` | 激励：预加载、`isReady` 状态、奖励回调 |

```dart
import 'ads/ads.dart';

class ArticlePage extends StatefulWidget {
  const ArticlePage({super.key});

  @override
  State<ArticlePage> createState() => _ArticlePageState();
}

class _ArticlePageState extends State<ArticlePage> {
  final InterstitialAdController _interstitial = InterstitialAdController(minIntervalSeconds: 120);
  final RewardedAdController _rewarded = RewardedAdController();

  @override
  void initState() {
    super.initState();
    _interstitial.load();
    _rewarded.load();
  }

  @override
  void dispose() {
    _interstitial.dispose();
    _rewarded.dispose();
    super.dispose();
  }

  // Call at a natural break, e.g. when leaving an article.
  Future<void> onArticleFinished() => _interstitial.showIfReady();

  Future<void> unlockPremiumParagraph() => _rewarded.show(
        onReward: (reward) => setState(() { /* grant the reward */ }),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      bottomNavigationBar: const AnchoredBannerAd(),
      body: const Placeholder(),
    );
  }
}
```

设置页需要提供隐私选项入口（EEA 用户可随时修改同意）：

```dart
ListTile(
  title: const Text('Privacy options'),
  onTap: () => AdsInitializer.instance.showPrivacyOptionsAndRetry(),
)
```

上线时注入真实 ID，而不是修改源码：

```bash
flutter build appbundle \
  --dart-define=ADMOB_ANDROID_BANNER_ID=ca-app-pub-xxxx/yyyy \
  --dart-define=ADMOB_ANDROID_INTERSTITIAL_ID=ca-app-pub-xxxx/yyyy \
  --dart-define=ADMOB_ANDROID_REWARDED_ID=ca-app-pub-xxxx/yyyy
```

App ID 写在 `AndroidManifest.xml` 和 `Info.plist` 中，上线前也必须替换。用 `validate_ad_config` 的 `release` 口径检查是否还有测试 ID。

## 4. CLI

```bash
CLI=packages/mcp-server/dist/cli.js
node $CLI analyze  ~/code/news_app
node $CLI plan     ~/code/news_app --formats banner,interstitial,rewarded
node $CLI apply    ~/code/news_app --formats banner,interstitial,rewarded --yes
node $CLI validate ~/code/news_app --profile release
node $CLI verify   ~/code/news_app --levels static,build,runtime --json-out verify.json
node $CLI report   ~/code/news_app --verification-file verify.json --out report.md
node $CLI perf     --file packages/mcp-server/test/fixtures/revenue/admob_export.csv
```

`verify` 的退出码：0 表示请求的级别没有失败，1 表示 static 或 build 失败，3 表示所有级别都被跳过（例如没有安装 Flutter）。
