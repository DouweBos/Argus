# Argus Remote

Drive your Argus agents from a phone. Pairs with the desktop over an
end-to-end-encrypted channel (Noise IK). The desktop runs a local gateway
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
2. In this app: **Pair a device** → scan the QR (or paste the code if the
   camera is unavailable).
3. Confirm the 6-digit code matches on both screens, then tap **Codes match —
   pair** on the desktop.

## Security notes

- The device key lives in the Secure Enclave / Keystore (`expo-secure-store`)
  behind a biometric gate.
- Revoke a device from the desktop (**Settings → Remote Access**) to
  cryptographically cut it off immediately.

## Layout

```
app/                 Expo Router screens (projects, project, agent, changes,
                     devices, device, settings, pair)
modules/argus-video/ Local Expo module: native H.264 surface (iOS + Android)
src/crypto/          Noise IK + derivations (mirror of the desktop)
src/lib/             keystore, socket, transport, protocol, diff, activity,
                     images, notifications, storage
src/stores/          zustand app store
src/components/      RN component kit (transcript, tool calls, chat input, …)
```
