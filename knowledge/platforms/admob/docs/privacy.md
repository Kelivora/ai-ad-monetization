---
topic: privacy
framework: flutter
source: https://developers.google.com/admob/flutter/privacy
retrievedAt: 2026-11-02
verifiedVersion: google_mobile_ads 9.2.0
---

# AdMob Flutter 隐私与同意（UMP）

> 技术指引，不是法律建议。GDPR/US 消息本身需要在 AdMob 后台 Privacy & messaging 由用户手动创建（无 API）。

## 标准流程（每次启动）

1. `ConsentInformation.instance.requestConsentInfoUpdate(ConsentRequestParameters(), onSuccess, onFailure)`
2. `ConsentForm.loadAndShowConsentFormIfRequired(cb)`
3. 请求广告前检查 `ConsentInformation.instance.canRequestAds()`（在 `requestConsentInfoUpdate` 之前恒为 `false`）

## 官方示例

```dart
import 'package:google_mobile_ads/google_mobile_ads.dart';

Future<void> initConsent() async {
  final info = ConsentInformation.instance;

  await info.requestConsentInfoUpdate(
    const ConsentRequestParameters(),
    () async {
      await ConsentForm.loadAndShowConsentFormIfRequired((formError) {
        if (formError != null) {
          // 记录错误；不阻塞启动
        }
      });

      if (await info.canRequestAds()) {
        // 可以初始化 SDK 并请求广告
      }
    },
    (formError) {
      // 网络失败等：稍后可重试
    },
  );
}
```

## 隐私选项入口

`getPrivacyOptionsRequirementStatus() == PrivacyOptionsRequirementStatus.required` 时，应用必须提供入口：

```dart
if (await ConsentInformation.instance.getPrivacyOptionsRequirementStatus() ==
    PrivacyOptionsRequirementStatus.required) {
  // 展示一个"隐私选项"按钮，点击时：
  ConsentForm.showPrivacyOptionsForm((formError) {});
}
```

## 测试

```dart
final params = ConsentRequestParameters(
  consentDebugSettings: ConsentDebugSettings(
    debugGeography: DebugGeography.debugGeographyEea,
    testIdentifiers: ['你的设备广告 ID'],
  ),
);
ConsentInformation.instance.reset(); // 重置后可重新走流程
```

## 子女导向（COPPA）

```dart
MobileAds.instance.updateRequestConfiguration(
  RequestConfiguration(tagForChildDirectedTreatment: TagForChildDirectedTreatment.yes),
);
// 不足龄同意：tagForUnderAgeOfConsent: TagForUnderAgeOfConsent.yes
```
