# Argus Web (LAN client)

The browser client for monitoring Argus from another device on your network.
Argus serves this bundle over the LAN and the client pairs + connects over an
end-to-end-encrypted Noise channel — **being on the LAN grants no access; you
still pair like any other device.**

Monitor + approve only, same as the phone: view projects/sessions/agents and
approve/deny permission prompts; it can't spawn agents or run commands.

## How it's used

1. In Argus: **Settings → Remote Access** → enable, then turn on **Web client on
   this network**. Argus shows a `http://<your-ip>:47615` address.
2. On another device on the same Wi-Fi, open that address in a browser.
3. Back in Argus, **Start pairing**, copy the pairing code, paste it into the
   web client, and confirm the 6-digit code matches.

It always talks to the gateway on its own origin (whatever address you opened),
so it works over the LAN IP or a tunnel hostname without reconfiguration.

## Layout

Below 900px it is a single column: one screen at a time, backed by the browser
history stack so back and swipe-back work.

At 900px and up (an iPad in either orientation, or a desktop browser) it splits
into two panes — projects/sessions on the left, the agent, device, diff or
settings screen on the right — using Peacock's `SplitShell`. The divider drags
with a finger or a mouse and the width is remembered. Navigation is the same
stack underneath; the panes just show its topmost master and detail entries.

With a hardware keyboard: `Cmd+[` / `Cmd+]` go back and forward, `Cmd+\`
toggles the sidebar, and `Cmd+K` focuses the composer.

## Build

Argus serves `dist/`. Build it once (and after changes):

```sh
pnpm --filter argus-web build
```

In dev, Argus serves `clients/argus-web/dist`; packaged builds ship it under
`resources/argus-web`.

## Notes

- Crypto is `@noble/*` (pure TS); `src/crypto/noise.ts` is a byte-for-byte copy
  of the desktop's, so they interoperate by construction.
- Keys live in `localStorage` (no hardware-backed store in a browser). Each
  browser is its own revocable device; revoke it from Argus at any time.
- Camera QR scanning is intentionally omitted — browsers block the camera on
  plain-http LAN origins — so pairing is paste-only.
