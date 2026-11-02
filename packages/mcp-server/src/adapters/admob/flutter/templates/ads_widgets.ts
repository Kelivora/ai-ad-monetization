import { fileHeader, type TemplateOptions } from './options.js';

export function renderAnchoredBannerAd(opts: TemplateOptions): string {
  return `${fileHeader(opts)}

import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_unit_ids.dart';
import 'ads_initializer.dart';

/// 底部锚定自适应横幅（large anchored adaptive banner）。
///
/// - 加载完成前不占位（\`SizedBox.shrink\`），避免布局跳动；
/// - 初始化失败或广告加载失败时静默降级；
/// - State 销毁时释放广告资源。
class AnchoredBannerAd extends StatefulWidget {
  const AnchoredBannerAd({super.key, this.adUnitId});

  /// 覆盖默认广告单元 ID（默认取 [AdUnitIds.banner]）。
  final String? adUnitId;

  @override
  State<AnchoredBannerAd> createState() => _AnchoredBannerAdState();
}

class _AnchoredBannerAdState extends State<AnchoredBannerAd> {
  BannerAd? _bannerAd;
  AnchoredAdaptiveBannerAdSize? _size;
  bool _loading = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_loading && _bannerAd == null) {
      _loadAd();
    }
  }

  Future<void> _loadAd() async {
    _loading = true;
    // 同步取宽度，避免 await 之后使用 context。
    final double width = MediaQuery.sizeOf(context).width;
    final bool initialized = await AdsInitializer.instance.initialize();
    if (!initialized || !mounted) {
      _loading = false;
      return;
    }
    final AnchoredAdaptiveBannerAdSize? size =
        await AdSize.getLargeAnchoredAdaptiveBannerAdSize(width.toInt());
    if (size == null || !mounted) {
      _loading = false;
      return;
    }
    final BannerAd ad = BannerAd(
      adUnitId: widget.adUnitId ?? AdUnitIds.banner,
      request: const AdRequest(),
      size: size,
      listener: BannerAdListener(
        onAdLoaded: (Ad loadedAd) {
          if (!mounted) {
            (loadedAd as BannerAd).dispose();
            return;
          }
          setState(() {
            _bannerAd = loadedAd as BannerAd;
            _size = size;
          });
        },
        onAdFailedToLoad: (Ad ad, LoadAdError error) {
          ad.dispose();
          if (mounted) {
            setState(() {
              _bannerAd = null;
              _size = null;
            });
          }
        },
      ),
    );
    await ad.load();
    _loading = false;
  }

  @override
  void dispose() {
    _bannerAd?.dispose();
    _bannerAd = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final BannerAd? ad = _bannerAd;
    final AnchoredAdaptiveBannerAdSize? size = _size;
    if (ad == null || size == null) {
      return const SizedBox.shrink();
    }
    return SafeArea(
      child: SizedBox(
        width: size.width.toDouble(),
        height: size.height.toDouble(),
        child: AdWidget(ad: ad),
      ),
    );
  }
}
`;
}

export function renderInterstitialAdController(opts: TemplateOptions): string {
  return `${fileHeader(opts)}

import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_unit_ids.dart';
import 'ads_initializer.dart';

/// 插屏广告控制器：预加载 + 频控（最小展示间隔）+ 关闭后自动重新加载。
///
/// \`\`\`dart
/// final InterstitialAdController interstitial = InterstitialAdController();
/// await interstitial.load();
/// if (await interstitial.showIfReady()) { /* 已展示 */ }
/// interstitial.dispose(); // 页面销毁时
/// \`\`\`
class InterstitialAdController {
  InterstitialAdController({
    this.adUnitId,
    this.minIntervalSeconds = ${opts.interstitialMinIntervalSeconds},
  });

  /// 覆盖默认广告单元 ID（默认取 [AdUnitIds.interstitial]）。
  final String? adUnitId;

  /// 两次插屏展示之间的最小间隔（秒）。
  final int minIntervalSeconds;

  static const int _maxRetries = 3;

  InterstitialAd? _ad;
  DateTime? _lastShownAt;
  bool _loading = false;
  bool _disposed = false;
  int _retryCount = 0;

  /// 是否有已加载、可展示的插屏。
  bool get isReady => _ad != null;

  /// 预加载插屏（幂等；重复调用在已有广告或加载中时直接返回）。
  Future<void> load() async {
    if (_disposed || _loading || _ad != null) return;
    _loading = true;
    final bool initialized = await AdsInitializer.instance.initialize();
    if (!initialized || _disposed) {
      _loading = false;
      return;
    }
    InterstitialAd.load(
      adUnitId: adUnitId ?? AdUnitIds.interstitial,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (InterstitialAd ad) {
          _retryCount = 0;
          _loading = false;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (Ad dismissedAd) {
              dismissedAd.dispose();
              _reload();
            },
            onAdFailedToShowFullScreenContent: (Ad ad, AdError error) {
              ad.dispose();
              _reload();
            },
          );
          _ad = ad;
        },
        onAdFailedToLoad: (LoadAdError error) {
          _loading = false;
          _retryWithBackoff();
        },
      ),
    );
  }

  /// 就绪且未超过最小间隔时展示插屏；返回是否真正发起了展示。
  Future<bool> showIfReady() async {
    final InterstitialAd? ad = _ad;
    if (ad == null) return false;
    final DateTime? lastShownAt = _lastShownAt;
    final DateTime now = DateTime.now();
    if (lastShownAt != null &&
        now.difference(lastShownAt).inSeconds < minIntervalSeconds) {
      return false;
    }
    _ad = null;
    _lastShownAt = now;
    await ad.show();
    return true;
  }

  void _reload() {
    _ad = null;
    load();
  }

  /// 加载失败后的指数退避重试（2/4/8 秒，最多 [_maxRetries] 次）。
  Future<void> _retryWithBackoff() async {
    if (_disposed || _retryCount >= _maxRetries) return;
    _retryCount += 1;
    await Future<void>.delayed(Duration(seconds: 1 << _retryCount));
    if (_disposed) return;
    await load();
  }

  /// 释放广告资源；之后的 load/show 调用都是 no-op。
  void dispose() {
    _disposed = true;
    _ad?.dispose();
    _ad = null;
  }
}
`;
}

export function renderRewardedAdController(opts: TemplateOptions): string {
  return `${fileHeader(opts)}

import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_unit_ids.dart';
import 'ads_initializer.dart';

/// 激励视频控制器：预加载、[isReady] 状态、发放奖励回调、关闭后自动重新加载。
///
/// \`\`\`dart
/// final RewardedAdController rewarded = RewardedAdController();
/// rewarded.isReady.addListener(() => print('ready: \${rewarded.isReady.value}'));
/// await rewarded.load();
/// final bool shown = await rewarded.show(
///   onReward: (RewardItem reward) => grantCoins(reward.amount),
/// );
/// \`\`\`
class RewardedAdController {
  RewardedAdController({this.adUnitId});

  /// 覆盖默认广告单元 ID（默认取 [AdUnitIds.rewarded]）。
  final String? adUnitId;

  static const int _maxRetries = 3;

  /// 广告就绪状态（监听它来更新"看视频领奖励"按钮的可用性）。
  final ValueNotifier<bool> isReady = ValueNotifier<bool>(false);

  RewardedAd? _ad;
  bool _loading = false;
  bool _disposed = false;
  int _retryCount = 0;

  /// 预加载激励视频（幂等）。
  Future<void> load() async {
    if (_disposed || _loading || _ad != null) return;
    _loading = true;
    final bool initialized = await AdsInitializer.instance.initialize();
    if (!initialized || _disposed) {
      _loading = false;
      return;
    }
    RewardedAd.load(
      adUnitId: adUnitId ?? AdUnitIds.rewarded,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (RewardedAd ad) {
          _retryCount = 0;
          _loading = false;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (Ad dismissedAd) {
              dismissedAd.dispose();
              _reload();
            },
            onAdFailedToShowFullScreenContent: (Ad ad, AdError error) {
              ad.dispose();
              _reload();
            },
          );
          _ad = ad;
          isReady.value = true;
        },
        onAdFailedToLoad: (LoadAdError error) {
          _loading = false;
          _retryWithBackoff();
        },
      ),
    );
  }

  /// 就绪时展示激励视频；[onReward] 在用户赚得奖励时回调（可能多次）。
  /// 返回是否真正发起了展示。
  Future<bool> show({required void Function(RewardItem reward) onReward}) async {
    final RewardedAd? ad = _ad;
    if (ad == null) return false;
    _ad = null;
    isReady.value = false;
    await ad.show(
      onUserEarnedReward: (AdWithoutView ad, RewardItem reward) => onReward(reward),
    );
    return true;
  }

  void _reload() {
    _ad = null;
    isReady.value = false;
    load();
  }

  /// 加载失败后的指数退避重试（2/4/8 秒，最多 [_maxRetries] 次）。
  Future<void> _retryWithBackoff() async {
    if (_disposed || _retryCount >= _maxRetries) return;
    _retryCount += 1;
    await Future<void>.delayed(Duration(seconds: 1 << _retryCount));
    if (_disposed) return;
    await load();
  }

  /// 释放广告资源；之后的 load/show 调用都是 no-op。
  void dispose() {
    _disposed = true;
    _ad?.dispose();
    _ad = null;
    isReady.value = false;
  }
}
`;
}

export function renderAdsBarrel(opts: TemplateOptions, formats: TemplateOptions['formats']): string {
  const exports = [
    "export 'ad_unit_ids.dart';",
    "export 'ads_consent.dart';",
    "export 'ads_initializer.dart';",
  ];
  if (formats.includes('banner')) exports.push("export 'anchored_banner_ad.dart';");
  if (formats.includes('interstitial')) exports.push("export 'interstitial_ad_controller.dart';");
  if (formats.includes('rewarded')) exports.push("export 'rewarded_ad_controller.dart';");
  return `${fileHeader(opts)}

// 统一导出：\`import 'ads/ads.dart';\`
${exports.join('\n')}
`;
}
