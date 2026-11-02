# Flutter × AdMob: What the Integration Generates

Everything below is written by `generate_ad_integration` — not by hand. Use
this file to explain the output to the user.

## Files touched

| File | Action | Content |
| --- | --- | --- |
| `pubspec.yaml` | modify | Adds the `google_mobile_ads` dependency (version from knowledge base, never hardcoded by the agent). |
| `android/app/src/main/AndroidManifest.xml` | modify | Adds the AdMob App ID `<meta-data>` (test ID by default). Existing real App ID → action `skip`, never overwritten. |
| `ios/Runner/Info.plist` | modify | Adds `GADApplicationIdentifier` (test ID by default) and SKAdNetwork IDs. |
| `lib/main.dart` | modify (guarded) | One import + one init call before `runApp(`, wrapped in `// ai-ad-monetization:begin` / `// ai-ad-monetization:end` markers. If no `runApp(` can be identified, this moves to `manualSteps`. |
| `lib/ads/*.dart` | create | See below. Only `lib/ads/` is ever created; user pages are not modified. |

## Generated files under `lib/ads/`

| File | Purpose |
| --- | --- |
| `ad_unit_ids.dart` | Returns ad unit IDs per platform; Google **test IDs** by default; exposes `usingTestIds`. |
| `ads_consent.dart` | UMP flow: `requestConsentInfoUpdate` → `loadAndShowConsentFormIfRequired`; exposes `canRequestAds`, `isPrivacyOptionsRequired`, `showPrivacyOptionsForm`. |
| `ads_initializer.dart` | Singleton: runs consent first, initializes the SDK only when `canRequestAds()` is true, only once; exposes `ready`. |
| `anchored_banner_ad.dart` | `AnchoredBannerAd` widget (large anchored adaptive size), disposes on failure/unmount. |
| `interstitial_ad_controller.dart` | Preload + `showIfReady()` with a minimum show interval (default 180 s), reload after close, dispose in callbacks. |
| `rewarded_ad_controller.dart` | Preload, `isReady`, `show(onReward)`, reload after close, dispose in callbacks. |
| `ads.dart` | Barrel export. |

Only the formats the user chose are generated; `ads_consent.dart` and
`ads_initializer.dart` are always generated. Android `minSdk` is raised to the
plugin requirement (24) if lower — this appears in the plan diff for consent.

## Ad unit IDs: test vs production

- Default: Google test ad units (publisher `ca-app-pub-3940256099942544`).
  `usesTestIds: true` in the plan.
- Production ad-unit IDs are injected at **build time**, never hardcoded:

```bash
flutter run --dart-define=ADMOB_ANDROID_BANNER_ID=ca-app-pub-XXXX/YYYY
flutter build apk \
  --dart-define=ADMOB_ANDROID_BANNER_ID=... \
  --dart-define=ADMOB_ANDROID_INTERSTITIAL_ID=... \
  --dart-define=ADMOB_ANDROID_REWARDED_ID=... \
  --dart-define=ADMOB_IOS_BANNER_ID=... \
  --dart-define=ADMOB_IOS_INTERSTITIAL_ID=... \
  --dart-define=ADMOB_IOS_REWARDED_ID=...
```

Variable naming rule: `ADMOB_{ANDROID|IOS}_{BANNER|INTERSTITIAL|REWARDED}_ID`.

- The **App ID** is different: it must live in `AndroidManifest.xml`
  (`com.google.android.gms.ads.APPLICATION_ID`) and `Info.plist`
  (`GADApplicationIdentifier`) — the plugin reads it from native config and
  dart-define does not apply. The generated config uses the test App ID; the
  user replaces it with their real one in those two files (a manual step; the
  tool will not overwrite a real App ID it finds).
- Shipping to stores with test IDs will show test ads and earn nothing — the
  release-profile validation flags it (`TEST_APP_ID`, `TEST_AD_UNIT`).

## Backups and idempotency

- Every apply backs up modified files to
  `.ai-ad-monetization/backups/<timestamp>/` and records metadata in
  `.ai-ad-monetization/integration.json`.
- Re-running the plan on an already-integrated project yields `skip` actions,
  not duplicates. Fragments inserted into user files stay between the
  `ai-ad-monetization` markers.

## Wiring banners/controllers into screens

`generate_ad_integration` does NOT touch user pages. Putting
`AnchoredBannerAd` into a screen or calling the controllers from a button is a
business-UI change: get consent first, insert minimally (see the
`ad-unit-planner` skill).
