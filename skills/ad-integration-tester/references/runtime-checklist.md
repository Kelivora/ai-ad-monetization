# Runtime Verification Checklist (manual)

Runtime level always returns `requires_manual_verification`. Give this list
to the user; record their confirmations as user-reported results.

## Setup

- Run on an emulator or device (Android and/or iOS per targets). Test IDs are
  in use by default — that is correct for this stage.
- Use `flutter run` with the default (test) IDs. Logs: `flutter run` console
  or `adb logcat` / Xcode console.

## Checklist

### 1. Test Ad badge visible

- Banner / interstitial / rewarded all render with a **"Test Ad"** label
  (banner: centered badge; fullscreen: "Test Ad" overlay).
- No ad → check log for load errors (`NO_FILL`, network) before suspecting
  integration; airplane-mode test (item 5) also exercises the failure path.

### 2. SDK initialization logged

- On startup, logs show the Mobile Ads SDK initialization completed
  (initialization starts only after the consent flow allows
  `canRequestAds()` — with no UMP message published and non-EEA geography it
  resolves immediately).

### 3. UMP consent form (EEA debug)

- Register the test device (or run on an emulator flagged in code) and use
  the EEA debug geography so the consent form shows even outside the EEA.
- Verify: form appears on first launch; options can be changed later via the
  in-app privacy options entry (`showPrivacyOptionsForm`); ads only load
  after consent state allows.

### 4. Rewarded flow

- Tap the rewarded entry point → ad plays → **reward callback fires** and the
  granted reward is applied in the app. Closing early must NOT grant the
  reward.

### 5. Failure path (airplane mode)

- Enable airplane mode, cold-start the app, open ad surfaces: ads fail
  gracefully (no crash, no stuck spinner), app remains usable; when back
  online, ads recover on next load.

### 6. Interstitial gating (if integrated)

- Interstitial shows only at the agreed natural break, respects the minimum
  interval, and never twice in a row.

## Recording results

Ask the user to confirm each item, then include in the final report:
"runtime: user-confirmed items 1,2,4,5; items 3,6 pending". Do not mark the
runtime level tool-verified — it is manual by design.
