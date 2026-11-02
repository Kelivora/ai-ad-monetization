import { fileHeader, type TemplateOptions } from './options.js';

export function renderAnchoredBannerAd(opts: TemplateOptions): string {
  return `${fileHeader(opts)}

import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_unit_ids.dart';
import 'ads_initializer.dart';

/// Bottom-anchored adaptive banner (large anchored adaptive banner).
///
/// - Renders nothing (\`SizedBox.shrink\`) until loaded, so layout does not jump;
/// - Fails silently when initialization or ad loading fails (errors are
///   printed to the log and forwarded to [onAdFailedToLoad]);
/// - Releases ad resources when the State is disposed.
class AnchoredBannerAd extends StatefulWidget {
  const AnchoredBannerAd({super.key, this.adUnitId, this.onAdFailedToLoad});

  /// Overrides the ad unit ID (defaults to [AdUnitIds.banner]).
  final String? adUnitId;

  /// Called when the banner fails to load (for logging / retry UX).
  final void Function(LoadAdError error)? onAdFailedToLoad;

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
    // Read the width synchronously: never use context after an await.
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
          debugPrint(
            'ai-ad-monetization: banner failed to load: '
            'code=\${error.code} domain=\${error.domain} '
            'message=\${error.message}',
          );
          widget.onAdFailedToLoad?.call(error);
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

import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_unit_ids.dart';
import 'ads_initializer.dart';

/// Interstitial ad controller: preload + frequency cap (minimum show
/// interval) + automatic reload after the ad is closed.
///
/// \`\`\`dart
/// final InterstitialAdController interstitial = InterstitialAdController();
/// await interstitial.load();
/// if (await interstitial.showIfReady()) { /* shown */ }
/// interstitial.dispose(); // when the page is destroyed
/// \`\`\`
class InterstitialAdController {
  InterstitialAdController({
    this.adUnitId,
    this.minIntervalSeconds = ${opts.interstitialMinIntervalSeconds},
  });

  /// Overrides the ad unit ID (defaults to [AdUnitIds.interstitial]).
  final String? adUnitId;

  /// Minimum interval in seconds between two interstitial shows.
  final int minIntervalSeconds;

  static const int _maxRetries = 3;

  InterstitialAd? _ad;
  DateTime? _lastShownAt;
  bool _loading = false;
  bool _disposed = false;
  int _retryCount = 0;
  LoadAdError? _lastLoadError;

  /// Whether a loaded interstitial is ready to show.
  bool get isReady => _ad != null;

  /// The most recent load error (null after a successful load).
  LoadAdError? get lastLoadError => _lastLoadError;

  /// Preloads an interstitial (idempotent; no-op when loading or loaded).
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
          // The controller may have been disposed while loading.
          if (_disposed) {
            ad.dispose();
            return;
          }
          _retryCount = 0;
          _loading = false;
          _lastLoadError = null;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (Ad dismissedAd) {
              dismissedAd.dispose();
              _reload();
            },
            onAdFailedToShowFullScreenContent: (Ad ad, AdError error) {
              debugPrint(
                'ai-ad-monetization: interstitial failed to show: '
                'code=\${error.code} domain=\${error.domain} '
                'message=\${error.message}',
              );
              ad.dispose();
              _reload();
            },
          );
          _ad = ad;
        },
        onAdFailedToLoad: (LoadAdError error) {
          if (_disposed) return;
          _lastLoadError = error;
          debugPrint(
            'ai-ad-monetization: interstitial failed to load '
            '(attempt \${_retryCount + 1}): code=\${error.code} '
            'domain=\${error.domain} message=\${error.message}',
          );
          _loading = false;
          _retryWithBackoff();
        },
      ),
    );
  }

  /// Shows the interstitial when ready and outside the minimum interval;
  /// returns whether a show was actually started.
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
    if (_disposed) return;
    load();
  }

  /// Exponential backoff after load failures (2/4/8 s, at most
  /// [_maxRetries] times).
  Future<void> _retryWithBackoff() async {
    if (_disposed || _retryCount >= _maxRetries) return;
    _retryCount += 1;
    await Future<void>.delayed(Duration(seconds: 1 << _retryCount));
    if (_disposed) return;
    await load();
  }

  /// Releases ad resources; later load/show calls are no-ops.
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

/// Rewarded ad controller: preload, [isReady] state, reward callback, and
/// automatic reload after the ad is closed.
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

  /// Overrides the ad unit ID (defaults to [AdUnitIds.rewarded]).
  final String? adUnitId;

  static const int _maxRetries = 3;

  /// Whether a rewarded ad is ready (listen to update the "watch ad for
  /// reward" button availability).
  final ValueNotifier<bool> isReady = ValueNotifier<bool>(false);

  RewardedAd? _ad;
  bool _loading = false;
  bool _disposed = false;
  int _retryCount = 0;
  LoadAdError? _lastLoadError;

  /// The most recent load error (null after a successful load).
  LoadAdError? get lastLoadError => _lastLoadError;

  /// Preloads a rewarded ad (idempotent).
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
          // The controller may have been disposed while loading.
          if (_disposed) {
            ad.dispose();
            return;
          }
          _retryCount = 0;
          _loading = false;
          _lastLoadError = null;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (Ad dismissedAd) {
              dismissedAd.dispose();
              _reload();
            },
            onAdFailedToShowFullScreenContent: (Ad ad, AdError error) {
              debugPrint(
                'ai-ad-monetization: rewarded failed to show: '
                'code=\${error.code} domain=\${error.domain} '
                'message=\${error.message}',
              );
              ad.dispose();
              _reload();
            },
          );
          _ad = ad;
          isReady.value = true;
        },
        onAdFailedToLoad: (LoadAdError error) {
          if (_disposed) return;
          _lastLoadError = error;
          debugPrint(
            'ai-ad-monetization: rewarded failed to load '
            '(attempt \${_retryCount + 1}): code=\${error.code} '
            'domain=\${error.domain} message=\${error.message}',
          );
          _loading = false;
          _retryWithBackoff();
        },
      ),
    );
  }

  /// Shows the rewarded ad when ready; [onReward] fires each time the user
  /// earns a reward. Returns whether a show was actually started.
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
    if (_disposed) return;
    load();
  }

  /// Exponential backoff after load failures (2/4/8 s, at most
  /// [_maxRetries] times).
  Future<void> _retryWithBackoff() async {
    if (_disposed || _retryCount >= _maxRetries) return;
    _retryCount += 1;
    await Future<void>.delayed(Duration(seconds: 1 << _retryCount));
    if (_disposed) return;
    await load();
  }

  /// Releases ad resources; later load/show calls are no-ops.
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

// Barrel export: \`import 'ads/ads.dart';\`
${exports.join('\n')}
`;
}
