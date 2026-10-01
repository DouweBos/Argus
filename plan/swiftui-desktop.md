# SwiftUI desktop app

## Context

The host now boots in plain Node (`packages/host/src/bin/argus-host.ts`), every
command is in a zod catalog, and ArgusKit has generated Swift types for all of
them (`clients/apple/ArgusKit/Sources/ArgusKit/Generated/`, typed
`Transport.request(_: RemoteCommand.Type, …)`). This phase builds the native Mac
app on top of that.

Decisions already made:

- **Shape:** a macOS app target in the existing Xcode project. Code both apps use
  moves out of `ArgusRemote` into SPM packages; each app keeps its own shell.
- **Host:** the Mac app bundles and supervises its own Node host from the first
  milestone.
- **Git:** the Mac app calls the host's typed git commands and draws its own
  views. No Grove GitKit in this phase.
- **Cutover:** Electron keeps shipping. The Mac app ships as a beta against a
  parity checklist and replaces Electron only when the checklist is done.

## Architecture

```
Argus.app (SwiftUI, macOS 15)
├── Contents/MacOS/Argus                 Swift app: window, menus, tray, Sparkle
├── Contents/Resources/host/
│   ├── node                             pinned Node runtime (signed, hardened)
│   ├── argus-host.js                    dist-host bundle
│   ├── node_modules/node-pty            prebuilt addon + spawn-helper
│   └── resources/                       sim-bridge, sim-input, conductor, scrcpy jar,
│                                        emulator proto, prompts, docs, argus-web
└── talks to the host over ~/.argus/host.sock (local UI channel)
```

### Local UI channel (the main new host piece)

The gateway can't be the UI's way in: it only runs when remote access is on, it
needs SAS pairing, and it refuses host-tier commands. The bundled host gets a
second listener instead:

- A Unix domain socket at `$ARGUS_HOME/host.sock`, mode 0600. Filesystem
  ownership is the authentication; no Noise, no pairing.
- The same envelopes and frame tags as the gateway (`TAG_JSON`, `TAG_MEDIA`,
  `TAG_XFER`), so dispatch, subscriptions, raw `ipc` events and H.264 / JPEG
  media reuse `gateway.ts`. `DeviceConnection` already writes through a `sink`
  plus a session cipher, so the socket gets a pass-through cipher.
- Its connection is the one caller allowed **every** tier, including `host`
  (pairing, grants, updater state, huddle hosting): it is the console. Model it
  as a synthetic local device in `GatewayContext`, not as a paired device.
- New host files: `packages/host/src/services/remote/localUiSocket.ts`, and a
  `--ui-socket <path>` flag on `argus-host`.

### Platform delegation

`HostPlatform` (`packages/host/src/platform.ts`) has host-initiated capabilities
that a headless Node host turns into no-ops: `notify`, `isForeground`,
`focusUi`, `openExternal`, `openPath`, `revealInFinder`, `closeDevicePopout`.

- Add `uiHostPlatform(channel)`, which forwards these as host → client requests
  on the local socket. It falls back to the Node no-op when no UI is attached.
- The Swift app answers them with `UNUserNotificationCenter` (with action
  buttons), `NSWorkspace`, `NSApp.activate`, and window state.
- `secretStorage` stays the host's `nodeSecretStorage` (login keychain via
  `security`).

### Desktop mode for the Node host

`hostEnv.ts` hard-codes server mode (`ARGUS_SERVER=1`, `~/.argus-host`, port
47617). Add `argus-host --desktop`:

- `ARGUS_HOME=~/.argus` (the desktop's state, so projects and sessions carry over
  from Electron).
- `startHost({ forceRemote: false })`, so the gateway follows Settings like the
  Electron desktop does.
- No caffeinate.
- **One host per `ARGUS_HOME`.** Take an exclusive lock (`$ARGUS_HOME/host.lock`,
  `flock` plus pid). The Electron app takes the same lock. While Electron holds
  it, the Mac app says so and offers to quit Electron, rather than running two
  hosts on the same worktrees.

### Swift app ↔ host lifecycle

- `HostSupervisor` launches the bundled `node`, waits for the socket, restarts on
  a crash with backoff, and streams host logs to `~/.argus/logs/host.log`.
- **Quit:** run the existing confirm-quit flow (warn about running agents, then
  `stopAgentsForQuit`), then SIGTERM and wait for `shutdownHost`.

### Code layout (Swift)

```
clients/apple/                     (rename to clients/apple/ at the end of M0)
├── ArgusKit/        existing: protocol, Noise, generated types
│   └── + LocalTransport (UDS, no Noise) behind the same Transport API
├── ArgusCore/       NEW package, iOS 18 + macOS 15: stores + pure logic, no SwiftUI
├── ArgusUI/         NEW package, iOS 18 + macOS 15:
│                    design system, markdown, transcript rows, tool-call cards,
│                    permission forms, diff lines, device video view, image viewer
├── ArgusRemote/     iOS app shell (tabs, NavigationSplitView, push, pairing scanner)
└── ArgusDesktop/    NEW macOS app shell (three panels, menus, windows, host supervisor)
```

- **New targets use file-system-synchronized groups**, as Grove and Charon do, so
  new files need no `project.pbxproj` edits. `ArgusRemote` can migrate later.
- **Moving iOS views into ArgusUI** follows the earlier audit:
  - the layout-neutral 23% moves as-is;
  - the 45% that's neutral content in iOS chrome moves with the chrome stripped;
  - the 32% UIKit-bound part gets `#if canImport(UIKit)` adapters (`UIImage`/`NSImage`, the paste text view, the video layer).
- **Business logic is shared too, not just views.** A new `ArgusCore` package
  holds the stores (projects, sessions, agents and transcript merging, queue,
  permissions, automations, proposals, PRs, Claude accounts, devices) and the
  pure logic now in `ArgusRemote/Stores` and ArgusKit utilities (tool grouping,
  markdown blocks, mention search). Stores talk to a `HostBackend` protocol with
  two implementations: `GatewayBackend` (iOS today: typed `monitor`/`control`
  methods, snapshot refetch) and `LocalBackend` (Mac: admin commands and live
  `ipc` events). The iOS app moves onto `ArgusCore` in the same change, so there
  is one copy of each store. Only phone-only state (push registration, pairing
  scanner) stays in `ArgusRemote`.
- **Routing:** one `Route` model mirroring [`docs/routing.md`](../docs/routing.md),
  the single source of "which screen", as on the web side.

## Milestones

Each milestone ends with a usable beta build. Work is committed per feature, as
`feat(mac): …` / `refactor(ios): …`.

**M0 — Skeleton that runs a real host**

- Host side: `--desktop`, the host lock (in Electron too), `localUiSocket`, `uiHostPlatform`.
- Packaging: `scripts/build-mac-host.ts` stages the Node runtime, `dist-host`, node-pty and resources into `Resources/host/`.
  - Driven by an Xcode build phase.
  - Signed with hardened runtime. Node needs `allow-jit`, `allow-unsigned-executable-memory`, and `disable-library-validation` for `.node` files.
- Swift side: create the ArgusCore and ArgusUI packages and move the iOS app onto them; add the ArgusDesktop target; add `LocalTransport` and `HostSupervisor`.
- Window: a three-panel `NavigationSplitView` showing projects and sessions from `state_hydrate`, live over `session:*` events.
- Notarized local build with the host-lock handover.

**M1 — Core loop:**

- Create and delete sessions, with setup progress.
- Agent tabs and the transcript, driven live by `agent:event:<id>` instead of snapshot polling.
- Chat input: slash commands, mentions, images, model/mode/effort, queue.
- Permission prompts, plan approval and questions.
- Notifications through platform delegation.
- Find-in-chat, text selection, file-path links.

Transcript rendering uses TextKit 2 (`NSTextView`) where SwiftUI `Text` can't
handle selection or long transcripts.

**M2 — Terminals:**

- SwiftTerm on `terminal:data` / `terminal_write` / `terminal_resize`.
- Add a host command that returns the 256 KB `outputLog`, so reattaching replays scrollback.
- Run commands, terminal tabs, search, link handling.

**M3 — Runtime panel:**

- iOS/Android video over the socket's media frames into `AVSampleBufferDisplayLayer` (moved into ArgusUI from iOS).
- Touch, keyboard and hardware buttons; rotation and fold.
- The browser screencast with input and nav state.
- Device popouts as real `NSWindow`s.
- Inspection overlay.

**M4 — Git:**

- Views: status, staging (file and hunk), commit, diff viewer, log/graph, blame, branches, stash, conflicts, rebase/cherry-pick flows, PRs.
- Everything goes through the typed git commands.
- The diff and graph views use AppKit-backed text and table views for large repos.

**M5 — Settings and the rest:**

- App Settings (every field in `docs/app-settings.md`).
- Project Settings (`.argus.json`).
- Onboarding, MCP servers, automations and proposals, Claude accounts, LLM runners.
- Remote access and pairing, using host-tier commands over the local socket.
- Huddles, command palette.

**M6 — Other hosts:** connect to other Macs and servers over the Noise gateway
(admin), with per-subject host routing like `app/lib/transport/hostRouting.ts`,
and switching hosts in the sidebar.

**M7 — Ship:**

- Sparkle updates with a release lane modelled on Grove's (fastlane, changesets for the version, appcast on houwert.dev).
- Telemetry.
- The beta channel.
- Parity sign-off, then cutover: the Electron app's last update points users at the Mac app.

## Parity checklist

Write `plan/swiftui-parity.md` in M0. It holds one row per route in
`docs/routing.md` and per feature in `docs/features.md`, with columns Electron /
Mac / iOS. A milestone isn't done until its rows are ticked. That file is the
cutover gate.

## Cross-cutting rules

- **iOS rides along.** Anything moved into ArgusUI must keep the iOS app building
  and looking the same. A Mac feature that makes sense on a phone gets its iOS
  surface per the CLAUDE.md rule.
- **Telemetry.**
  - Add a `TelemetryEvent` catalog for the Mac app: lifecycle, host supervisor
    restarts and failures, navigation by route pattern, and the host-lock handover.
  - Host-side events stay host-captured, so the Mac app never double-counts.
  - `telemetryDocs.test.ts` gains the Mac catalog, and `docs/telemetry-events.md`
    documents it.
- **Design.** The Mac app mirrors Peacock's tokens: generate `ArgusUI` colour
  assets from `packages/peacock/src/styles/tokens.css` so both themes stay in
  step. Use SF Symbols where a Peacock icon has an equivalent; otherwise export
  the Peacock SVG to a symbol asset.
- **Docs.**
  - `docs/mac-app.md`: install, the beta, and its relation to Electron.
  - CLAUDE.md: Swift layout, build commands, and the rule that new desktop
    features land in the Mac app too once it is the product.

## Risks

- **Signing the bundled Node** (JIT entitlements, `.node` library validation) is
  the riskiest packaging step. Spike it first in M0.
- **Host lock and Electron:** two hosts on one `~/.argus` would corrupt state.
  The lock must land in Electron before any Mac beta reaches users.
- **Transcript performance in SwiftUI.** Budget the TextKit 2 path from the start
  rather than retrofitting it.
- **Scope.** This is ~140k lines of React at parity. The milestones are ordered so
  the beta is useful after M2 (core loop plus terminals), even though the cutover
  waits for M5.

## Verification

- **Host side, per change:** `pnpm lint && pnpm test`.
  - New tests: the local socket accepts host-tier commands and rejects other users (mode 0600).
  - The lock blocks a second host.
  - Platform delegation round-trips, and falls back when no UI is attached.
- **Swift, per change:**
  - `swift test` in ArgusKit and ArgusUI.
  - `xcodebuild` for both the iOS and macOS schemes.
  - The Mac scheme's unit tests cover stores driven by recorded event fixtures.
- **Per milestone, in a notarized build on a clean user account:**
  - First launch starts the host, onboarding works, a session is created and an agent runs.
  - Quitting stops agents and the host.
  - Relaunch restores state.
  - With Electron running, the lock handover works.
