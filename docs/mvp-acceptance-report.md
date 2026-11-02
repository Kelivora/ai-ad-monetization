# MVP 验收报告

- 日期：2026-11-02
- 范围：AdMob × Flutter（Android + iOS），Banner / Interstitial / Rewarded
- 结论：**iOS 链路通过；Android 静态配置通过、构建未验证；运行时需人工验证。**

## 1. 验收环境

| 项 | 版本 |
| --- | --- |
| macOS | 26.5.2 |
| Node.js | 24.17.0 |
| Flutter | 3.47.9 stable |
| Xcode | 26.6 |
| CocoaPods | 1.17.0 |
| JDK / Android SDK | **未安装**（按决定只做 iOS 构建验证） |
| google_mobile_ads | 9.2.0（知识库核实日期 2026-11-02） |

被测工程：`examples/flutter_demo_app`，由 `flutter create --platforms android,ios` 生成且未修改。e2e 脚本复制到 `.tmp/e2e` 后操作，原工程保持不变。

## 2. 结果总览

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript 类型检查 | 通过 | `npm run typecheck` |
| 自动化测试 | 通过，13 个文件 119 个用例 | `npm test` |
| 构建 | 通过 | `npm run build` |
| MCP stdio 冒烟 | 通过，列出 14 个工具与 capabilities 资源 | `node packages/mcp-server/scripts/smoke-stdio.mjs` |
| Skills 结构校验 | 通过，8 个 Skill | `node scripts/validate-skills.mjs` |
| 端到端接入（apply） | 通过，写入 11 个文件 | `bash scripts/e2e-build.sh ios`，退出码 0 |
| 静态校验（development，US + EEA） | 通过：pass 21 / warning 0 / fail 0 / 不适用 1 | 同上 |
| 静态校验（release） | 按预期失败 3 项（测试 App ID × 2、测试广告单元 ID × 1） | 同上 |
| `flutter pub get` | 通过 | verify build 级 |
| `flutter analyze` | 通过，`No issues found!` | verify build 级 |
| iOS 模拟器构建 | 通过，`flutter build ios --simulator --debug --no-codesign`，约 26 秒 | verify build 级 |
| Android debug 构建 | **跳过**：缺少 JDK 与 Android SDK | verify 显示 `skipped` 和 `TOOLCHAIN_MISSING`，报告中标注“Android 构建未验证” |
| 运行时验证 | **未执行**，状态为 `requires_manual_verification`，提供 7 项检查清单 | verify runtime 级 |
| 生成内容语言 | 写入用户工程的代码和注释全部为英文（扫描 `lib/`、`Info.plist`、`AndroidManifest.xml`、`pubspec.yaml` 无中文字符） | `rg '\p{Han}'` |
| 收益分析 | 通过：示例报表 15 行，按格式和国家输出 eCPM / 填充率 / 展示率 / CTR，并给出 1 条标注为启发式的洞察 | `cli perf --file test/fixtures/revenue/admob_export.csv` |

除测试的 git 工作区用例需要在非沙箱环境运行（沙箱禁止 `git init` 写入 `.git/hooks`）外，以上结果均由架构评审方在执行者自测之后独立重跑确认。

## 3. 端到端链路明细

e2e 依次执行：构建 MCP 服务器 → 复制干净工程 → `cli apply` → `cli verify`（static + build + runtime）→ 两种口径的 `cli validate` → `cli report`。

写入的文件（来自 `.ai-ad-monetization/integration.json`）：

```
lib/ads/ad_unit_ids.dart
lib/ads/ads_consent.dart
lib/ads/ads_initializer.dart
lib/ads/anchored_banner_ad.dart
lib/ads/interstitial_ad_controller.dart
lib/ads/rewarded_ad_controller.dart
lib/ads/ads.dart
pubspec.yaml
android/app/src/main/AndroidManifest.xml
ios/Runner/Info.plist
lib/main.dart
```

Flutter 3.47 新工程默认 minSdk 24、compileSdk 36、iOS 部署目标 15.0，均满足插件要求，所以 Gradle 和 Podfile 不需要改，plan 中对应项为 `skip`。

e2e 另外写入了一个演示页面 `lib/ads_demo_usage.dart`。它不属于生成器输出，作用是让 `flutter analyze` 和编译器按真实调用方式检查生成代码的公开 API。

verify 的 build 级输出：

```
static: passed（pass 21 / warning 0 / fail 0 / na 1）
build: passed
  passed  pub_get 1.1s
  passed  analyze 4.1s
  skipped build_android — TOOLCHAIN_MISSING: java 命令不可用（安装 JDK 17+，或安装 Android Studio 自带的 JDK）; 未找到 Android SDK（安装 Android Studio，或设置 ANDROID_HOME/ANDROID_SDK_ROOT 指向 SDK 目录）
  passed  build_ios 26.0s
```

## 4. 静态校验规则覆盖

development 口径下全部通过的规则：插件存在与版本、Dart SDK 约束、Android / iOS App ID、App ID 未跨平台误用、测试 App ID、广告单元 ID 格式、Android minSdk、iOS 部署目标、SKAdNetwork、SDK 已初始化、UMP 同意流程、`canRequestAds()` 门控、隐私选项入口、Banner 与全屏广告的 dispose、未使用已废弃的 Banner 尺寸 API。儿童定向标签（`CHILD_DIRECTED_TAG`）因未声明面向儿童而不适用。

## 5. 评审中发现并已修复的问题

| 问题 | 影响 | 修复 |
| --- | --- | --- |
| 初始化结果被永久缓存，包括失败结果 | EEA 用户首次拒绝、之后在隐私选项中同意，广告仍永远不会加载 | 只缓存成功结果；新增 `showPrivacyOptionsAndRetry()`，表单关闭后重试初始化 |
| 控制器 dispose 后才返回的广告未被释放 | 内存泄漏，后台可能继续持有全屏广告 | `onAdLoaded` 中检查 `_disposed` 并立即释放；重载与退避也遵守 `_disposed` |
| 规则按子串匹配类名 | 只用 `AnchoredBannerAd` 的文件会被误判为“BannerAd 未 dispose” | 改为单词边界匹配并忽略注释，增加回归测试 |
| 写入用户工程的注释为中文 | 不符合大多数项目的代码规范 | 生成内容全部改为英文 |
| `flutter analyze` 只统计日志最后 60 行 | 前面的 error 会被漏掉 | 改为统计完整日志 |
| analyze 退出码非 0 且解析不出问题时判为通过 | 分析器自身崩溃会被当成通过 | 改判为失败并说明原因 |
| 诊断正则过宽 | iOS 构建日志总含 “Running pod install”，任何失败都会附带误导性的 CocoaPods 诊断 | 只匹配失败语句 |
| 接入报告不含真实验证结果 | 报告第 7 节显示“未执行” | `verify --json-out` 与 `report --verification-file` 串联 |

## 6. 未验证项与已知限制

1. **Android 构建未在本机验证。** Android 侧的 Manifest App ID 与 minSdk 已通过静态校验和补丁单元测试，但 Gradle 依赖解析和编译没有实际跑过。建议在装有 JDK 17 与 Android SDK 的机器或 CI 上执行 `bash scripts/e2e-build.sh android`。
2. **运行时未验证。** 没有在模拟器或真机上看到 “Test Ad” 广告，也没有实际弹出 UMP 表单。UMP 表单还要求先在 AdMob 后台发布隐私消息，这需要账号权限。
3. **AdMob Reporting API 只做了模拟测试。** 请求格式与响应解析按官方 `networkReport:generate` 约定实现，并用假 fetch 测试，没有用真实令牌调用。
4. **AppLovin MAX 与 Unity LevelPlay 只有知识库**，不能自动接入。成本评估见 [路线图](roadmap.md)。
5. **`main.dart` 结构识别有限。** 非常规启动方式（如 `runZonedGuarded`、启动逻辑在其他文件）不会自动改写，而是给出手动步骤。
6. **收益洞察是启发式规则**，阈值来自 `knowledge/common/benchmarks.json` 的编辑评估，不代表行业基准，也不保证收益。

## 7. 复现步骤

```bash
npm install
npm run typecheck && npm test && npm run build
node packages/mcp-server/scripts/smoke-stdio.mjs
bash scripts/e2e-build.sh ios        # 报告输出到 .tmp/e2e-report.md
bash scripts/e2e-build.sh android    # 需要 JDK 17 与 Android SDK
```
