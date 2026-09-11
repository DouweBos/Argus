# Argus Server — headless host on a Mac mini, driven from desktop or remote

Design sketch for splitting Argus into a **host** (runs agents, worktrees, terminals,
simulators) and **shells** (desktop app, web client, phone app) that drive it over the
wire. Target deployment: a Mac mini in the corner running every agent and simulator,
with the laptop's Argus desktop acting as a client.

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

So the question is not "how do we build a server" — it is **"how do we finish
splitting the host from the shell, and how much of the desktop's surface follows."**

## 2. The gap, measured

|                                  | today                                                                      | needed                                                         |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Commands reachable over the wire | **47** (`REMOTE_METHODS`)                                                  | ~**329** (`ipcMain.handle` registrations in `electron/ipc.ts`) |
| Host process                     | Electron main, requires a `BrowserWindow`                                  | must run unattended                                            |
| Desktop renderer transport       | `window.argus.invoke()` → `ipcRenderer` only                               | must also speak the gateway                                    |
| Terminals over the wire          | none (`terminal:*` events go to `getMainWindow()` only, bypassing the tap) | full PTY streaming                                             |
| Device video to desktop          | in-process `BrowserWindow.webContents.send` (`ios-video.ts`)               | same H.264 stream the web client already gets                  |

The 47 → 329 delta is the single largest piece of work and everything else is
downstream of how it is solved.

## 3. Recommended shape

Three layers, two of which already exist:

```
┌──────────────── Mac mini (logged-in user session) ────────────────┐
│  argus-host                                                       │
│    state.ts · services/*  (agents, git/worktrees, pty, simctl,    │
│                            adb, conductor, mcp, llm runners)      │
│    command registry  ← ONE table, every command, with its tier    │
│    event bus         ← ONE emitter, every event                   │
│    gateway (Noise + pairing + tunnel)  ── unchanged ──            │
└──────────────────────────┬────────────────────────────────────────┘
                           │  Noise over WS (LAN / Tailscale / CF)
        ┌──────────────────┼──────────────────┬──────────────────┐
   Argus desktop      argus-web          argus-remote        (future CLI)
   (laptop, client)   (browser)          (iOS/Android)
```

The desktop app keeps its full UI and becomes a **shell with two transports**:

- **local mode** (today's behaviour) — embeds `argus-host` in the Electron main
  process, dispatches through `ipcMain`. Nothing changes for users who don't want a
  server.
- **remote mode** — dispatches the exact same command names over the gateway as a
  paired device with an `admin` grant. Zero UI rewrite: `app/lib/ipc.ts` is already
  the single chokepoint ("never call `window.argus.invoke()` directly"), so swapping
  what sits behind it is a contained change.

### 3.1 Keep Electron on the server (at least at first)

The obvious instinct is to extract `electron/services/` into a plain-Node
`@argus/host` package. That extraction is cheap — only **20 of 162** service files
import `electron` at all, and they use it shallowly (`app.isPackaged`,
`app.getVersion`, `safeStorage`, `shell.openExternal/openPath/showItemInFolder`,
`Notification.isSupported`, `BrowserWindow.getAllWindows`).

But on macOS it buys less than it looks like. **CoreSimulator requires a logged-in
Aqua session** — `simctl boot` fails under a launchd _daemon_ and needs a launchd
_agent_ inside a real user login. The Mac mini must therefore auto-login and stay
awake (`caffeinate`) regardless. Once you're in a GUI session, running the host as a
windowless Electron process costs almost nothing and gets you the entire service
layer working on day one with no extraction risk.

**Recommendation:** ship the server as `Argus.app --host` (no window, tray item only,
reusing `electron/services/tray/`). Do the `@argus/host` extraction later, motivated
by tests/CI/Linux-Android-only hosts rather than by the Mac mini.

## 4. The decisions that actually matter

### 4.1 One command registry, not two dispatch tables

Today a command exists twice: as an `ipcMain.handle("start_agent", …)` in
`electron/ipc.ts` and, if remotable, as a separate `"agents.spawn"` entry in
`REMOTE_METHODS` + a handler in `capabilities.ts`. Duplicating that 329 times is
untenable, and hand-porting each one is where the security model gets accidentally
widened.

Replace both with a single registration that declares its tier at the definition site:

```ts
defineCommand("start_agent", {
  tier: "control", // "monitor" | "control" | "admin" | "host-only"
  params: StartAgentParams, // zod — validated identically on both transports
  handler: (p, ctx) => startAgent(p, ctx),
});
```

- `electron/ipc.ts` becomes a loop that registers every command with `ipcMain`.
- The gateway becomes a loop that dispatches the subset whose `tier` the calling
  device was granted.
- `host-only` is the explicit escape hatch for things that must never cross the wire
  (`show_open_dialog`, `open_agent_popout`, `updater_quit_and_install`, …).
- The audit's core invariant survives: a command is remotely reachable **iff** it
  carries a non-`host-only` tier, and that's one grep-able token per command.

This is mechanical but large: ~329 handlers to annotate. It is also the highest-value
refactor in the whole project — it collapses the IPC contract from four steps
(handler / register / wrapper / types) to two, and every future command is remotable
for free.

Add an `admin` tier above `control` for the desktop-as-client case: project creation,
`.argus.json` writes, settings, onboarding, device pairing — things the audit
deliberately kept host-only but which a trusted laptop must be able to do.

### 4.2 One event bus

`broadcastToRenderers()` already fans out to windows _and_ taps. Rename/relocate it to
a host-level `emit(channel, payload)` and fix the leaks:

- `terminal/multiplexer.ts` sends `terminal:data:<id>` / `terminal:exit:<id>` straight
  to `getMainWindow()` — invisible to the gateway. Must go through the bus.
- `simulator/ios-video.ts` broadcasts frames via `BrowserWindow.getAllWindows()`.
  Should feed `videoForward.ts` only, which the gateway already consumes.

Remote clients must not receive every event — a laptop subscribed to four agents
should not stream a fifth agent's tokens. The gateway already does per-channel
subscription for `agent:*`; generalise it to `{prefix, id}` subscriptions across
terminals, git watchers, and device streams.

### 4.3 Terminals and video as binary channels

`gateway.ts` already frames `TAG_JSON` (0x00) vs `TAG_MEDIA` (0x01) inside the Noise
transport, with a `BACKPRESSURE_LIMIT` that drops delta frames when the socket backs
up. Add `TAG_PTY` (0x02) with a `{terminalId, bytes}` body and the same backpressure
discipline — xterm output is bursty and must never head-of-line-block the agent
stream. Resize/write travel as ordinary JSON commands.

Device video needs no new transport at all: the desktop just stops reading
`ios_video_frame` from IPC in remote mode and runs the web client's `h264Decoder.ts`
path against the gateway stream. That decoder should move into Peacock (or a shared
`@argus/media` package) so desktop and web share one implementation — same rule as
every other "rebuild in the web client" case in `CLAUDE.md`.

### 4.4 The filesystem boundary is the sharp edge

This is the item most likely to be underestimated. A large part of the desktop UI
silently assumes the repo is on the same machine as the window:

| surface                                                                    | in remote mode                                                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `reveal_in_finder`, `open_path`, `open_in_editor`, `open_in_custom_editor` | meaningless on the server; either disable, or add "open locally" that mounts/clones — see below                                     |
| `show_open_dialog` (picking a project root)                                | must become a **server-side** directory browser (`list_path`/`stat_file` already exist and are remotable)                           |
| drag-and-drop attachments (`webUtils.getPathForFile`)                      | path is local; must upload bytes. `agents.send` already carries base64 images — generalise to files                                 |
| `open_external_url`, `shell.openExternal`                                  | should open on the **client**, not the server — flip these to client-executed events                                                |
| `read_file` / `write_file`                                                 | audit deliberately left these unreachable from the wire. An `admin` desktop needs them; scope them with `assertInsideSession` first |
| `resolve_mention_path`                                                     | audit finding **M2** — no path containment today. Must be fixed before it's server-side                                             |

The honest answer for "open in editor" is that the editor story on a server host is
either (a) VS Code Remote-SSH / Cursor SSH into the Mac mini, or (b) nothing. Argus
shouldn't try to sync worktrees back to the laptop.

### 4.5 Identity, scoping, and multi-user

A server is inherently shared, which converts several audit findings from "nice to
fix" into blockers:

- **H1** — drop `"trusted"`/`bypassPermissions` from `RemotePermissionMode`. On an
  unattended Mac mini nobody is sitting there to see the prompt.
- **M3** — `repo_root` is client-supplied and unvalidated. Allowlist it against
  `collectAllProjects()` and add per-device `allowedRepoRoots` to the grant. This
  also becomes the mechanism for "this phone can watch one project".
- **M1** — `permission.respond` sits in the default `monitor` tier. On a server,
  approving a prompt is remote code execution on a machine nobody is watching.
- **M5/M6** — LAN mode serves the client bundle and `ws://` as plaintext on
  `0.0.0.0`. For a permanently-on server, prefer Tailscale (already supported) and
  treat raw-LAN as opt-in with a warning.

Claude credentials now live on the server: `claudeAuth/accounts.ts` becomes shared
state, and `claude_auth_login_start` has to drive an OAuth flow whose browser opens on
the _client_. Per-device "which Claude account may I spawn agents under" is the
natural extension of the grant model.

### 4.6 Reconnect and state reconciliation

Local IPC never disconnects; the gateway does — sleep, Wi-Fi switch, tunnel restart.
The desktop stores derived state in Zustand and assumes it stays coherent. Remote mode
needs an explicit **snapshot-on-connect** (`state.hydrate` returning projects,
sessions, agents, terminals, devices in one payload), then resubscribe, then replay.
The web client already does a narrow version of this — generalise it rather than
inventing a second protocol.

Agents keep running while no client is attached, which is the whole point: the Mac
mini chews through a refactor overnight, the laptop reattaches in the morning and
replays the transcript from `chatHistory`.

## 5. What does _not_ change

Worth stating explicitly, because it bounds the blast radius:

- Worktree layout (`~/.argus/worktrees/{Repo}-argus-worktrees/{branch}/`) and
  `.argus.json` setup pipelines — identical, just on the server's disk.
- Peacock. The desktop UI, routing (`app/lib/router.tsx`), and stores are untouched by
  the transport swap.
- The Noise handshake, pairing, SAS, device store, tunnel manager.
- `@argus/remote-protocol` stays the one schema both sides compile against.

## 6. Phasing

**Phase 0 — unblock the security preconditions.** H1, M1, M2, M3 from the audit.
Small, independent, and required before anything is permanently internet-reachable.

**Phase 1 — headless host mode.** `Argus.app --host`: skip `createWindow()`, keep tray

- gateway + tunnel, add a launchd _agent_ plist and a `caffeinate` assertion. No
  protocol change. Immediately useful: phone and web clients already work against it,
  so a Mac mini becomes a 24/7 agent runner for the existing 47-method surface.

**Phase 2 — the command registry.** Collapse `ipc.ts` + `capabilities.ts` into
`defineCommand`, annotate all ~329 commands, add the `admin` tier. Ship behind the
existing clients (they see no change) and verify tier-by-tier with the existing
`capabilities.test.ts` / `capabilities.control.test.ts` patterns.

**Phase 3 — desktop as client.** Transport switch behind `app/lib/ipc.ts`, connection
picker in the UI (local / paired server), `state.hydrate`, reconnect handling, and the
filesystem-boundary work from §4.4. Terminals (`TAG_PTY`) and shared H.264 decode
land here.

**Phase 4 — optional core extraction.** `@argus/host` as plain Node behind a
`HostPlatform` interface (`openExternal`, `secretStorage`, `appVersion`, `notify`,
`revealInFinder`) with an Electron impl and a headless impl. Unlocks Linux hosts for
Android-only work, faster service tests, and a `argus-cli`.

**Phase 5 — multi-host.** One desktop, several servers (Mac mini for iOS, Linux box
for Android/backend). The project list becomes host-scoped; routing gains a host
segment. Worth designing the route shape for in Phase 3 even if unimplemented.

## 7. Open questions

1. **Does the desktop keep local mode forever, or become client-only?** Keeping both
   doubles the tested surface but is almost certainly right for solo users.
2. **Single-tenant or multi-user?** "My Mac mini" and "the team's build server" are
   different products — the second needs per-user Claude accounts, quotas, and audit
   logs. Recommend committing to single-tenant-with-many-devices for now.
3. **Attachment/file transfer budget.** Images are base64-in-JSON today; large diffs
   and screenshots over a phone link need a size cap and probably a chunked channel.
4. **How much of `git_*` (≈100 commands) is genuinely useful remotely** vs. what a
   laptop-local clone handles better.
5. **Does the embedded browser (`services/browser/`, CDP + MJPEG) follow?** It's
   another local-window assumption that needs the same treatment as simulators.
