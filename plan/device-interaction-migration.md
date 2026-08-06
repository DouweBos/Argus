# Migrate device-interaction injection from Argus → conductor

Goal: Argus should _capture_ user gestures in its runtime views and _forward_ them
to conductor, which owns the actual injection. Today Argus injects directly for
iOS and Android. Web already delegates to conductor — that's the template.

## Current state (what exists in Argus)

### iOS simulator — Argus owns injection

- `native/argus-sim-bridge/` — standalone Swift/ObjC binary (`ArgusBridge.swift`,
  `ArgusHID.m`, `main.swift`) that injects **low-level HID** (touch / button /
  keyboard) via private CoreSimulator frameworks, JSON-over-stdio.
- `electron/services/simulator/bridge.ts` (`SimBridge`) — Node client for it.
- `electron/services/simulator/ios.ts` — `simulatorTouch`, `simulatorButton`,
  `simulatorKeyboard`.
- IPC: `simulator_touch`, `simulator_button`, `simulator_keyboard`
  (device-control tool-gated).
- ⚠️ The same binary/process ALSO does framebuffer capture — **input and capture
  are coupled** in one per-UDID process.

### Android emulator — Argus owns injection

- `electron/services/simulator/emulator-grpc-bridge.ts` — gRPC to the emulator.
- `electron/services/simulator/emulator-input.ts` — keycode translation
  (`ANDROID_TO_EVDEV`, AKEYCODE\_\* → evdev).
- `electron/services/simulator/android.ts` — `androidTouch`, `androidKeyboard`,
  `androidButton`. IPC: `android_touch`, `android_keyboard`, `android_button`.
- `android-bridge.ts` / `android-backend.ts` — TODO: audit for the scrcpy /
  physical-device input path (separate from the emulator gRPC one).

### Web — ALREADY delegated to conductor (reference implementation)

- `electron/services/browser/conductorInput.ts` — POSTs to conductor's web-server
  REST endpoints (`/tap`, `/pressKey`, `/swipe`, `/navigate`, …) on a per-browser
  reservation driver port. This is exactly the shape we want for iOS/Android.

### Frontend gesture capture (stays in Argus, thin)

- `IosSimulatorView` / `IosDeviceStreamView`, `AndroidDeviceView` /
  `AndroidDeviceStreamView`, `AppleTVRemote` (tvOS remote + hardware buttons),
  `CanvasStreamBody`. These translate pointer/keyboard events into normalized
  coords + keycodes and call the IPC above.
- Coordinate normalization (0..1) and keymaps currently live partly in the UI and
  partly in the services (evdev map, macOS virtual keycodes).

## Target architecture

Argus runtime views → capture gesture → forward to **conductor device-input API**
(same as web today). Conductor owns: HID/XCUITest/gRPC/adb injection, keycode
mapping, coordinate→device translation. Argus keeps only: gesture capture + a thin
transport client + (for now) video capture.

## Decisions (locked)

1. **Scope — input only.** Conductor takes over interaction injection; Argus keeps
   video capture. The iOS `argus-sim-bridge` stays for capture; its HID path is
   deleted once conductor reaches parity.
2. **Transport — streaming socket.** Conductor exposes a **persistent per-device
   input socket** (not per-event HTTP): Argus opens one connection per active
   device and streams pointer/key/button events through it, so continuous
   drags/scrolls and fast typing keep low latency + high event rate.
3. **Rollout — phased + capability fallback.** Each platform cuts over behind a
   capability flag; Argus falls back to the current native path when conductor
   can't handle it (or the socket is down). iOS first, then Android.

### Mechanism parity is the crux (P0/P1)

Argus HID injects at the **CoreSimulator** level — works on SpringBoard, needs no
app/XCUITest session, covers hardware buttons + the tvOS remote. Conductor iOS
input is XCUITest `_XCT_synthesizeEvent`, which needs a runner and may not cover
SpringBoard / hardware buttons / tvOS remote. So the likely parity path is to
**move the `ArgusHID.m` / `ArgusBridge.swift` CoreSimulator HID logic into
conductor** as its iOS-sim input backend, and have the new socket server drive it.
That's literally "move the responsibility over," not just re-point a call.

## Streaming-socket protocol (to design in P0)

- **Connection**: one socket per device, opened via conductor (WebSocket or raw
  Unix/TCP loopback socket; newline-delimited JSON frames, upgrade to binary only
  if event rate demands it).
- **Handshake**: conductor advertises a **capability set** per platform
  (touch, drag, multitouch, buttons[home/lock/volume/siri], keyboard, tvOS-remote,
  springboard-injection). Argus uses this to decide stream-vs-fallback per action.
- **Event frames** (Argus → conductor): `pointer` {id, phase:down|move|up, x, y}
  (normalized 0..1), `key` {code, mods, down}, `button` {name}, `scroll` {dx,dy},
  `tvremote` {button}. Conductor maps to the platform injection + owns keymaps and
  coord→device translation.
- **Backpressure/ordering**: sequential per pointer id; conductor coalesces
  move events under load. Ack only on error.

## Phases

- **P0 — audit + protocol** _(conductor + Argus, design only)_: enumerate
  conductor's current iOS/Android input surface and transport; confirm XCUITest
  coverage gaps (springboard, hardware buttons, tvOS remote, multitouch); finalize
  the socket protocol + capability schema above. Deliverable: protocol spec.
- **P1 — conductor iOS input backend + socket server**: port the CoreSimulator HID
  logic (from `argus-sim-bridge`) into conductor as the iOS-sim injector; stand up
  the per-device input socket that drives it; advertise capabilities.
- **P2 — Argus iOS cutover**: `conductorDeviceInput` streaming client (mirrors the
  web `conductorInput.ts` pattern but socket-based); wire `IosSimulatorView` /
  `IosDeviceStreamView` / `AppleTVRemote` to stream through it behind a capability
  flag, falling back to `simulator_touch/button/keyboard`. Prove parity: drag,
  multitouch, hardware buttons, tvOS remote, keyboard, SpringBoard.
- **P3 — Android cutover**: conductor socket injection for the emulator (audit
  `android-bridge`/`android-backend` for the physical/scrcpy path too); wire
  `AndroidDeviceView` / `AndroidDeviceStreamView`; move the AKEYCODE→evdev map into
  conductor; retire the gRPC input path behind the flag.
- **P4 — cleanup**: delete the `argus-sim-bridge` HID path (keep capture), remove
  Argus-side keymaps/coord logic now owned by conductor, update docs (CLAUDE.md
  sim-bridge description, `device-control` tool).

## Risks

- **Latency on continuous gestures** — mitigated by the streaming socket + move
  coalescing; validate against the current native feel before deleting fallback.
- **SpringBoard / hardware-button / tvOS-remote parity** — addressed by porting the
  CoreSimulator HID backend into conductor rather than relying on XCUITest.
- **Input↔capture coupling** in the iOS bridge — input-only scope means the bridge
  keeps running for capture; make sure removing its HID path doesn't disturb the
  capture loop.

## Follow-on: capture / live-stream migration (thin clients)

The endgame — "conductor owns device I/O, every app is a thin client" — needs the
**capture** half too, so a future lightweight device-viewer app (and a web client)
need no capture implementation. The current pipeline is already well-decoupled
(producer → transport → N consumers), just owned by Argus's main process:

- Producer: `argus-sim-bridge` VideoToolbox-encodes **H.264** and serves **Annex B
  over a TCP port**; Android via scrcpy-server. Same shape both platforms.
- Transport/fan-out: `electron/services/simulator/ios-video.ts` +
  `h264-parser.ts` (`H264AccessUnitParser`) + `videoForward.ts` (multi-consumer hub).
- Consumer: renderer decodes via **WebCodecs** to a canvas.

Migration mirrors the input socket exactly: conductor exposes a per-device
**stream WebSocket** (`stream-server`, daemon-owned, fan-out) emitting a `config`
(SPS/PPS/dims) + H.264 access units — the same contract Argus's decoder already
consumes. Port the SimulatorKit→VideoToolbox capture into conductor (like
`packages/ios-hid` for input). Then Argus, the lightweight viewer, and web are all
just `shared WebCodecs decoder + connect to conductor stream + connect to conductor
input socket`. In flight: conductor session `Device Video Stream` (design + iOS).
