---
topic: testing
framework: flutter
source: https://developers.google.com/admob/flutter/test-ads
retrievedAt: 2026-11-02
verifiedVersion: google_mobile_ads 9.2.0
---

# AdMob Flutter 测试广告

## 测试 ID（官方，见 sdk 内 test-ids.json）

| 用途 | Android | iOS |
| --- | --- | --- |
| App ID | `ca-app-pub-3940256099942544~3347511713` | `ca-app-pub-3940256099942544~1458002511` |
| Banner（自适应） | `ca-app-pub-3940256099942544/9214589741` | `ca-app-pub-3940256099942544/2435281174` |
| 插屏 | `ca-app-pub-3940256099942544/1033173712` | `ca-app-pub-3940256099942544/4411468910` |
| 激励 | `ca-app-pub-3940256099942544/5224354917` | `ca-app-pub-3940256099942544/1712485313` |

## 要点

- 模拟器自动被视为测试设备。
- 真机需要注册测试设备：

```dart
MobileAds.instance.updateRequestConfiguration(
  RequestConfiguration(testDeviceIds: ['你的测试设备 ID']),
);
```

- Google 广告的测试广告带 **"Test Ad"** 标签；聚合（mediation）来的广告**不显示**该标签，不要以有无标签作为聚合测试的判断依据。
- 发布前必须替换为真实 ID，且不得点击真实广告。
