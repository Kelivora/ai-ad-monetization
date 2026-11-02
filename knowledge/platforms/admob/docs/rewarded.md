---
topic: rewarded
framework: flutter
source: https://developers.google.com/admob/flutter/rewarded
retrievedAt: 2026-11-02
verifiedVersion: google_mobile_ads 9.2.0
---

# AdMob Flutter 激励广告

激励广告必须由用户主动触发（用注意力/行为换取奖励）。`show` 时传入 `onUserEarnedReward` 回调。

## 官方示例

```dart
import 'package:google_mobile_ads/google_mobile_ads.dart';

class RewardedExample {
  RewardedAd? _rewardedAd;
  bool _isLoaded = false;

  // 测试 ID；发布前替换为自己的广告单元 ID
  final String adUnitId = Platform.isAndroid
      ? 'ca-app-pub-3940256099942544/5224354917'
      : 'ca-app-pub-3940256099942544/1712485313';

  Future<void> loadAd() async {
    await RewardedAd.load(
      adUnitId: adUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _rewardedAd = ad;
          _isLoaded = true;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (ad) {
              ad.dispose(); // 关闭后必须 dispose 并重新加载
              _loadAgain();
            },
            onAdFailedToShowFullScreenContent: (ad, err) {
              ad.dispose();
              _loadAgain();
            },
          );
        },
        onAdFailedToLoad: (err) {
          _isLoaded = false;
        },
      ),
    );
  }

  void show() {
    if (_isLoaded && _rewardedAd != null) {
      _rewardedAd!.show(
        onUserEarnedReward: (ad, reward) {
          // 发放奖励：reward.amount / reward.type
        },
      );
    }
  }
}
```

## 要点

- 每个实例只能 `show()` 一次；关闭或展示失败后 `dispose` 并重新加载。
- 奖励在 `onUserEarnedReward` 回调中发放。
