---
topic: init
framework: flutter
source: https://developers.google.com/admob/flutter/quick-start
retrievedAt: 2026-11-02
verifiedVersion: google_mobile_ads 9.2.0
---

# AdMob Flutter 初始化

> 官方文档摘录（quick-start）。插件 `google_mobile_ads` 9.2.0；要求 Flutter >= 3.38.1、Dart >= 3.10.0；只支持 Android 与 iOS（不支持 web/桌面）。

## 版本与原生依赖

- Android：minSdk 24、compileSdk 36；默认 `play-services-ads` 25.5.0；UMP `user-messaging-platform` 4.0.0。可选 Next-Gen SDK（`ads-mobile-sdk` 1.5.0）。
- iOS：部署目标 13.0；`Google-Mobile-Ads-SDK ~> 13.11`；UMP 3.1.0；支持 CocoaPods 与 SPM。

## App ID 配置（缺失会导致启动崩溃）

Android — `android/app/src/main/AndroidManifest.xml` 的 `<application>` 内：

```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-xxxxxxxxxxxxxxxx~yyyyyyyyyy"/>
```

iOS — `ios/Runner/Info.plist`：

```xml
<key>GADApplicationIdentifier</key>
<string>ca-app-pub-xxxxxxxxxxxxxxxx~yyyyyyyyyy</string>
```

## 安装与初始化

```yaml
# pubspec.yaml
dependencies:
  google_mobile_ads: ^9.2.0
```

```dart
import 'package:google_mobile_ads/google_mobile_ads.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await MobileAds.instance.initialize();
  // 完成或 30 秒超时；生产建议先走 UMP 同意流程，canRequestAds() 为真后再初始化
  runApp(MyApp());
}
```

`MobileAds.instance.initialize()` 返回一个 Future，完成或 30 秒超时。
