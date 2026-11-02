# Validation Rule Catalog (AdMob × Flutter)

Rule IDs returned by `validate_ad_config` → `data.findings[].ruleId`.
Statuses: `pass` / `warning` / `fail` / `na`. Profile column shows where the
strictest behavior applies.

## Dependency & toolchain (config)

| Rule | Meaning | Notes |
| --- | --- | --- |
| `ADMOB_PLUGIN_PRESENT` | `google_mobile_ads` present in `pubspec.yaml`. | Fail when integrating without it. |
| `ADMOB_PLUGIN_VERSION` | Plugin version within supported range (knowledge base). | Warning when unpinned/unknown. |
| `DART_SDK_CONSTRAINT` | Project Dart constraint meets plugin minimum (3.10.0+ at last verification). | Fail when below. |
| `ANDROID_MIN_SDK` | Android `minSdk` ≥ plugin requirement (24 at last verification). | Fail when below. |
| `IOS_DEPLOYMENT_TARGET` | iOS deployment target ≥ plugin requirement (13.0 at last verification). | Fail when below. |

Exact minimums come from `get_sdk_compatibility` / knowledge base — the
numbers here were verified against a specific plugin release and may change.

## App & ad-unit IDs (config / release)

| Rule | Meaning |
| --- | --- |
| `ANDROID_APP_ID` | AdMob App ID `<meta-data>` present in AndroidManifest and matches `ca-app-pub-…~…` format. |
| `IOS_APP_ID` | `GADApplicationIdentifier` present in Info.plist, correct format. |
| `APP_ID_PLATFORM_MISMATCH` | Android App ID used in iOS config or vice versa (IDs are per-platform). |
| `TEST_APP_ID` | App ID is Google's test publisher (`ca-app-pub-3940256099942544~…`). development: pass+hint; **release: fail**. |
| `TEST_AD_UNIT` | Ad unit IDs are test (`ca-app-pub-3940256099942544/…`). development: pass+hint; **release: fail**. |
| `AD_UNIT_FORMAT` | Ad unit IDs match `ca-app-pub-<pub>/<unit>` format. |

## Code correctness (code)

| Rule | Meaning |
| --- | --- |
| `SDK_INITIALIZED` | SDK init is wired at startup (main.dart marker block / `AdsInitializer`). |
| `CONSENT_FLOW` | UMP consent flow implemented before ad requests. |
| `CAN_REQUEST_ADS_GATE` | SDK init gated on `canRequestAds()` (UMP-aware init). |
| `PRIVACY_OPTIONS_ENTRY` | In-app privacy options entry exists (required for EEA). |
| `BANNER_DISPOSE` | Banner ad disposed on failure/unmount. |
| `FULLSCREEN_DISPOSE` | Interstitial/rewarded disposed in show/close callbacks. |
| `DEPRECATED_BANNER_SIZE_API` | Old banner-size API usage (deprecated since plugin 8.0.0; use adaptive sizes). |

## Compliance (compliance)

| Rule | Meaning |
| --- | --- |
| `CHILD_DIRECTED_TAG` | Child-directed treatment flag set — checked when the user declared `childDirected: true`; `na` otherwise. |
| `IOS_SKADNETWORK` | SKAdNetwork IDs present in Info.plist (warning when missing on iOS target). |
