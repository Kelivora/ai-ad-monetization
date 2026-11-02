# Placement Guidelines

## Banner

| Context | Banner type | Notes |
| --- | --- | --- |
| Scrollable feed/list/body | Inline adaptive | Sized to screen width, flows between content blocks; never sticky over scrolling content. |
| Fixed, non-scrolling screen | Large anchored adaptive | Top or bottom anchor; `getLargeAnchoredAdaptiveBannerAdSize` in the Flutter plugin (the old banner-size APIs are deprecated since 8.0.0). |
| During text input / checkout / onboarding | No banner | Accidental clicks and obscured content are policy risks. |

Banners must not overlay or obscure content or interactive controls.

## Interstitial

- **Natural break points only**: level completed and results closed, task
  finished, major tab/section transition after the user completed something.
- **Never**: at app launch, at app exit, while the user is typing, mid-game /
  mid-action, or immediately after another interstitial.
- **Frequency control**: minimum interval between shows (the generated
  `InterstitialAdController` defaults to 180 seconds) plus "not twice in a
  row". Do not lower the cap below policy-safe defaults to chase revenue.
- Preload, but show only when ready; if not ready, skip silently — never block
  the user flow waiting for an ad.

## Rewarded

- User-initiated only: an explicit "watch ad for X" entry point the user
  chooses.
- State the reward before the ad plays; grant it only on the reward callback.
- Good moments: revive/continue, bonus currency, unlock preview, remove-a-delay.
- Never gate core functionality behind a forced rewarded ad.

## AdMob policy references (official)

- Ad placement & content policy:
  https://support.google.com/admob/answer/6128543
- Interstitial ad guidance:
  https://support.google.com/admob/answer/6066980
- Rewarded: user opt-in and clear reward disclosure are required.

## Components the integration generates (MVP, admob × flutter)

| Component | Role |
| --- | --- |
| `AnchoredBannerAd` (anchored_banner_ad.dart) | Adaptive anchored banner widget with dispose on failure/unmount. |
| `InterstitialAdController` (interstitial_ad_controller.dart) | Preload, `showIfReady()`, min-interval gating, reload after close. |
| `RewardedAdController` (rewarded_ad_controller.dart) | Preload, `isReady`, `show(onReward)`, reload after close. |

Placing these into the user's screens is a **business-UI change**: get consent,
insert minimally at the agreed spots only.
