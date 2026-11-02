# Privacy Requirements by Market

> Technical guidance for ad SDK integration, **not legal advice**. The
> authoritative sources are linked per section; the knowledge base
> (`get_platform_docs(topic: "privacy")`) carries the same content with
> retrieval dates.

## EEA / UK / Switzerland (GDPR)

- **UMP consent flow required** before ad requests: consent info update →
  load/show consent form if required → gate SDK init on `canRequestAds()`.
  The generated `ads_consent.dart` / `ads_initializer.dart` implement this;
  validation rules `CONSENT_FLOW` and `CAN_REQUEST_ADS_GATE` check it.
- **User action**: create and *publish* a GDPR message in AdMob → Privacy &
  messaging. Without a published message, EEA users see no form and requests
  are constrained.
- **Privacy options entry**: users must be able to change/withdraw consent
  in-app (`PRIVACY_OPTIONS_ENTRY` rule; `showPrivacyOptionsForm()` in the
  generated code). Link it from your settings screen — that insertion into
  the user's UI needs their consent.
- Official: https://support.google.com/admob/answer/10113244 (UMP overview)

## United States (state privacy laws)

- Multiple state laws (California CCPA/CPRA and others) apply to California
  and other state residents.
- Recommended: configure the **US state regulations message** in UMP (AdMob
  console). It is the same consent platform; no extra SDK work.
- Official: https://support.google.com/admob/answer/9700862

## Child-directed (COPPA, any market)

- Set the child-directed treatment flag on ad requests
  (`CHILD_DIRECTED_TAG` validation rule fires when the user declared
  `childDirected: true` but the tag is missing).
- Google Play **Families Policy** imposes additional limits (ad formats,
  data collection, SDK choice). The user must review:
  https://support.google.com/googleplay/android-developer/answer/9877356
- Self-declaring wrongly is a policy violation — if there is any doubt, the
  account owner decides, not the agent.

## iOS (ATT / SKAdNetwork)

- ATT prompt is **optional**, but accessing IDFA without user permission is
  not allowed: if the app (or its ad SDK) touches the advertising identifier,
  it must show the ATT prompt and declare `NSUserTrackingUsageDescription`
  in Info.plist.
- SKAdNetwork IDs for ad attribution should be present in Info.plist
  (`IOS_SKADNETWORK` rule; the integration patches Google's ID set).
- Official ATT: https://developer.apple.com/documentation/apptrackingtransparency

## All markets (user-owned declarations)

- **Google Play Data safety**: declare the advertising SDK's data collection
  (device identifiers, diagnostics, ad interactions).
- **App Store App Privacy**: equivalent labels for iOS.
- **app-ads.txt**: publish at the app's website root.
- These are account-owner legal declarations; the agent can list what the ad
  SDK collects (from knowledge base) but cannot submit them.

## Debugging consent

- To verify the UMP form locally, use the debug geography feature
  (`ConsentDebugSettings(debugGeography: EEA)` + registered test device) so
  the EEA form appears on a non-EEA device. Covered in the
  `ad-integration-tester` skill's runtime checklist.
