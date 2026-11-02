# Troubleshooting: common build & runtime failures (AdMob × Flutter)

Match the log tail returned by `verify_ad_integration` (step details) against
these entries.

## Build failures

| Symptom (log tail) | Cause | Fix |
| --- | --- | --- |
| `uses-sdk:minSdkVersion X cannot be smaller than version 24` | Android `minSdk` below plugin requirement | Raise `minSdk` in `android/app/build.gradle` (the integrator can patch this — it appears in the plan). |
| `The iOS deployment target ... is set to X, but the range of podspecs ... requires 13.0` | iOS deployment target too low | Raise `platform :ios, '13.0'` in `Podfile` (integrator can patch). |
| CocoaPods out-of-date / `pod install` failures | Stale pods or CocoaPods version | `cd ios && pod repo update && pod install`; verify CocoaPods ≥ supported version. The plugin supports CocoaPods and SPM — pick one consistently. |
| Swift Package Manager resolution errors | Mixed SPM/CocoaPods or Xcode version | Ensure the Flutter/Xcode combination supports the plugin's SPM package; fall back to CocoaPods if unresolved. |
| Dart constraint: `sdk version constraints not satisfied` / pub solve failure | Project Dart SDK below plugin minimum (3.10.0+ at last verification) | Upgrade Flutter; check `environment.sdk` in `pubspec.yaml`. |
| Gradle sync: `google_mobile_ads` not found | Stale pub cache / gradle cache | `flutter clean`, delete `~/.gradle/caches` if needed, `flutter pub get`. |

## Runtime failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| App crashes on Android launch with `The Google Mobile Ads SDK was initialized incorrectly... App ID missing` | AdMob App ID `<meta-data>` missing/wrong in AndroidManifest | App ID must be present (test or real, `~` format). Re-run integrator plan or fix manifest. |
| iOS crash/no ads, `GADApplicationIdentifier` missing | Info.plist lacks App ID | Add `GADApplicationIdentifier` (integrator patches; verify not removed). |
| `NO_FILL` / no ad returned | Test device geo/limited inventory; new ad unit not yet serving; consent not granted in EEA | Usually transient for test IDs — retry; confirm consent state; check ad unit enabled in console. Not an integration bug by itself. |
| Banner renders blank/zero height | Size API misuse or parent constraints | Use adaptive sizes via the generated component; check the container gives it width. |
| Ads never load, logs show consent not available | UMP flow blocked or `canRequestAds()` false | Verify UMP message published for target geography; check debug geography setup. |
| `Deprecated API` warnings for banner sizes | Old banner-size API (deprecated since plugin 8.0.0) | Use the generated adaptive banner component (`DEPRECATED_BANNER_SIZE_API` rule). |

## When the fix belongs to the tool

If the fix means changing files the integration owns (manifest, plist,
pubspec, `lib/ads/`), re-run `generate_ad_integration` in plan mode rather
than editing by hand — manual edits bypass idempotency and backups.
