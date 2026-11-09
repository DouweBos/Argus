# Argus Web

The browser client for Argus. It ships as two builds of the same React app:

- **Network bundle** (`dist/`): served by the computer itself, on its LAN
  address or through its tunnel. You pair this browser like any other device;
  being on the network grants nothing.
- **Hosted app** (`dist-hosted/`, at `houwert.dev/argus/app/`): signs in with
  the Argus account, gets this browser approved by a device already on it, and
  opens any computer on the account through that computer's managed tunnel.

Both talk to the host's gateway over an end-to-end-encrypted Noise channel,
with whatever grants the computer gave this browser. With **control** it can
start sessions and agents, chat (send, queue, interrupt, stop, model,
permission mode, effort), answer permission prompts, review changes, and
watch and drive simulators; with **monitor** it watches and approves. It also
hosts huddle guests (`#/huddle/<token>` links).

The goal is parity with the iOS app and Argus for Mac (inbox, automations,
pull requests, files, terminals, usage and more), milestone by milestone.

## Using it

1. In Argus: **Settings → Remote Access** → enable, then turn on **Serve the
   web client on this network**. Argus shows a `http://<your-ip>:47615`
   address. That page is plain http, so only do this on a network you trust;
   the tunnel address always works without it.
2. Open that address in a browser on another device on the same network.
3. In Argus, **Start pairing** and paste the code into the web client (or open
   `<address>/#/pair/<code>`, which fills it in), then confirm the 6-digit code
   matches.

The client always dials the gateway on its own origin, so it works over the
LAN IP or a tunnel hostname without reconfiguration.

## Architecture

- **Wire types** come from `@argus/remote-protocol` as types only
  (`src/lib/protocol.ts`); `src/lib/request.ts` types every call's params and
  result from the catalog. Nothing is validated at runtime, so the network
  bundle ships no zod.
- **Shared logic** lives in `@argus/client-core` (`packages/client-core`), the
  TS counterpart of ArgusCore, shared with the desktop renderer: the route
  codec, `LoadPhase`, transient-error classification and transcript deltas.
- **Stores** (`src/stores/`) are one zustand store per domain, mirroring
  ArgusCore: `connection` (identity, transport, grants), `projects`,
  `agents`, `transcripts`, `prompts`, `git`, `files`, `devices`, `huddle`,
  `push`. `connection.ts` knows no domain store; `hostSync.ts` routes each
  host event to the store that owns it, resyncs after a reconnect and resets
  everything on a host switch.
- **Connection**: the transport pings over the Noise channel (`host.ping`)
  every 25 s and drops a socket that doesn't answer within 15 s, since
  browsers can't send WebSocket pings. Coming back to the tab or the network
  checks the socket at once. A reconnect refetches the transcripts, queues and
  statuses on screen. Background refreshes (polls, resumes) never report a
  failure that is only the connection being down; the connection badge
  already says so.
- **Routing** (`src/routing/`): real paths on the History API, the same ones
  as the Mac and iOS apps (`docs/routing.md` → Deep links → Web client).
  `?host=<id>` names the computer in the hosted app. Secrets stay in the
  fragment.

## Layout

Below 900px it is a single column: the screen the URL names. Back goes back
in the browser's history, or to the screen's parent when a link opened it.

At 900px and up (an iPad, or a desktop browser) it splits into two panes using
Peacock's `SplitShell`: the project list (or the project an agent belongs to)
on the left, the screen the URL names on the right. The divider drags and the
width is remembered.

With a hardware keyboard: `Cmd+[` / `Cmd+]` go back and forward, `Cmd+\`
toggles the sidebar, and `Cmd+K` focuses the composer.

## Build

```sh
pnpm --filter argus-web build          # network bundle → dist/
pnpm build:web-client:hosted           # hosted app → dist-hosted/, base /argus/app/
```

In dev, Argus serves `clients/argus-web/dist`; packaged builds ship it under
`resources/argus-web`. The gateway answers every unknown path with
`index.html`, so deep links and reloads work.

## Telemetry

Straight to PostHog with this browser's own install id, behind the same
consent as the iOS app: asked once, changeable under Settings → Privacy,
`presence` (one heartbeat per page load) by default. The catalog is
`src/telemetry/events.ts`, documented in `docs/telemetry-events.md` → Web
client. Builds without `VITE_POSTHOG_KEY` (or `POSTHOG_KEY`) send nothing.

## Hosted build (houwert.dev/argus/app)

houwert.dev ships it as a committed copy: run `pnpm sync:argus-app` there (it
builds this and copies `dist-hosted` into `public/argus/app/` with a manifest
of the Argus commit and file hashes), review, commit.

Two things houwert.dev has to provide, outside this repo:

- **A fallback to `index.html`** for every path under `/argus/app/`, so a
  deep link or a reload on `/argus/app/sessions/…` loads the app.
- **The PostHog host in its CSP**: `connect-src` must allow
  `https://eu.i.posthog.com` (or whatever `VITE_POSTHOG_HOST` names), or the
  browser blocks every event and nothing is sent.

Also:

- Sign-in is Clerk JS, loaded from the instance's frontend API at a pinned
  version with Subresource Integrity (`src/account/clerk.ts`; bump the version
  and hash together).
- The device's Ed25519 and X25519 keys are WebCrypto keys created
  non-extractable and kept in IndexedDB (`src/account/webKeys.ts`,
  `vault.ts`). Noise uses the X25519 key through `deriveBits`; the shared
  transport precomputes each DH it needs (`AsyncStaticKey`), so neither
  long-lived private key is ever in JavaScript memory (only per-connection
  ephemerals are).
- Joining follows the apps (`src/account/join.ts`): a request, the 6-digit
  code, adoption only of a log whose `add_device` carries the confirmed code,
  and a persisted request that survives a reload. A browser never writes
  genesis and never approves other devices.
- Only `wss://` routes are dialled (an https page can't open `ws://`), so a
  computer is reachable through its managed tunnel.
- `?host=<id>` opens that computer; one the account can't reach shows as
  unavailable and never falls back to another.
- No Web Push and no fonts from Google: the CSP (set by houwert.dev) allows
  scripts only from the site, the Clerk frontend API and Turnstile.
- The account code (and the zod schemas its log verification needs) is only
  in this build; the network bundle never loads it.

## Notes

- Crypto is `@noble/*` (pure TS), via `@argus/remote-client`, shared with the
  desktop, so they interoperate by construction.
- On the network bundle keys live in `localStorage` (no hardware-backed store
  in a browser). Each browser is its own revocable device; revoke it from
  Argus at any time.
- Camera QR scanning is omitted (browsers block the camera on plain-http LAN
  origins), so pairing is by pasted code or a `#/pair/` link.
