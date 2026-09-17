# Argus hosts and clients — one desktop, three places the work can run

**Goal.** The Argus desktop gains a connection picker. Wherever the work actually
runs, the UI is identical:

1. **Local** — agents, worktrees and simulators on this Mac. Today's behaviour,
   unchanged.
2. **Headless host** — a Mac mini in the corner running Argus with no window, driving
   Claude and validating against its own simulators, 24/7. The laptop attaches and
   detaches; agents keep running in between.
3. **Peer host** — another Mac running the ordinary desktop app, serving this one.
   Workstation during the day, MacBook from the couch.

The load-bearing observation: **from the client's side, 2 and 3 are the same thing.**
A gateway connection to a host that granted it `admin`. The client cannot tell whether
the far end has a window, and must not care. So the picker has two entries — _This
Mac_ or a named paired host — and "mini or workstation" is just what you called it.

That collapses three features into two pieces of work: **one client transport**, and
**two packagings of one host**.

## 1. What already exists

Roughly half of this ships today:

- **A capability-gated RPC gateway** — `electron/services/remote/` (~3.3k lines):
  Noise `IK`/`IKpsk1` mutual auth over WebSocket, per-device static-key pinning,
  server-side per-method allowlist, SAS-confirmed pairing, device revocation. A prior
  audit found the crypto/auth core sound; its open findings are inlined in §5.1.
- **The desktop is already a host.** `remoteService.ts:178` starts that gateway behind
  the `remote_enabled` setting — it is what the phone and web clients connect to.
  **Case 3's server side needs no new code.**
- **A shared wire protocol** — `@argus/remote-protocol` (`messages.ts`, `models.ts`,
  `capabilities.ts`): zod-validated envelopes, event payloads, and the
  `REMOTE_METHODS` → capability map.
- **Two working remote clients** — `clients/argus-web` (Vite/React, served by the
  gateway itself) and `clients/argus-remote` (Expo). Both render agent transcripts,
  approve permission prompts, browse diffs, and decode live H.264 device video.
- **Off-network reach** — `tunnelManager.ts` spawns Cloudflare or Tailscale; LAN mode
  binds `0.0.0.0` and serves the web bundle.
- **A broadcast tap** — `electron/broadcast.ts` `addBroadcastTap()` mirrors every
  renderer event into the gateway's fan-out.
- **Relocatable state** — `ARGUS_HOME` (`electron/lib/argusHome.ts`) already moves
  worktrees, settings, device keys, and chat history off the default path.
- **One renderer chokepoint** — every command goes through `invoke()` at
  `app/lib/ipc.ts:85` and `send()` at `:99`. No component calls
  `window.argus.invoke()` directly.

That last point is why the client work is contained: swap what sits behind one
function and the whole UI is remote-capable.

## 2. The gap, measured

|                                  | today                                                                      | needed                                                      |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Commands reachable over the wire | **47** (`REMOTE_METHODS`)                                                  | all **325** `ipcMain.handle` registrations, minus host-only |
| Desktop renderer transport       | `window.argus.invoke()` → `ipcRenderer` only                               | must also speak the gateway                                 |
| Terminals over the wire          | none (`terminal:*` events go to `getMainWindow()` only, bypassing the tap) | full PTY streaming                                          |
| Device video to the desktop      | in-process `BrowserWindow.getAllWindows()` (`ios-video.ts:30`)             | the same H.264 stream the web client already gets           |
| Reconnect                        | local IPC never drops                                                      | snapshot + resubscribe + replay                             |
| Concurrent clients               | one desktop, one owner                                                     | two attached desktops must not race (case 3)                |
| Unattended operation             | requires a `BrowserWindow` and a logged-in human                           | headless, auto-start, survives nobody being there (case 2)  |

## 3. The client — built once, serves cases 2 and 3

```
        Argus desktop  (one app, two transports)
              │
     ┌────────┴────────┐
  local IPC        Noise/WS over LAN · Tailscale · Cloudflare
     │                 │
  in-process     ┌─────┴──────┐
     host    headless host   peer desktop host
             (Mac mini)      (workstation)
```

### 3.1 Admin is a passthrough, not a third hand-written allowlist

A command exists twice today: as `ipcMain.handle("start_agent", …)` in
`electron/ipc.ts`, and — if remotable — as a `"agents.spawn"` entry in
`REMOTE_METHODS` plus a handler in `capabilities.ts`. The obvious path, annotating all
325 commands with a tier and generating both tables from one registry, is the right
end state (§6, Phase 4) and is _weeks_ of mechanical work.

It is not what the client switch needs. An allowlist exists to constrain a phone. Your
own laptop driving your own host is a different threat model — that laptop is the same
trust level as sitting at the host's keyboard.

**Add an `admin` grant that dispatches raw IPC command names as a passthrough, guarded
by an explicit host-only denylist.**

```ts
// packages/remote-protocol/src/capabilities.ts
export const CAPABILITIES = ["monitor", "control", "admin"] as const;

/** Never crosses the wire, at any tier. These act on the machine the *window*
 *  is on, or mutate the trust store that authorises the wire itself. */
export const HOST_ONLY_COMMANDS = new Set([
  // window/dialog surface — meaningless on a headless host
  "show_open_dialog",
  "show_image_context_menu",
  "open_agent_popout",
  "close_agent_popout",
  "close_window",
  // act on the client's machine, not the host's — see §3.4
  "open_external_url",
  "open_path",
  "reveal_in_finder",
  "open_in_editor",
  "open_in_custom_editor",
  // the host updates itself; a client must not restart it under other clients
  "updater_check",
  "updater_download",
  "updater_quit_and_install",
  // pairing/revocation is the root of trust — console-only, never remote
  "remote_start_pairing",
  "remote_confirm_pairing",
  "remote_cancel_pairing",
  "remote_revoke_device",
  "remote_set_device_control",
  "remote_set_config",
]);
```

- `monitor` and `control` keep the existing strict `REMOTE_METHODS` allowlist,
  **unchanged**. Phone and web are unaffected and the original invariant ("reachable
  iff it is in the map") still holds for them.
- `admin` inverts to a denylist. A real, deliberate weakening — justified only because
  an `admin` grant is a console-confirmed SAS pairing against a specific device key,
  and revocable. Never grant it to a browser.
- One grep-able constant, with a test asserting every entry still exists in `ipc.ts`,
  so a rename cannot silently open a hole.
- `updater_get_state` stays remotable: reading the host's update status is useful,
  restarting it is not.

### 3.2 One event bus

`broadcastToRenderers()` already fans out to windows _and_ taps. Two paths bypass it,
and until they don't, the runtime panel is dead over the wire:

- `terminal/multiplexer.ts:397,467,474,959` sends `terminal:data:<id>` /
  `terminal:exit:<id>` straight to `getMainWindow()` — invisible to the gateway.
- `simulator/ios-video.ts:30` broadcasts frames via `BrowserWindow.getAllWindows()`.
  It should feed `videoForward.ts` only, which the gateway already consumes.

Subscriptions stay scoped: the gateway already does per-channel subscription for
`agent:*`; generalise to `{prefix, id}` across terminals, git watchers and device
streams, so a desktop watching four agents doesn't stream a fifth's tokens.

### 3.3 Terminals and video as binary channels

`gateway.ts` already frames `TAG_JSON` (0x00) vs `TAG_MEDIA` (0x01) inside the Noise
transport, with a `BACKPRESSURE_LIMIT` that drops delta frames when the socket backs
up. Add `TAG_PTY` (0x02) carrying `{terminalId, bytes}` under the same discipline —
xterm output is bursty and must never head-of-line-block the agent stream. Resize and
write travel as ordinary JSON commands.

Device video needs no new transport: in remote mode the desktop stops reading
`ios_video_frame` from IPC and runs the web client's `h264Decoder.ts` against the
gateway stream. That decoder moves into Peacock (or a shared `@argus/media`) so
desktop and web share one implementation — same rule as every other "rebuild in the
web client" case in `CLAUDE.md`.

### 3.4 The filesystem boundary is the sharp edge

The item most likely to be underestimated. Much of the UI silently assumes the repo is
on the same machine as the window:

| surface                                                                    | when remote                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `show_open_dialog` (picking a project root)                                | **blocking** — must become a host-side directory browser (`list_path`/`stat_file` already exist)             |
| `reveal_in_finder`, `open_path`, `open_in_editor`, `open_in_custom_editor` | host-only; disable, or re-target at the client                                                               |
| `open_external_url`                                                        | flip to a client-executed event — an OAuth link must open in _your_ browser (§5.2 makes this mandatory)      |
| drag-and-drop attachments (`webUtils.getPathForFile`)                      | the path is local to the client; must upload bytes. `agents.send` already carries base64 images — generalise |
| `read_file` / `write_file`                                                 | deliberately unreachable from the wire today. `admin` needs them; scope with `assertInsideSession` first     |
| `resolve_mention_path`                                                     | no path containment today (§5.1) — fix before it is host-side                                                |

Only the project picker genuinely blocks; the rest degrade gracefully if disabled. It
blocks hardest in **case 2**, where the host holds repos the client has never browsed
to. The honest answer for "open in editor" against a remote host is VS Code
Remote-SSH / Cursor SSH, or nothing — Argus should not sync worktrees back.

### 3.5 Reconnect and state reconciliation

Local IPC never disconnects; the gateway does — sleep, Wi-Fi switch, tunnel restart.
The desktop derives state into Zustand and assumes coherence. Remote mode needs an
explicit **snapshot-on-connect** (`state.hydrate` returning projects, sessions, agents,
terminals, devices in one payload), then resubscribe, then replay. The web client does
a narrow version already — generalise it, don't invent a second protocol.

Agents keep running while no client is attached, which is the entire point of case 2:
the mini chews through a refactor overnight, the laptop reattaches in the morning and
replays from `chatHistory`.

### 3.6 Where the switch lives in the UI

The URL is the single source of truth for _what you're looking at_; which host you're
attached to is not that — it is transport, and it must not deep-link someone into a
machine they can't reach. Keep it out of the route: a connection picker in the
sidebar/titlebar, persisted in app settings alongside the chosen host's device key.
Reconnect on launch; fall back to local with a visible banner.

Switching hosts tears down every subscription and re-hydrates — a full remount, not a
live swap.

## 4. The hosts — two packagings, one service layer

### 4.1 Case 3: peer desktop (no new code)

Flip on remote access, pair the other Mac as `admin`, done. Same binary both ends;
which is host and which is client is decided at pairing time, not at build time.

What it costs instead is **concurrency**, because a human is sitting at that host using
Argus while you're attached (§5.3). And it sleeps — fine for couch-from-desk, useless
overnight. That limitation is the entire reason case 2 exists.

### 4.2 Case 2: standalone headless server app

Ship a **separate `.app`**, not an `Argus.app --host` flag. The deciding constraint is
`app.requestSingleInstanceLock()` (`electron/main.ts:217`): it quits the second
instance outright, and the lock is keyed on the userData path derived from
appId/productName. Two distinct `.app`s get two distinct locks — which is what makes
running a server next to the desktop **on one machine** possible at all, and local
development of this whole feature depends on that.

One codebase, one `dist-electron` output, two electron-builder targets. The server
target overrides `appId: dev.houwert.argus.server` and `productName: Argus Server`,
drops the DMG, the menu icons and the window-related `extendInfo` strings, and keeps
`argus-sim-bridge`, `scrcpy-server.jar`, the prompts, and the `argus-web` bundle — the
server is what serves that. `scripts/electron-after-pack.cjs` runs for both.

**The server is fully standalone — its own everything:**

- its own `ARGUS_HOME` (default `~/.argus-server`), so its own worktrees, `tools.json`,
  device keys, chat history and settings. Never shares a worktree with a co-located
  desktop; two processes running git in one tree is not a thing to design for.
- its own gateway port, so a co-located desktop with `remote_enabled` doesn't collide.
- its own code signature, Login Item, and update channel — it updates independently of
  the client.

**Keep Electron on the server.** The instinct is to extract `electron/services/` into a
plain-Node `@argus/host`. The extraction is cheap — only **20 of 162** service files
import `electron`, and shallowly (`app.isPackaged`, `app.getVersion`, `safeStorage`,
`shell.openExternal/openPath/showItemInFolder`, `Notification.isSupported`,
`BrowserWindow.getAllWindows`) — but on macOS it buys nothing. **CoreSimulator requires
a logged-in Aqua session:** `simctl boot` fails under a launchd _daemon_ and needs a
launchd _agent_ inside a real user login. The mini must auto-login and stay awake
(`caffeinate`) regardless. Once you're in a GUI session, a windowless Electron process
costs nothing and gets the whole service layer working on day one with no extraction
risk. Reuse `electron/services/tray/` for the only UI it has.

### 4.3 Pairing to yourself

SAS confirmation assumes two devices and two screens. Same-machine development needs a
dev-only shortcut — a pre-seeded key pair or an `ARGUS_DEV_TRUST` env — that **must not
exist in release builds**, plus a pairing flow that tolerates `127.0.0.1`.

## 5. Cross-cutting hazards

### 5.1 Security preconditions (blocking, case 2 especially)

Four known weaknesses become blockers once a host is permanently reachable and
unattended. Re-verify each against current code first — these were true as of the
remote-control audit and parts may already be fixed:

- **Unattended `bypassPermissions`.** `RemotePermissionMode` includes `"trusted"`, and
  `agents.spawn` passes `permission_mode` straight to `startAgent`, where `trusted` ==
  `bypassPermissions` — the CLI then auto-runs every tool with no prompt forwarded to
  anyone. On a mini nobody is sitting at, that is silent RCE. Drop `"trusted"` from the
  remote enum; keep `bypassPermissions` host-only.
- **`permission.respond` sits in the default `monitor` tier.** A device paired without
  ticking "control" can approve any forwarded tool-use prompt — which in an agentic IDE
  is code execution. Move it behind `control`, or give it its own `approve` capability.
- **`repo_root` is client-supplied and unvalidated.** `createSession` never checks it
  against `appState.repoRoots`, so a device paired "to watch one project" can read and
  drive every project — and `sessions.create` against an attacker-influenced repo runs
  that repo's `.argus.json` setup pipeline. Allowlist against `collectAllProjects()`,
  optionally with per-device `allowedRepoRoots`.
- **`resolve_mention_path` has no path containment.** It expands `~/` and takes a
  leading `/` verbatim with no `assertInsideSession`, so `{query:"~/.ssh/"}` returns a
  directory listing. Filenames, not bytes — but confine it to the session worktree plus
  registered project roots before it is host-side.

Two more matter for an always-on host without blocking the switch: the web client
persists its device private key extractably in `localStorage`, and LAN mode serves the
bundle and `ws://` as plaintext on `0.0.0.0`, so a LAN MITM can inject same-origin JS
and steal that key. Prefer Tailscale; treat raw-LAN as opt-in with a warning.

### 5.2 Credentials live on the host

Claude accounts become host state (`claudeAuth/accounts.ts`), and
`claude_auth_login_start` must drive an OAuth flow whose browser opens on the
**client** — the concrete reason `open_external_url` has to become a client-executed
event rather than simply being disabled. Per-device "which Claude account may I spawn
under" is the natural extension of the grant model.

### 5.3 Two attached clients (blocking for case 3, likely for case 2)

`outstandingPermissions` is per-connection (`gateway.ts:138`), and responding clears
only the responder's own set (`capabilities.ts:961`). With two desktops attached — or a
desktop attached to a peer host someone is actively using — both see the prompt, both
can answer, and the loser's UI keeps showing one that's already resolved. Needs a
broadcast "this prompt is settled" event. Same class of problem for the message queue,
and for two clients typing into one PTY.

Simulator interaction is single-consumer in practice: both clients can watch the H.264
stream, but both injecting HID events into one simulator is nonsense. Needs a soft
"who has the device" claim.

## 6. What does _not_ change

Worth stating, because it bounds the blast radius:

- Worktree layout (`~/.argus/worktrees/{Repo}-argus-worktrees/{branch}/`) and
  `.argus.json` setup pipelines — identical, just on the host's disk.
- Peacock, the desktop UI, routing (`app/lib/router.tsx`), and the stores. The
  transport swap happens entirely behind `app/lib/ipc.ts`.
- The Noise handshake, pairing, SAS, device store, tunnel manager.
- `REMOTE_METHODS` and the `monitor`/`control` tiers — phone and web are untouched.
- `@argus/remote-protocol` stays the one schema both sides compile against.

## 7. Workstreams

Not phases — all of this is in scope. But some of it is only testable once something
else exists, so the dependency edges are marked. Everything else can proceed in
parallel.

**A. Security preconditions** (§5.1) — the four items. Independent of everything;
blocking only in the sense that no host should be permanently reachable until they
land.

**B. Protocol + admin tier** (§3.1) — `admin` capability, passthrough dispatch,
host-only denylist, denylist-vs-`ipc.ts` test. _Everything on the wire depends on
this._

**C. Client transport** (§3.5, §3.6) — transport switch behind `app/lib/ipc.ts`,
connection picker, `state.hydrate`, reconnect, host-side project picker (§3.4).
_Depends on B._ At this point case 3 works against any second Mac with
`remote_enabled` ticked — no packaging needed.

**D. Event bus + runtime panel** (§3.2, §3.3) — fix the `getMainWindow()` and
`getAllWindows()` leaks, add `TAG_PTY`, move the H.264 decoder into Peacock. _Depends
on B for the wire format; testable only with C._

**E. Server app** (§4.2) — second electron-builder target, `appId`, separate
`ARGUS_HOME`/port/worktrees, launchd _agent_, auto-login, `caffeinate`, tray.
Packaging work, independent of A–D. Dev-loopback pairing (§4.3) is a prerequisite for
comfortably developing C and D on one machine, so it lands early.

**F. Concurrency** (§5.3) — permission-prompt resolution broadcast, queue arbitration,
device claim. _Depends on C_ (needs two real clients to exercise).

**G. Filesystem boundary** (§3.4) — client-executed `open_external_url`, attachment
upload, scoped `read_file`/`write_file`. _Depends on B._

**H. Command registry** (§3.1 end state) — collapse `ipc.ts` + `capabilities.ts` into
`defineCommand(name, {tier, params, handler})`, annotate all 325 commands, retire the
`admin` denylist. _Do after C proves the shape_ — annotating 325 commands against a
design that then changes is the one genuinely wasteful ordering.

**I. Core extraction** — `@argus/host` as plain Node behind a `HostPlatform` interface
(`openExternal`, `secretStorage`, `appVersion`, `notify`, `revealInFinder`). Unlocks
Linux hosts for Android-only work, faster service tests, an `argus-cli`.

**J. Multi-host** — several hosts attached at once (mini for iOS, Linux box for
Android/backend) rather than one at a time. The project list becomes host-scoped.
Worth designing the route shape for during C.

## 8. Decided

- **The desktop keeps local mode.** Case 1 continues to run agents in the Electron
  main process with no server involved. Two transports to test, but no regression risk
  to how Argus works today, and case 1 never depends on the server app shipping.
- **Single-tenant, many devices.** One person's Claude accounts and projects, several
  paired devices. This is what licenses the `admin` passthrough in §3.1 — a shared
  team host with per-user accounts, quotas and audit logs would invalidate it and
  force the full command registry up front.
- **The server app is fully standalone** — its own `ARGUS_HOME`, worktrees, gateway
  port, signature and update channel. It never shares a worktree with a co-located
  desktop.

## 9. Still open

1. ~~**Attachment/file transfer budget.**~~ Done: a chunked binary channel rides
   `TAG_XFER` (0x02) alongside `TAG_JSON` and `TAG_MEDIA`, with `transfer.*` control
   on the request/response layer. It runs both ways — uploads and session writes in,
   file reads out — pauses on backpressure instead of dropping (a shed chunk
   corrupts the file), stages then renames behind a length + SHA-256 check, and
   sweeps partials on abort or disconnect. The attachment cap is now 512 MiB,
   enforced host-side as bytes arrive. Local mode still passes paths and serialises
   nothing.
2. ~~**Does the embedded browser (`services/browser/`, CDP + MJPEG) follow?**~~ Done:
   its JPEG frames ride the same `TAG_MEDIA` channel as device video (`browser.watch`),
   input goes to the host over the admin passthrough, and it arbitrates through the
   same soft claim simulators use. Local mode still reads the MJPEG server.
3. ~~**What does the client show when the host goes away mid-agent?**~~ Decided:
   **read-only replay**. The host keeps its projects, sessions and last snapshot on
   screen with `hydrated: false` and an offline badge; writes fail fast with
   `HostUnavailableError` rather than hanging on the request timeout; other attached
   hosts are untouched. Case 3 is routine enough that the last transcript is the most
   useful thing to leave on screen.
