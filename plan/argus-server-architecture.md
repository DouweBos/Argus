# Argus Server — headless host on a Mac mini, desktop as the client

**Goal, stated narrowly:** the Argus desktop app gains a switch — _run everything
locally_ (today's behaviour) or _drive a headless Argus running on a Mac mini_. The
mini runs the agents, owns the worktrees, boots the simulators, and validates changes
against them; the laptop is a window onto that. Nothing about the UI changes.

Everything below is scoped to that switch. The broader "split Argus into a host and
many shells" framing is still the eventual destination, but it is not what this plan
asks for and not what it costs.

## 1. What already exists

This is not a greenfield project. Roughly half the server already ships:

- **A capability-gated RPC gateway** — `electron/services/remote/` (~3.3k lines):
  Noise `IK`/`IKpsk1` mutual auth over WebSocket, per-device static-key pinning,
  server-side per-method allowlist, SAS-confirmed pairing, device revocation.
  `plan/security-audit-remote-control.md` found the crypto/auth core sound.
- **A shared wire protocol** — `@argus/remote-protocol` (`messages.ts`, `models.ts`,
  `capabilities.ts`): zod-validated request/response envelopes, event payloads, and
  the `REMOTE_METHODS` → capability map.
- **Two working remote clients** — `clients/argus-web` (Vite/React, served by the
  gateway itself) and `clients/argus-remote` (Expo). Both already render agent
  transcripts, approve permission prompts, browse diffs, and decode live H.264
  device video.
- **Off-network reach** — `tunnelManager.ts` spawns Cloudflare or Tailscale; LAN mode
  binds `0.0.0.0` and serves the web bundle.
- **A broadcast tap** — `electron/broadcast.ts` `addBroadcastTap()` already mirrors
  every renderer event into the gateway's event fan-out.
- **Relocatable state** — `ARGUS_HOME` (`electron/lib/argusHome.ts`) already moves
  worktrees, settings, device keys, and chat history off the default path.
- **One renderer chokepoint** — every command in the app goes through
  `invoke()` at `app/lib/ipc.ts:85` and `send()` at `:99`. There is no component
  anywhere calling `window.argus.invoke()` directly.

That last point is the one that makes this plan small.

## 2. The gap, measured

|                                  | today                                                                      | needed for the switch                                       |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Commands reachable over the wire | **47** (`REMOTE_METHODS`)                                                  | all **325** `ipcMain.handle` registrations, minus host-only |
| Host process                     | Electron main, requires a `BrowserWindow`                                  | must run unattended                                         |
| Desktop renderer transport       | `window.argus.invoke()` → `ipcRenderer` only                               | must also speak the gateway                                 |
| Terminals over the wire          | none (`terminal:*` events go to `getMainWindow()` only, bypassing the tap) | full PTY streaming                                          |
| Device video to desktop          | in-process `BrowserWindow.getAllWindows()` (`ios-video.ts:30`)             | same H.264 stream the web client already gets               |
| Reconnect                        | local IPC never drops                                                      | snapshot + resubscribe + replay                             |

## 3. Recommended shape

```
┌──────────────── Mac mini (logged-in user session) ────────────────┐
│  Argus.app --host   (no window, tray only)                        │
│    state.ts · services/*  (agents, git/worktrees, pty, simctl,    │
│                            adb, conductor, mcp, llm runners)      │
│    gateway (Noise + pairing + tunnel)  ── unchanged ──            │
└──────────────────────────┬────────────────────────────────────────┘
                           │  Noise over WS (LAN / Tailscale / CF)
        ┌──────────────────┼──────────────────┐
   Argus desktop      argus-web          argus-remote
   (laptop, admin)    (browser)          (iOS/Android)
```

The desktop keeps its full UI and gains a second transport:

- **local mode** (default, unchanged) — embeds the host in the Electron main process,
  dispatches through `ipcMain`. Users who don't want a server see nothing new.
- **server mode** — the same command names travel over the gateway as a paired device
  holding an `admin` grant.

### 3.1 Keep Electron on the server

The instinct is to extract `electron/services/` into a plain-Node `@argus/host`
package. The extraction is cheap — only **20 of 162** service files import `electron`
at all, and shallowly (`app.isPackaged`, `app.getVersion`, `safeStorage`,
`shell.openExternal/openPath/showItemInFolder`, `Notification.isSupported`,
`BrowserWindow.getAllWindows`) — but on macOS it buys almost nothing.

**CoreSimulator requires a logged-in Aqua session.** `simctl boot` fails under a
launchd _daemon_ and needs a launchd _agent_ inside a real user login. The mini must
auto-login and stay awake (`caffeinate`) regardless. Once you're in a GUI session,
a windowless Electron process costs nothing and gets the entire service layer working
on day one with no extraction risk.

**Ship the server as `Argus.app --host`**, reusing `electron/services/tray/`. Defer
`@argus/host` until tests/CI/Linux-Android hosts motivate it.

## 4. The decisions that actually matter

### 4.1 Admin is a passthrough, not a third hand-written allowlist

Today a command exists twice: as `ipcMain.handle("start_agent", …)` in
`electron/ipc.ts` and, if remotable, as a `"agents.spawn"` entry in `REMOTE_METHODS`
plus a handler in `capabilities.ts`. The obvious path — annotate all 325 commands with
a tier and generate both tables from one registry — is the right long-term refactor
and is _weeks_ of mechanical work.

It is also not what the desktop-as-client switch needs. An allowlist exists to
constrain a phone. Your own laptop driving your own mini is a different threat model:
the laptop is the same trust level as sitting at the mini's keyboard.

**So: add an `admin` grant that dispatches raw IPC command names as a passthrough,
guarded by an explicit host-only denylist.**

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
  // act on the client's machine, not the server's — see §4.4
  "open_external_url",
  "open_path",
  "reveal_in_finder",
  "open_in_editor",
  "open_in_custom_editor",
  // the server updates itself; a client must not restart it out from under others
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

Properties worth being explicit about:

- `monitor` and `control` keep the existing strict `REMOTE_METHODS` allowlist,
  **unchanged**. The phone and web clients are unaffected, and the security audit's
  invariant ("a method is reachable iff it is in the map") still holds for them.
- `admin` inverts to a denylist. That is a real, deliberate weakening — justified only
  because an `admin` grant is a console-confirmed SAS pairing with a specific device
  key, and revocable. Never grant it to a browser.
- The denylist is one grep-able constant with a test asserting every entry still
  exists in `ipc.ts` (so a rename can't silently open a hole).
- `updater_get_state` stays remotable — reading the server's update status is useful;
  triggering a restart is not.

The full `defineCommand` registry from §6 Phase 4 remains the right end state. This
gets the switch working without paying for it up front.

### 4.2 One event bus

`broadcastToRenderers()` already fans out to windows _and_ taps. Two paths bypass it
and must be fixed, or server mode has a dead runtime panel:

- `terminal/multiplexer.ts:397,467,474,959` sends `terminal:data:<id>` /
  `terminal:exit:<id>` straight to `getMainWindow()` — invisible to the gateway.
- `simulator/ios-video.ts:30` broadcasts frames via `BrowserWindow.getAllWindows()`.
  Should feed `videoForward.ts` only, which the gateway already consumes.

Subscriptions must stay scoped: the gateway already does per-channel subscription for
`agent:*`; generalise it to `{prefix, id}` across terminals, git watchers, and device
streams so a desktop watching four agents doesn't stream a fifth's tokens.

### 4.3 Terminals and video as binary channels

`gateway.ts` already frames `TAG_JSON` (0x00) vs `TAG_MEDIA` (0x01) inside the Noise
transport, with a `BACKPRESSURE_LIMIT` that drops delta frames when the socket backs
up. Add `TAG_PTY` (0x02) with a `{terminalId, bytes}` body and the same backpressure
discipline — xterm output is bursty and must never head-of-line-block the agent
stream. Resize/write travel as ordinary JSON commands.

Device video needs no new transport: in server mode the desktop stops reading
`ios_video_frame` from IPC and runs the web client's `h264Decoder.ts` against the
gateway stream. That decoder moves into Peacock (or a shared `@argus/media`) so
desktop and web share one implementation — same rule as every other "rebuild in the
web client" case in `CLAUDE.md`.

### 4.4 The filesystem boundary is the sharp edge

The item most likely to be underestimated. Much of the desktop UI silently assumes the
repo is on the same machine as the window:

| surface                                                                    | in server mode                                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `show_open_dialog` (picking a project root)                                | **blocking** — must become a server-side directory browser (`list_path`/`stat_file` already exist)       |
| `reveal_in_finder`, `open_path`, `open_in_editor`, `open_in_custom_editor` | host-only; disable in server mode, or re-target at the client (see below)                                |
| `open_external_url`                                                        | flip to a client-executed event — an OAuth link must open in _your_ browser, not the mini's              |
| drag-and-drop attachments (`webUtils.getPathForFile`)                      | path is local to the laptop; must upload bytes. `agents.send` already carries base64 images — generalise |
| `read_file` / `write_file`                                                 | the audit left these unreachable. `admin` needs them; scope with `assertInsideSession` first             |
| `resolve_mention_path`                                                     | audit finding **M2** — no path containment today. Fix before it is server-side                           |

Only the project picker genuinely blocks the switch; the rest degrade gracefully if
disabled. The honest answer for "open in editor" against a server host is VS Code
Remote-SSH / Cursor SSH into the mini, or nothing. Argus should not sync worktrees
back to the laptop.

### 4.5 Identity and credentials

A permanently-on, unattended host converts several audit findings into blockers:

- **H1** — drop `"trusted"`/`bypassPermissions` from `RemotePermissionMode`. Nobody is
  sitting at the mini to see a prompt.
- **M3** — `repo_root` is client-supplied and unvalidated. Allowlist it against
  `collectAllProjects()`.
- **M1** — `permission.respond` sits in the default `monitor` tier. On a server,
  approving a prompt is remote code execution on a machine nobody is watching.
- **M5/M6** — LAN mode serves the client bundle and `ws://` as plaintext on
  `0.0.0.0`. For an always-on server prefer Tailscale (already supported); treat
  raw-LAN as opt-in with a warning.

Claude credentials now live on the mini: `claudeAuth/accounts.ts` becomes server-side
state, and `claude_auth_login_start` must drive an OAuth flow whose browser opens on
the **client** — which is the concrete reason `open_external_url` has to become a
client-executed event rather than simply being disabled.

### 4.6 Reconnect and state reconciliation

Local IPC never disconnects; the gateway does — sleep, Wi-Fi switch, tunnel restart.
The desktop derives state into Zustand and assumes it stays coherent. Server mode needs
an explicit **snapshot-on-connect** (`state.hydrate` returning projects, sessions,
agents, terminals, devices in one payload), then resubscribe, then replay. The web
client already does a narrow version — generalise it, don't invent a second protocol.

Agents keep running while no client is attached, which is the entire point: the mini
chews through a refactor overnight, the laptop reattaches in the morning and replays
the transcript from `chatHistory`.

### 4.7 Where the switch lives in the UI

The URL is the single source of truth for _what you're looking at_; which host you're
attached to is not that — it is transport, and it must survive a reload without
deep-linking someone into a machine they can't reach. Keep it out of the route: a
connection picker in the sidebar/titlebar, persisted in app settings, with the chosen
server's device key. Reconnect on launch, fall back to local with a visible banner.

Switching hosts tears down every subscription and re-hydrates — treat it as a full
remount, not a live swap.

## 5. What does _not_ change

Worth stating, because it bounds the blast radius:

- Worktree layout (`~/.argus/worktrees/{Repo}-argus-worktrees/{branch}/`) and
  `.argus.json` setup pipelines — identical, just on the mini's disk.
- Peacock, the desktop UI, routing (`app/lib/router.tsx`), and the stores. The
  transport swap happens entirely behind `app/lib/ipc.ts`.
- The Noise handshake, pairing, SAS, device store, tunnel manager.
- `REMOTE_METHODS` and the `monitor`/`control` tiers — phone and web are untouched.
- `@argus/remote-protocol` stays the one schema both sides compile against.

## 6. Phasing

**Phase 0 — security preconditions.** H1, M1, M2, M3 from the audit. Small,
independent, required before anything is permanently reachable.

**Phase 1 — headless host mode.** `Argus.app --host`: skip `createWindow()`, keep the
tray, gateway and tunnel; launchd _agent_ plist (not a daemon) + auto-login +
`caffeinate`. No protocol change. Immediately useful on its own — the phone and web
clients already work against it, so the mini becomes a 24/7 agent runner for the
existing 47-method surface.

**Phase 2 — the desktop switch.** `admin` capability + passthrough dispatch +
host-only denylist (§4.1); transport switch behind `app/lib/ipc.ts` + connection
picker (§4.7); `state.hydrate` and reconnect (§4.6); server-side project picker
(§4.4). At the end of this phase the switch works, minus terminals and device video.

**Phase 3 — the runtime panel.** Event-bus leaks (§4.2), `TAG_PTY` (§4.3), shared
H.264 decoder. This is what makes server mode feel like Argus rather than a remote
transcript viewer.

**Phase 4 — the command registry.** Collapse `ipc.ts` + `capabilities.ts` into a
single `defineCommand(name, {tier, params, handler})`, annotate all 325 commands, and
retire the `admin` denylist in favour of a declared tier per command. Worth doing —
it collapses the four-step IPC contract to two and makes every future command
remotable for free — but only once the switch has proven the shape.

**Phase 5 — optional core extraction.** `@argus/host` as plain Node behind a
`HostPlatform` interface (`openExternal`, `secretStorage`, `appVersion`, `notify`,
`revealInFinder`). Unlocks Linux hosts for Android-only work, faster service tests,
and an `argus-cli`.

**Phase 6 — multi-host.** One desktop, several servers (mini for iOS, Linux box for
Android/backend). The project list becomes host-scoped. Worth designing the shape for
in Phase 2 even if unimplemented.

## 7. Open questions

1. **Does the desktop keep local mode forever?** Keeping both doubles the tested
   surface, but for solo users it is almost certainly right — and it is what "a
   switch" implies.
2. **Single-tenant or multi-user?** "My Mac mini" and "the team's build server" are
   different products; the second needs per-user Claude accounts, quotas, and audit
   logs — and would invalidate the §4.1 passthrough. Recommend committing to
   single-tenant-with-many-devices.
3. **Attachment/file transfer budget.** Images are base64-in-JSON today; large diffs
   and screenshots need a size cap and probably a chunked channel.
4. **Does the embedded browser (`services/browser/`, CDP + MJPEG) follow?** Another
   local-window assumption needing the same treatment as simulators.
5. **What does the desktop show when the mini is unreachable mid-agent?** Read-only
   replay from the last snapshot, or a hard disconnected state?
