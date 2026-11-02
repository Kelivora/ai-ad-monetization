# 故障排查

先确认问题出在哪一级：**静态校验**（配置是否齐全）、**构建验证**（能否编译）、**运行时**（广告能否真的展示）。三级相互独立：构建成功不代表广告能投放，静态校验通过也不代表能编译。

## 1. 工具返回的错误码

所有工具失败时返回 `{ ok: false, error: { code, message, hint } }`，`hint` 给出下一步。

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `PROJECT_NOT_FOUND` | 路径不存在或不是工程根目录 | 传入包含 `pubspec.yaml` 的目录 |
| `UNSUPPORTED_FRAMEWORK` / `UNSUPPORTED_COMBINATION` | 当前平台 × 框架不在自动接入范围 | 看返回里的 `supportLevel`：`delegate-official-skill` 会给出官方 Skill 安装命令，`guided` 会给出文档步骤 |
| `DIRTY_WORKTREE` | 计划要修改的文件有未提交改动，拒绝写入 | 先提交或 stash；确实要写入时传 `allowDirty: true`（CLI 为 `--allow-dirty`） |
| `CONFIRMATION_REQUIRED` | 写入工具缺少 `confirm: true` | 先看 plan 返回的 diff，确认后带 `confirm: true` 与 `expectedPlanHash` 再调用 |
| `PLAN_MISMATCH` | 计划生成后工程又被修改，哈希不一致 | 重新生成 plan 再确认 |
| `TOOLCHAIN_MISSING` | 缺少 Flutter / Xcode / Android SDK | 安装后重试；或接受该级验证为 `skipped` |
| `COMMAND_FAILED` | 外部命令或远程 API 返回失败 | 查看 `logTail` 与 `diagnosis` |
| `AUTH_REQUIRED` | 需要账号授权（如 AdMob 报表） | 由你本人获取令牌并设置 `ADMOB_ACCESS_TOKEN`，或改用后台导出的 CSV |
| `KNOWLEDGE_MISSING` | 找不到知识库 | 检查 `AD_MONETIZATION_KB` 或安装目录是否完整 |

## 2. 写入相关

- **想撤销接入**：每次写入前的原文件备份在 `.ai-ad-monetization/backups/<时间戳>/`，变更清单在 `.ai-ad-monetization/integration.json`。也可以直接 `git checkout -- .`。
- **重复执行 apply**：补丁是幂等的；已存在的配置会被跳过并在 plan 中标为 `skip`，不会重复插入。
- **main.dart 没被修改**：如果 `main()` 结构无法安全识别（例如在别的文件里启动、使用了 zone 包裹），工具不会硬改，而是在 `manualSteps` 中给出需要你手动添加的两行代码。也可以用 `--no-wire-main` 主动跳过。
- **生成的代码与已有广告代码冲突**：`analyze_project` 会报告 `existingAdCode`；已有 google_mobile_ads 接入时，plan 只补齐缺失部分，不覆盖你的业务代码。

## 3. 构建失败

| 现象（日志关键字） | 原因 | 处理 |
| --- | --- | --- |
| `uses-sdk:minSdkVersion` / manifest merger 失败 | Android minSdk 低于 24 | `android/app/build.gradle(.kts)` 中设为 24 以上（plan 会自动处理 `flutter.minSdkVersion` 低于 24 的情况） |
| `compileSdk` 相关错误 | compileSdk 低于 36 | 提升到 36 |
| pod install 报 deployment target | iOS 部署目标低于 13.0 | Podfile 中 `platform :ios, '13.0'` 或更高 |
| `CocoaPods not installed` / `pod: command not found` | 未安装 CocoaPods | `brew install cocoapods` 或 `sudo gem install cocoapods` |
| `version solving failed`（Dart SDK） | Flutter 版本低于 3.38.1 | `flutter upgrade` |
| `No such module 'google_mobile_ads'` | Pods 未安装或缓存损坏 | `cd ios && pod install --repo-update`，或 `flutter clean && flutter pub get` |
| Android 构建全部 `skipped` | 本机没有 JDK 或 Android SDK | 安装 Android Studio 后执行 `flutter doctor --android-licenses`；或接受 Android 构建未验证 |

| `sdkmanager` 下载长时间停住不动，但 `curl` 访问 dl.google.com 很快 | Java 优先走 IPv6，部分网络下连接挂起 | `export SDKMANAGER_OPTS="-Djava.net.preferIPv4Stack=true"` 后重试 |
| `flutter doctor` 提示 `cmdline-tools component is missing` | Homebrew 装的命令行工具不在 SDK 目录内 | `sdkmanager --sdk_root=<sdk> "cmdline-tools;latest"`，再 `flutter doctor --android-licenses` |
| Homebrew 装的 JDK 不被识别（`/usr/bin/java` 报找不到 Java Runtime） | macOS 的 `/usr/bin/java` 只是占位程序 | `flutter config --jdk-dir <JDK Home>`；`verify_ad_integration` 会读取该配置 |

`verify_ad_integration` 会对失败日志做关键字匹配并在 `diagnosis` 里给出上述建议，但这只是启发式判断，以完整日志为准。

## 4. 运行时问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Android 启动崩溃，提示 `The Google Mobile Ads SDK was initialized incorrectly` | Manifest 缺少 `com.google.android.gms.ads.APPLICATION_ID` | 重新运行 `validate_ad_config`，按 `ANDROID_APP_ID` 规则修复 |
| iOS 启动崩溃，`GADInvalidInitializationException` | Info.plist 缺少 `GADApplicationIdentifier` | 同上，看 `IOS_APP_ID` 规则 |
| 日志出现 `consent not granted yet, skipping MobileAds.initialize` | UMP 判定当前不能请求广告 | 正常现象（例如 EEA 用户未同意）。用户在隐私选项表单中同意后，调用 `AdsInitializer.instance.showPrivacyOptionsAndRetry()` 会重新初始化 |
| `canRequestAds()` 一直为 false | 没有在 AdMob 后台 **Privacy & messaging** 发布 GDPR / 美国州隐私消息 | 后台创建并发布消息（需要你本人登录账号操作） |
| `LoadAdError code 1`（INVALID_REQUEST） | 广告单元 ID 错误或平台不匹配 | 核对 `lib/ads/ad_unit_ids.dart` 中 Android / iOS 分别填写 |
| `LoadAdError code 3`（NO_FILL） | 新广告单元未生效或应用未审核 | 新单元等待数小时；开发期使用测试 ID |
| iOS 上 Banner 区域空白 | AdWidget 没有确定的宽高 | 使用生成的 `AnchoredBannerAd`，它已用固定尺寸容器包裹 |
| `This AdWidget is already in the Widget tree` | 同一个广告对象被两个 AdWidget 使用 | 每个广告实例只对应一个 Widget |
| Android 上横幅、插屏正常，激励视频一直加载失败（code 0），`adb logcat -s Ads` 里有 `asset.gvt1-cn.com ... blocked by CORS policy` | 网络环境问题：从中国大陆出口访问时，视频素材被分配到 `gvt1-cn.com` CDN，Android 广告 WebView 因缺少 CORS 头无法加载。同样的代码在 iOS 上可以正常加载 | 换到非中国大陆网络出口后重试。模拟器可以只让它自己走本机代理：`adb shell settings put global http_proxy 10.0.2.2:<端口>`，测完用 `adb shell settings put global http_proxy :0` 恢复。这不是接入代码的问题（验收时经代理复测 6/6 通过），也不影响面向海外用户的真实投放 |

加载失败时，生成的控制器会打印 `ai-ad-monetization: <format> failed to load ... code=... domain=... message=...`，并可通过 `lastLoadError` 读取最近一次错误。查看 SDK 自身日志：Android 用 `adb logcat -s Ads`，iOS 用 Xcode 控制台。

## 5. 上线前 `release` 校验失败

`validate_ad_config` 使用 `profile: "release"` 时，测试 App ID 和测试广告单元 ID 会被判为 `fail`。这是预期行为：上线前必须换成你在 AdMob 后台创建的真实 ID，并在真机上把自己的设备注册为测试设备后再验证，避免误点击导致账号受限。

## 6. 知识库过期

`npm run kb:check` 会检查每个知识文件的 `retrievedAt` 与 `reviewIntervalDays`，并对比 pub.dev 上 google_mobile_ads 的最新版本。工具返回的 `sources[].stale: true` 也表示该条资料需要复核。
