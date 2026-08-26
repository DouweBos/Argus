# Argus Remote

Drive your Argus agents from a phone. Pairs with one or more desktops over an
end-to-end-encrypted channel (Noise IK); the home screen lists the paired
computers and the app talks to one at a time. The desktop runs a local gateway
exposed through a Cloudflare or Tailscale tunnel; the tunnel only ever sees
ciphertext.

**Scope: whatever the desktop granted this device.** Every paired device can
monitor — projects, sessions, agents, transcripts, changes — and approve or deny
permission prompts. Devices granted **control** can also message agents, spawn
them, create/rename/delete sessions, switch model / permission mode / effort,
and touch and type on mirrored simulators. That boundary is enforced by the
desktop gateway, not this UI.

Native iOS/Android. The crypto/transport/protocol modules under `src/lib` mirror
the desktop's byte-for-byte, so they interoperate by construction.

## Stack

Expo + Expo Router. Crypto is [`@noble/*`](https://github.com/paulmillr/noble-curves)
— pure TS, no native module. Device mirroring uses a local Expo module
(`modules/argus-video`) that renders H.264 with AVSampleBufferDisplayLayer on
iOS and MediaCodec on Android; frames are decrypted in JS and handed to the view
as typed arrays.

Peacock is DOM-only, so `src/components` holds the RN twins of the components
the web client uses (theme tokens in `src/theme.ts` mirror `tokens.css`).

## Run

```sh
cd clients/argus-remote
npm install            # not part of the pnpm workspace — install separately
npx expo run:ios       # or run:android — a dev client is required
```

The native video module means Expo Go can't run this app; use `expo run:*` (or
an EAS dev build) once, then `npx expo start --dev-client` day to day.

## Pairing

1. On the desktop: **Settings → Remote Access**, pick a tunnel provider
   (Cloudflare or Tailscale), enable remote access, then **Start pairing**.
2. In this app: **Pair a computer** → scan the QR (or paste the code if the
   camera is unavailable).
3. Confirm the 6-digit code matches on both screens, then tap **Codes match —
   pair** on the desktop.

Repeat for as many computers as you like. Each pairing keeps its own key and
grant; tapping one on the home screen connects to it and drops the previous
one's data. Tapping a notification switches to the computer that owns the agent
it came from.

## Security notes

- The device key lives in the Secure Enclave / Keystore (`expo-secure-store`)
  behind a biometric gate.
- Revoke a device from the desktop (**Settings → Remote Access**) to
  cryptographically cut it off immediately. Unpairing on the phone (home screen
  → **…** → **Unpair**) only drops the phone's copy of that computer's key.

## Layout

```
app/                 Expo Router screens (home, computer, projects, project,
                     agent, changes, devices, device, settings, pair)
modules/argus-video/ Local Expo module: native H.264 surface (iOS + Android)
src/crypto/          Noise IK + derivations (mirror of the desktop)
src/lib/             keystore (multi-pairing), socket, transport, protocol,
                     diff, activity, images, notifications, storage
src/stores/          zustand app store
src/components/      RN component kit (transcript, tool calls, chat input, …)
```
