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
- **Git:** the engine and view models are shared with Grove through the GroveKit
  package; Argus draws its own views (see M4).
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
- **Engine and view models come from the shared GroveKit package**, which lives in the Grove repo and is imported by URL pinned to a Grove release tag. It is extracted from Grove's app: git engine, models and Grove's headless view models. Argus draws its own views on them; Grove keeps its own.
- GroveKit runs git through a pluggable runner. The Mac app uses the local runner on the worktree paths, since its host is on the same machine. A runner over the host gateway comes with M6 (remote hosts) and lets the phone use the same engine.
- Argus-specific flows stay host commands: creating and deleting sessions, merging into the base branch, protected branches, auto-fetch.
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

**M6.5 — Close the gaps:** everything an earlier milestone skipped, left
partial or found broken. Each milestone's report adds its deviations and open
risks here; M7's cutover waits until this list is empty or each item is
explicitly dropped. Known so far (struck through = done, **Dropped:** = won't do, with why):

- Host (also affects Electron today):
  - ~~Android emulator ignores input sent over its gRPC control channel (API 36 AVD); `adb input` works.~~ Keys and buttons were dropped on AVDs without `hw.keyboard` (the `avdmanager` default); they go through `adb input` there.
  - ~~A session created over the host socket disappeared after a host restart.~~ It was the project's home session, never persisted; restored at boot now.
  - ~~The Conductor browser's debugging port isn't exposed, so there are no DevTools.~~ `browser_devtools` returns the loopback endpoints (host tier).
- Mac app:
  - Session home lacks chat history and branch rename.
  - Run commands: `restartOnRerun`, `cwd` and `prerequisites` never exercised from the UI.
  - The chat input's control row is wider than the middle column and squeezes the sidebar.
  - Device logs: never saw a line arrive from a stock simulator.
  - Not ported: capture-card video inputs, the inspector's 3D view, the `/devices/:platform/:deviceKey` dialog.
  - Sidebar and table clicks only verified through driver routes, not real first clicks into a background window.
  - ~~M5 never exercised for real: a live huddle room and its guests (needs `cloudflared`), tunnels, Test push, taking a Handoff over from the phone, Claude sign-in / re-auth / remove, the Tailscale fixes, signal triggers, playbook revision, and moving existing worktrees.~~ Moving worktrees verified on scratch repos. **Dropped:** the live huddle room and Cloudflare tunnels (no `cloudflared` here), Tailscale (would change the real tailnet's serve config), Test push and taking a Handoff over (need a real phone and its token), Claude sign-in and playbook revision (need a real Claude account), signal triggers beyond the editor (need GitHub or Linear accounts). Run them by hand on a clean account before cutover.
  - M5 not built: Organisations (settings, org host session, member-repo context); the home screen's notification-permission and missing-dependency cards, update banner, "Needs you" / "Recent runs" sections and removing a project from recents.
  - M5 partial: ~~guests driving the shared device aren't marked and host huddle messages carry no author~~; deep links work but the app doesn't claim `argus://` while Electron does; display size scales unstyled text now, but not text with an explicit style (captions, headings, sidebar rows); ~~automations show raw cron with no preview or validation~~; ~~deep-link presets reorder with buttons, not drag~~ (the drag itself is unverified: a faked drop hung the dev driver); ~~inherited MCP servers have no test or tool list~~.
  - ~~Two `WorktreeLocationField`s (App and Project settings) should become one, with the move-worktrees sheet shared.~~
  - M4 partial: pull-request merge, comment and opening a PR only exercised up to their confirm dialogs; blame at an arbitrary ref (GroveKit can't).
  - M4 not built: commit templates, Gitmoji, the identity switcher, LFS actions, patch apply, the all-files list.
  - M4: host-run git commands report errors as plain strings, so the app can't offer git's recovery actions (e.g. force-with-lease) like Electron's error banner; a linked worktree's session watches the whole main `.git`, so busy sibling worktrees cause extra refreshes.
  - M4: the ArgusDesktop target has no unit-test target, so route parsing and diff row building are untested.
  - Layout: with the git sidebar, file list, diff and runtime panel open, the default window is too narrow; the app sidebar and runtime panel get clipped.
  - Quit: SIGTERM doesn't quit the app while a sheet (e.g. onboarding) is open; it and its host keep running. Without a sheet it quits fine.
  - Deep links: `DesktopRoute(path:)` doesn't parse the git routes (`/sessions/:id/git/:view`), so links to git screens fall back.
  - A launch route (`ARGUS_DEV_ROUTE`, and later deep links) to a remote host's session falls back to Home when it applies before that host has connected.
  - ~~Test hosts leave a login-keychain item ("Argus Host Secret Storage", account = their `ARGUS_HOME`) behind; tests and dev runs on temp homes should remove theirs.~~ A host on a temp `ARGUS_HOME` keeps its key in the home instead.
  - ~~Worktree sessions in a temp home didn't come back after an app restart (seen once in M4; may be the `/tmp` vs `/private/tmp` host bug below).~~ It was the `/private/tmp` bug.
- Mac app (from M6):
  - Not built: window tabs per machine; the focused host in the route (back/forward between machines); a host folder browser, so Add Project, Browse… in settings and worktree locations can't pick a folder on a remote host; dropping files into a remote session's chat (Electron sends them over the gateway's transfer channel).
  - The offline snapshot is in memory only: a host that is down when the app launches shows nothing until it answers.
  - Two hosts holding a repo at the same path are one project in the sidebar (the routing index is keyed by path); Electron keys projects by host.
  - Never exercised against a remote host: permission prompts and plan approval, notifications and banners for its agents, pull requests, automations and the inbox of a shown host, huddles (refused, as on Electron: host tier), the browser runtime, Android devices.
  - A remote session's git views refresh on the host's broadcasts only (no file watcher there); an edit nothing broadcasts shows up on the next action.
  - ~~Host-run git processes started over the gateway aren't killed when the connection drops; `argus-scratch` in the git dir is never cleaned.~~ Killed with their connection; scratch removed with the last one and swept daily. Failures now carry a `failure` kind and recovery.
- iOS app (from M6): ~~the remote git runner's host commands are admin tier, which a phone never holds, so the phone keeps the typed git methods; giving it GroveKit needs a scoped git tier first.~~ **Dropped:** the runner runs raw git arguments, and git runs code through config, aliases and hooks, so any scoped tier is shell access. The phone keeps typed methods (stashes, tags, amend added).
- Host (found in M6): ~~`reapOrphanedSpawnHelpers` kills any orphaned node-pty spawn helper on the machine at boot, not only its own; harmless for real orphans but a second host on one Mac reaps the first's leftovers.~~ Only pids this home recorded are reaped (agents too).
- Host (found in M5):
  - ~~`security -i` hangs when the host runs with a different `HOME`, blocking the host (only seen with a scratch `HOME` in tests).~~ Calls name the login keychain from the passwd home and time out.
  - ~~A session keyed `/tmp/…` isn't found again after a restart because git reports `/private/tmp/…` Reproduced in M6 on a second host whose `ARGUS_HOME` was under `/tmp`: its worktree session was gone after the host restarted.~~ Worktree paths and metadata keys are canonicalised.
  - ~~An automation's host session doesn't list under its project, so its transcript can't be opened from a run.~~ In `state_hydrate` and restored at boot.
  - ~~`gen-protocol` types `huddle_say`'s params as the gateway's `HuddleSayParams`, which lacks `roomId`; the Mac app sends it by wire name.~~ A command's own params type wins over a same-named model.
  - ~~Phone gaps found while building M5, all admin-only today: proposal request-revision and start-with-note, the full proposal record, deleting a run, an automation's track record, describing an automation, huddles, the app-level default autonomy and permission mode.~~ All on the phone now except huddles. **Dropped:** huddles stay host tier: sharing an agent and approving guests is a trust decision like pairing, and `huddle_list` hands out room tokens. The default permission mode is a phone-local preference, as it is per machine on the desktop.
- iOS app:
  - None of the M4 git views reach the phone; it keeps the host's typed git methods (see the M6 note below on the runner's tier). Stashes, the tag list and amend now go through typed methods. Still missing on the phone: reflog, submodules, bisect, hooks, git settings, branches review, interactive rebase, the conflict resolver, hunk staging, blame, creating and pushing tags.
  - ~~The all-agents list and read-only terminals were never run against a paired computer.~~ Run against a scratch host; the agents list now refreshes while open.
  - ~~Phone terminals poll every 2 s rather than streaming.~~ Streamed with replay on attach; older hosts still polled.
  - ~~A phone paired to a headless host (no window open) gets no transcripts and its sends stay at "Sending…": transcripts come from snapshots only a window publishes.~~ The host folds conversations itself while no window owns them.
  - ~~Proposal card buttons are cut off ("Start ses…") on an iPhone 17 Pro.~~
- GroveKit (fix in Grove, then bump the pin). All built on Grove's `grovekit-argus-followups-a14984` branch (unreleased); Argus adopts them after the release: drop the `/bin/sh` replay, `PullRequestPatch`'s scratch repo, `CompareModel`'s `commit-tree` trick, the blame-at-ref walk, Argus's `BranchTreeNode` and `GitNameSheet.isValidRef`, wire `onAction` into telemetry, and pass `GitNaming(name: "grove")` to share Grove's restacks and branch parents.
  - ~~From M6: `ShellResult` has no public initializer, so a runner outside GroveKit can't build one; Argus's gateway runner replays the host's output through a local `/bin/sh` via `LocalGitRunner` (stderr capped at 64 KB). `GitRunner.withGitExecutable`'s default is main-actor isolated, so conformers must spell it out.~~
  - ~~Branch actions (checkout, rename, delete, remotes, submodules, worktrees) still live in Grove's app-side `SidebarViewModel`.~~
  - ~~Grove-specific wording and file names (`HostingError` messages, `grove/restack.json`, `grove-` scratch prefix) and shared `UserDefaults` keys.~~
  - ~~`FileWatcher`, `WorktreeResolver` and view-model file actions still touch the local disk directly instead of going through the runner.~~
  - ~~From M4: a public `DiffParser` (or `DiffResult`/`FileDiff` initialisers) and a range diff `diff(from:to:)`; `BlameViewModel.open(file:revision:)`; an incremental `CommitGraphBuilder`; public `ListSelection.focus`, `WorkingCopyViewModel.selectedPath`, `PendingHunkDiscard.action`, `RestackPlan.steps`; a `nonisolated` `PullRequestHost.headRef` default; a linked-worktree watcher that ignores sibling worktrees; `RefName.isValid` and the branch-tree builder; an action hook on the view models for telemetry.~~
- ~~Release notes: the next Electron release is the first with the host lock; say so.~~ The host-lock changeset says so.
- Electron features added after this plan was written: go through every `feat` commit on `main` since the plan (excluding `feat(mac)` / `feat(ios)`), add a parity row for each one the Mac app (and phone) lacks, and build it. Known so far: agents continuing automatically once a usage limit resets, the chat banner showing when they will, and cancelling it (`7b886845`, `40a54996`, `1da71602`). Re-run this sweep right before cutover, since Electron keeps shipping until then.

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
