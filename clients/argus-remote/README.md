# Argus Remote

Monitor and approve your Argus agents from a phone. Pairs with the desktop Argus
over an end-to-end-encrypted channel (Noise IK). The desktop runs a local
gateway exposed through a Cloudflare or Tailscale tunnel; the tunnel only ever
sees ciphertext.

**Scope (v1): monitor + approve only.** This client can view projects, sessions,
agents, and transcripts, and approve/deny permission prompts. It cannot spawn
agents, send messages, run terminals, or write files — that boundary is enforced
by the desktop gateway, not this UI.

Native iOS/Android only for now. The crypto/transport/protocol modules under
`src/` are platform-agnostic, so a future web client can reuse them.

## Stack

Expo (managed) + Expo Router. Crypto is
[`@noble/*`](https://github.com/paulmillr/noble-curves) — pure TS, no native
module — so `src/crypto/noise.ts` is a byte-for-byte copy of the desktop's
implementation and interoperates by construction.

## Run

```sh
cd clients/argus-remote
npm install            # not part of the pnpm workspace — install separately
npx expo start         # Expo Go / dev client on a device or simulator
```

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
app/                 Expo Router screens (pair, projects, project, agent, settings)
src/crypto/          Noise IK + derivations (mirror of the desktop)
src/lib/             keystore, socket, transport, pairingClient, protocol
src/stores/          zustand app store
src/components/      small RN UI primitives (Peacock is not reusable here)
```
