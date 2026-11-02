# Manual Steps (user-owned, AdMob console)

These cannot be done by the MCP server or the agent — the AdMob console,
UMP and store consoles require the account owner. Always list the relevant
ones in the final report.

## 1. Create the app in AdMob

- https://apps.admob.com → Apps → Add app. Choose platform (add the second
  platform as a separate app if targeting both Android and iOS).
- Note the **App ID** per platform (`ca-app-pub-…~…`, note the `~`). Put the
  real one into `AndroidManifest.xml` / `Info.plist` (App ID is NOT
  dart-define-able).

## 2. Create ad units

- Per app, per format the user is shipping: Banner, Interstitial, Rewarded.
- Note each **ad unit ID** (`ca-app-pub-…/…`, note the `/`). These ARE
  dart-define-able: `ADMOB_{ANDROID|IOS}_{BANNER|INTERSTITIAL|REWARDED}_ID`.
- Do not activate the ad units for production until ready to release; test
  traffic on test IDs is fine.

## 3. Configure UMP consent messages (privacy > consent)

- Privacy & messaging → Consent: create and **publish** a GDPR message for
  EEA/UK/CH traffic (required if any European users), and optionally a US
  states regulation message.
- Without a published GDPR message, EEA users get no consent form and ad
  requests will be limited/non-personalized.
- See the `ad-compliance-checker` skill for which markets require what.

## 4. app-ads.txt

- AdMob console: copy the `app-ads.txt` line; the user publishes it at their
  app website root (and for Android, the store listing domain must match).
  Recommended before launch to prevent revenue loss to spoofing.

## 5. Test devices

- If testing with real ad-unit IDs (not recommended pre-launch), register test
  devices in AdMob (Account → Settings → Test devices) to avoid invalid
  traffic. With Google test IDs, no registration needed.

## 6. Store privacy declarations (at release time)

- Google Play: Data safety section must declare advertising SDK data
  collection (device ID / diagnostics / ad interactions).
- App Store: App Privacy labels similarly. iOS with ATT: the tracking
  permission strings must match actual behavior.
- These are legal declarations made by the account owner — remind, don't fill
  in for them.

## 7. Payment & tax info (AdMob account)

- Payments profile, verification and tax info must be complete before AdMob
  pays out — often forgotten until first payout.
