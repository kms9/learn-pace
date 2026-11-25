# Learn Pace Android workbench

The M1 workbench uses Expo 58, React Native 0.88.1 and Hermes on ARM64. It runs a DeepSeek Flash turn or a single ratio practice question. Application Host writes the private question to `learn-pace.db` and the UI renders the Domain's public card. On launch the Host restores the saved card. Submitting a choice saves the original label first, grades it against the saved answer, then updates Domain mastery and the review schedule.

## Android development build

Use Node 24, a JDK available to Gradle and the Android SDK. The device run used JDK 21, Android Platform 37.0, Build Tools 37.0.0, NDK 27.1.12297006 and CMake 3.22.1.

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @learn-pace/mobile android --device
```

The app accepts a gateway URL and API key under **DeepSeek settings**. The URL and nonsecret model settings live in SQLite. The key lives in SecureStore. **Test key** sends a short probe. For local development over a connected USB device you can also use:

```sh
node apps/mobile/scripts/provision-usb.mjs <adb-device-serial>
```

Enter its one-time pairing code in **DeepSeek settings** and tap **Import via USB**. The script reads the root `.env` locally and closes the loopback transfer after one import. The app reads the saved credential on each cold launch. Expo dotenv loading is disabled for the development scripts.

## Reproduce the device checks

1. Tap **SQLite status** and verify `wal`. Run **Test key**, then **Send** for a longer turn. Tap **Cancel** while text is appearing and verify `cancelled`.
2. Tap **Generate question**. Record the question ID and verify `question_presented` and `awaiting_input`. For a Dev Client using a USB Metro server, keep Metro running and retain the `adb reverse` mapping.
3. Run `adb -s <serial> shell am force-stop app.learnpace.m1` and reopen the app. Verify that SecureStore reports a saved key and the same question ID appears.
4. Answer the restored question. Verify that the SQLite answer count and graded count increase, the pending card closes, and the mastery and next-review fields update.

## Device results · 2026-11-24

Redmi K20 Pro Premium Edition, Android 11 (API 30), ADB `86ceabbf`, ARM64.

- **S1:** `learn-pace.db` reported `wal`. After `am force-stop`, a new app process opened the same database, read the key from SecureStore and completed an authenticated DeepSeek request.
- **S3:** A complete turn received 202 text deltas with a 9,635 ms first text latency. A separate turn received 21 deltas before ending as `cancelled`. The question turn ended as `question_presented` with zero public text deltas and a three-option public card.
- **S5:** The ID `9a5bb322-e711-4ce7-9e8e-1117a3961e96` persisted across the force-stop in `awaiting_input`. The same interaction moved to `graded` after answering. SQLite and the UI showed one saved answer, one correct assessment, 50% mastery, and next review at `2026-12-01T11:08:17.945Z`. The Release build also opened the saved progress with Metro disconnected.

### NFR-09 baseline

| ARM64 APK | Size | Cold first display | Median |
| --- | ---: | --- | ---: |
| Debug Dev Client | 65,027,118 bytes (62.01 MiB) | 1,387 / 1,394 / 1,403 ms | 1,394 ms |
| Release APK | 24,445,413 bytes (23.31 MiB) | 214 / 199 / 218 ms | 214 ms |

Each sample force-stopped the app, waited two seconds, then used `adb shell am start -W` and recorded `TotalTime` for `MainActivity` with `LaunchState: COLD`. Debug opened the project via its USB Metro URL. From launch to the Debug workbench's data-ready marker the median was 3,514 ms (3,518 / 3,514 / 3,475 ms). Release used its embedded Hermes bundle and the local debug signature for device installation.

The [Android patch notes](../../patches/README.md) record the single 24-line Pi AI patch and the Cherry changes evaluated for this path. Expo and the selected Expo modules, React, React Native, Pi AI, Pi Durable, Chord and Pi Schema declare MIT licenses in their installed package manifests.
