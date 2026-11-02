---
topic: banner
framework: flutter
source: https://developers.google.com/admob/flutter/banner
retrievedAt: 2026-11-02
verifiedVersion: google_mobile_ads 9.2.0
---

# AdMob Flutter 横幅广告

## 尺寸 API

自适应横幅使用 `AdSize.getLargeAnchoredAdaptiveBannerAdSize(width)`。自 8.0.0 起 `getCurrentOrientationAnchoredAdaptiveBannerAdSize` 与 `getAnchoredAdaptiveBannerAdSize` 已废弃。

注意：iOS 上 `AdWidget` 必须放在指定宽高的容器里（如 `SizedBox`），否则不显示。

## 官方示例（anchored adaptive）

```dart
import 'dart:io';
import 'package:google_mobile_ads/google_mobile_ads.dart';

class AnchoredBannerPage extends StatefulWidget {
  @override
  State<AnchoredBannerPage> createState() => _AnchoredBannerPageState();
}

class _AnchoredBannerPageState extends State<AnchoredBannerPage> {
  BannerAd? _bannerAd;
  bool _isLoaded = false;

  // 测试 ID；发布前替换为自己的广告单元 ID
  final String adUnitId = Platform.isAndroid
      ? 'ca-app-pub-3940256099942544/9214589741'
      : 'ca-app-pub-3940256099942544/2435281174';

  @override
  void initState() {
    super.initState();
    loadAd();
  }

  Future<void> loadAd() async {
    final AnchoredAdaptiveBannerAdSize? size =
        await AdSize.getLargeAnchoredAdaptiveBannerAdSize(
      MediaQuery.of(context).size.width.truncate(),
    );
    if (size == null) return;

    _bannerAd = BannerAd(
      adUnitId: adUnitId,
      size: size,
      request: const AdRequest(),
      listener: BannerAdListener(
        onAdLoaded: (ad) => setState(() => _isLoaded = true),
        onAdFailedToLoad: (ad, err) {
          ad.dispose(); // 失败时必须 dispose
        },
      ),
    );
    await _bannerAd!.load();
  }

  @override
  Widget build(BuildContext context) {
    return _isLoaded && _bannerAd != null
        ? Align(
            alignment: Alignment.bottomCenter,
            child: SizedBox(
              width: _bannerAd!.size.width.toDouble(),
              height: _bannerAd!.size.height.toDouble(),
              child: AdWidget(ad: _bannerAd!),
            ),
          )
        : const SizedBox.shrink();
  }

  @override
  void dispose() {
    _bannerAd?.dispose(); // AdWidget 从树中移除后必须 dispose
    super.dispose();
  }
}
```

## 要点

- 每个 `Ad` 对象只能对应一个 `AdWidget`，否则抛 "This AdWidget is already in the Widget tree"。
- 广告不再使用时必须 `dispose`：Banner 在 `AdWidget` 移除后或 `onAdFailedToLoad` 中。
