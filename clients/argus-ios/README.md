# Argus Remote (iOS)

Drive your Argus agents from an iPhone or iPad. Pairs with one or more
desktops over an end-to-end-encrypted channel (Noise IK); the home screen
lists the paired computers and the app talks to one at a time. The desktop
runs a local gateway exposed through a Cloudflare or Tailscale tunnel; the
tunnel only ever sees ciphertext.

Native Swift and SwiftUI. Replaced the Expo client, which is gone; this is the
only mobile client.

**Scope: whatever the desktop granted this device.** Every paired device can
monitor — projects, sessions, agents, transcripts, changes — and approve or
deny permission prompts. Devices granted **control** can also message agents,
spawn them, create/rename/delete sessions, manage the project root's branches,
switch model / permission mode / effort, commit/push/merge a session's work,
open and merge pull requests, author automations, and touch and type on
mirrored simulators. That boundary is enforced by the desktop gateway, not this UI.

## Layout

```
ArgusKit/             Swift package: crypto, transport, protocol, storage, pure logic.
                      Builds and tests on macOS with no simulator.
ArgusRemote/          The app — App/, DesignSystem/, Screens/, Stores/, Views/.
NotificationService/  Notification Service Extension: opens sealed pushes.
Tools/                Interop vector generators (run against the TypeScript source).
ArgusRemote.xcodeproj Checked in. Edit it in Xcode; there is no generator step.
```

Only `xcuserdata/` is ignored, so the shared `ArgusRemote` scheme travels with
the repo and CI doesn't depend on Xcode autocreating one.

## Build

```sh
open clients/argus-ios/ArgusRemote.xcodeproj
```

From the command line:

```sh
swift test --package-path ArgusKit   # the core, no simulator needed
xcodebuild -project ArgusRemote.xcodeproj -scheme ArgusRemote \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
```

## Interop is verified, not assumed

The crypto, wire protocol, media framing and several text formats must match
the desktop **byte for byte**. Rather than trusting a careful reading, the
fixtures in `ArgusKit/Tests/ArgusKitTests/Fixtures/` are generated from the
TypeScript implementations the desktop actually runs, and
the Swift port is asserted against them:

| Fixture | Generated from | Covers |
|---|---|---|
| `noise-vectors.json` | `packages/host/src/services/remote/noise.ts` | IK and IKpsk1 handshakes, transport frames, SAS, pairing PSK |
| `diff-sample.json` | `app/lib/diffParser.ts` | unified-diff parsing over a real four-status `git diff` |
| `linked-projects.json` | `app/lib/linkedProjectsPreamble.ts` | the message preamble, which is also a live instruction to the agent |
| `ArgusCore/…/Fixtures/conversation/*.json` | `app/stores/conversationStore.ts` + the host's `agents.transcript`, via `pnpm exec vitest run --config clients/argus-ios/Tools/conversation-fixtures.vitest.config.ts` | the agent transcript reducer's snapshot after every event, and the `RemoteMessage` pages built from it |

Regenerate the Noise vectors after any change to the shared crypto:

```sh
cd clients/argus-ios
../../node_modules/.bin/esbuild Tools/generate-noise-vectors.ts \
  --bundle --platform=node --format=esm --outfile=/tmp/gen.mjs
node /tmp/gen.mjs > ArgusKit/Tests/ArgusKitTests/Fixtures/noise-vectors.json
swift test --package-path ArgusKit
```

If those tests fail, the port has drifted and no phone will complete a
handshake. Fix the port, not the fixture.

## Pairing

1. On the desktop: **Settings → Remote Access**, pick a tunnel provider,
   enable remote access, then **Start pairing**.
2. In this app: **Pair a computer** → scan the QR (or paste the code).
3. Confirm the 6-digit code matches on both screens, then tap **Codes match —
   pair** on the desktop.

Each pairing keeps its own key and grant. Tapping one on the home screen
connects to it and drops the previous one's data.

## Security notes

- Pairing keys live in the Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`),
  behind an opportunistic biometric gate — a device with nothing enrolled is
  not locked out of its own agents.
- The anti-MITM anchor is the 32-byte pairing secret, which travels only in
  the QR code and never over the wire.
- Push notifications are sealed with AES-256-GCM for this device alone; the
  relay that carries them holds the Apple credentials but cannot read them.
  The Notification Service Extension reads the sealing key from the shared App
  Group, because an extension cannot see the app's Keychain items.
- Revoke a device from the desktop to cut it off cryptographically. Unpairing
  on the phone only drops the phone's copy of that computer's key.

## Known gaps

- **No UI tests.** `ArgusKit` is covered (46 tests); the views are not.
- **Never run against a real desktop.** The crypto, framing and text formats
  are verified against generated vectors, but no live pairing, transcript
  stream, push or device mirror has happened yet.
- **iPad is one stretched column.** `supportsTablet` is on, but there is no
  two-pane layout like the web client's.

Scoped out deliberately so far, and worth revisiting:

- No terminal or run-command surface, though the host exposes both.
- Changes can commit, push and merge into the base branch, but not stage
  per file, stash or resolve conflicts.
- Branch operations work only on a `project_root` session.
- Huddles and browser streams are not reachable from the phone.
- No file viewer: `sessions.files` lists paths, nothing returns contents.
- Lists are polled (4 s); only transcripts, prompts, agent status/queue/
  capabilities, device claims and notifications arrive as events.
