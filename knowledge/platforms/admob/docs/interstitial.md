---
topic: interstitial
framework: flutter
source: https://developers.google.com/admob/flutter/interstitial
retrievedAt: 2026-11-02
verifiedVersion: google_mobile_ads 9.2.0
---

# AdMob Flutter 插屏广告

全屏广告只能 `show()` 一次；展示后如需再次展示必须重新加载。

## 官方示例

```dart
import 'package:google_mobile_ads/google_mobile_ads.dart';

class InterstitialExample {
  InterstitialAd? _interstitialAd;
  bool _isLoaded = false;

  // 测试 ID；发布前替换为自己的广告单元 ID
  final String adUnitId = Platform.isAndroid
      ? 'ca-app-pub-3940256099942544/1033173712'
      : 'ca-app-pub-3940256099942544/4411468910';

  Future<void> loadAd() async {
    await InterstitialAd.load(
      adUnitId: adUnitId,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (ad) {
          _interstitialAd = ad;
          _isLoaded = true;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (ad) {
              ad.dispose(); // 关闭后必须 dispose 并重新加载
              _loadAgain();
            },
            onAdFailedToShowFullScreenContent: (ad, err) {
              ad.dispose(); // 展示失败也要 dispose
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
    if (_isLoaded && _interstitialAd != null) {
      _interstitialAd!.show(); // 每个 Ad 对象只能 show 一次
    }
  }
}
```

## 要点

- 只在自然断点（关卡结束、任务完成、内容切换）展示并做频控（编辑策略，见 common/placement-rules.json）。
- 关闭（`onAdDismissedFullScreenContent`）或展示失败（`onAdFailedToShowFullScreenContent`）后 `dispose` 并重新加载。
