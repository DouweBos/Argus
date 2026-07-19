# HIDProbe

A tiny SwiftUI iOS app that logs the hardware inputs an app **can** observe, used
to identify which `argus-sim-bridge` HID keycodes map to which physical button.

## Build & run

```sh
./build.sh <SIMULATOR_UDID>   # build → install → launch on a booted sim
./build.sh                    # build only (produces build/HIDProbe.app)
```

No Xcode project — it compiles `HIDProbe.swift` straight into a simulator
`.app` with `swiftc` and installs via `simctl`.

## What it captures

| Input                               | Source                                                      | Works on simulator?                                  |
| ----------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Hardware keyboard keys              | `UIResponder.pressesBegan` (`UIKey.keyCode` + `characters`) | ✅ yes                                               |
| Volume Up / Down                    | `AVAudioSession.outputVolume` KVO (direction from delta)    | ❌ sim doesn't route volume HID to the audio session |
| Media remote (play/pause/next/prev) | `MPRemoteCommandCenter`                                     | ✅ when a button maps to a remote command            |

Home / Lock / Action Button can't be seen by an app at all — they background it
or are opaque to third-party code.

## Findings (iPhone 17 Pro, iOS 18 simulator)

- **Keyboard**: `argus-sim-bridge`'s `keyboard` command delivers correct
  characters — e.g. macOS VK 0 → `keyCode=4 chars="a"`, VK 15 → `keyCode=21
chars="r"` (UIKey reports HID usages). This double-confirms text entry.
- **Home**: `IndigoHIDMessageForButton(keyCode=1, target=51)` works (device goes
  to SpringBoard).
- **Volume / Action**: no keycode swept (1–12, 401) produced an observable
  change — the simulator doesn't surface volume via the audio session or a HUD,
  so these can't be verified here. Run this app on a **real device** (where
  `outputVolume` reflects the buttons) to nail the VolumeUp/VolumeDown keycodes.
