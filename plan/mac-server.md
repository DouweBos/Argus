# Native Argus Server for Mac (menu bar)

Replace the Electron `Argus Server.app` with a windowless SwiftUI menu-bar app
built from `clients/apple`, supervising the same bundled Node host the Mac app
already ships. Closes the open "Argus Server" row in `plan/swiftui-parity.md`
("the plan doesn't say what replaces it at cutover").

Status (2026-10-28): phases 0–4 landed; phase 5 (removal) is deliberately held
for the release after the hand-off build — see §13. Decisions for every open
question are recorded in §12.

## 1. Goals and non-goals

**Goals**

- A native `Argus Server.app` (`dev.houwert.argus.server`): menu-bar item only,
  no Dock tile, no main window, runs the full host (agents, worktrees,
  terminals, simulators, gateway, web client) unattended on a Mac mini.
- Feature parity with the Electron server's tray (`electron/services/tray/`):
  version/gateway/state lines, live project → session → agent tree, pairing
  with SAS + grant choice, updates with the "agents running" guard and
  install-when-idle, Quit.
- Account actions in the menu, matching the Electron tray account section that
  is landing now: link with a code, approve joins (SAS), name, tunnel/route
  status, unlink. Today the server only links through `argus-host`.
- Start at login and come back after a crash without a hand-installed launchd
  plist (`SMAppService`).
- Drop-in replacement: same bundle id, same `~/.argus-server`, same port, so
  paired devices, account link, worktrees and TCC grants survive the switch.
- Maximum reuse: `HostSupervisor`, `HostLock`, `LocalBackend`, the pairing and
  account models already in `ArgusDesktop`.

**Non-goals**

- No session/agent UI in the server. Driving it is the job of a paired desktop,
  the Mac app, the phone or the web client (`clients/argus-web`, served by the
  host).
- No change to the host core's behaviour beyond a supervised `--server` mode.
- Not a launchd _daemon_: CoreSimulator needs an Aqua login (unchanged from
  `docs/server-app.md`; auto-login is still required).
- Not Linux/headless: that stays `argus-host`.
- No Sign in with Apple in the server: it links via a host code, never signs in.

## 2. Today (what this builds on)

| Piece                  | Where                                                                                                                                                                                                                                      | Relevance                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Electron server target | `scripts/electron-builder-server.config.cjs`, `dist-electron/server.js` banner sets `ARGUS_SERVER=1`                                                                                                                                       | What we replace                                            |
| Server mode            | `packages/host/src/serverMode.ts` (`isServerMode`, `caffeinate -i -m -s -w`)                                                                                                                                                               | Reused by the host as-is                                   |
| Home default           | `packages/host/src/lib/argusHome.ts` → `~/.argus-server` when `ARGUS_SERVER=1`                                                                                                                                                             | Native server passes `ARGUS_HOME` explicitly anyway        |
| Standalone host env    | `packages/host/src/bin/hostEnv.ts`: `--desktop` vs default server (`~/.argus-host`, 47617)                                                                                                                                                 | Needs a third, supervised server mode                      |
| Host bin               | `packages/host/src/bin/argus-host.ts`: lock owner `mac`/`cli`, `forceRemote: !desktopMode`, power assertion, `--owner-pid` watchdog, UI socket                                                                                             | Server mode flips the desktop-only branches                |
| Supervisor             | `ArgusCore/Host/HostSupervisor.swift` (hardcodes `--desktop`; crash backoff 5/120 s; `logs/host.log` 10 MB; attach/lock/takeOver)                                                                                                          | Reused; gains a mode                                       |
| Host bundle            | `scripts/build-mac-host.ts` + ArgusDesktop "Bundle Node host" build phase                                                                                                                                                                  | Same phase in the new target                               |
| Pairing state machine  | `packages/host/src/services/remote/serverPairing.ts` (Electron in-process, writes `pairing-code.txt`)                                                                                                                                      | Native uses `remote_*_pairing` commands over the UI socket |
| Account commands       | `packages/remote-protocol/src/commands/account.ts` (`account_get_status`, `account_link_local_begin/finish`, `account_list_requests`, `account_approve_join`/`confirm`/`deny`, `account_set_name`, `account_set_config`, `account_logout`) | Menu calls these; no new commands expected                 |
| Mac UI to reuse        | `Settings/Account/MacHostLinkSection.swift` (`MacHostLink`), `Settings/Remote/{PairingSheet,QRCodeView,RemoteSettingsModel,RemoteTunnelSections}.swift`                                                                                    | Move to shared modules                                     |
| Updates                | Electron: `electron/serverUpdates.ts`, `server_auto_install_updates` in `app-settings.json`. Mac app: none yet (Sparkle is an M7 parity row)                                                                                               | Shared Sparkle work                                        |
| launchd                | `build/dev.houwert.argus.server.plist`, `pnpm server:install-agent`                                                                                                                                                                        | Migrated away from                                         |

Ports in use: 47615 desktop, 47616 `pnpm dev`, 47617 server, 47618
`pnpm dev:host`, 48016+ Mac app dev run command, 48116+ native server dev run
command ("Mac server" in `.argus.json`; 47619 was taken by manual Mac app runs).

## 3. Target structure

### Options

| Option                                                    | Single instance / lock                                                                                                                     | Bundle id, LSUIElement                                                                         | Login item                           | Updates                   | Verdict                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- | -------------------------------------------------------------------- |
| **A. Second Xcode app target `ArgusServer`**              | Own bundle id → own app-level instance; own `ARGUS_HOME` → own `host.lock`                                                                 | Own Info.plist: `LSUIElement=YES`, id `dev.houwert.argus.server`                               | `SMAppService` registers _this_ app  | Own Sparkle feed/channel  | **Recommended**                                                      |
| B. Build configuration of ArgusDesktop (`Release-Server`) | Same as A at runtime                                                                                                                       | Needs per-config Info.plist + id; every scheme/config doubles (Debug/Release × Desktop/Server) | Same as A                            | Same as A                 | Config sprawl, easy to ship the wrong flavour; no real saving over A |
| C. One app, runtime server mode                           | One bundle id for both: LaunchServices/`NSRunningApplication` treat them as one app; can't run desktop + server side by side without hacks | `LSUIElement` is static; would need `setActivationPolicy` at runtime (Dock flashes at launch)  | Login item would start the _desktop_ | One feed for two products | Rejected: same reason Electron split targets (`docs/server-app.md`)  |

### Recommendation: A

- New target `ArgusServer` in `clients/apple/ArgusRemote.xcodeproj`, product
  `Argus Server.app`, file-system-synchronized group `clients/apple/ArgusServer/`
  (like ArgusDesktop; no hand pbxproj file entries after the target exists).
- Depends on `ArgusKit`, `ArgusCore`, `ArgusUI`, `PostHog` (and Sparkle once
  added). Never on ArgusDesktop sources directly.
- Build phase: the same "Bundle Node host" script (`build-mac-host.ts --out …
--sign … --app …`), so the server ships the identical host, `argus-web`
  bundle, sim bridge, conductor, rg, language servers.
- Info.plist: `LSUIElement=YES`, `CFBundleName=Argus Server`, no `argus://`
  URL scheme, no document types; keep the usage strings the host's
  simulator/device code can trigger (camera/mic only if the bridge needs them;
  audit against `electron-builder-server.config.cjs` removals).
- Entitlements: hardened runtime, no sandbox, **no** `com.apple.developer.applesignin`
  → plain Developer ID with no provisioning profile (unlike `dev.houwert.argus.mac`,
  which needs `fastlane mac_app_profile`).

| Config  | Bundle id                      | Default `ARGUS_HOME`      | Port  | Signing                             |
| ------- | ------------------------------ | ------------------------- | ----- | ----------------------------------- |
| Debug   | `dev.houwert.argus.server.dev` | `~/.argus-mac-server-dev` | 48116 | Apple Development                   |
| Release | `dev.houwert.argus.server`     | `~/.argus-server`         | 47617 | Developer ID Application, notarized |

Debug never defaults to `~/.argus-server` (same rule as `HostLocation` for
`~/.argus`). `ARGUS_HOME`/`ARGUS_REMOTE_PORT` env still override.

### Shared code moves (phase 0, pure refactor)

| From `ArgusDesktop`                                     | To                                                                              | Why                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `HostLocation` (home/bundledHost/configuration)         | `ArgusCore/Host/HostLocation` parameterised by `{defaultHome, debugHome, mode}` | Both apps build a `HostSupervisor.Configuration` |
| `MacHostLink` state machine                             | `ArgusCore` (`HostLinkModel`)                                                   | Menu and Settings drive the same link flow       |
| Pairing model in `RemoteSettingsModel`                  | `ArgusCore` (`PairingModel`)                                                    | Menu pairing + desktop sheet                     |
| `QRCodeView`, SAS/code views from `PairingSheet`        | `ArgusUI`                                                                       | Pairing window in the server                     |
| Account join approval model (`AccountJoinPrompt` logic) | `ArgusCore`                                                                     | Approve from the menu                            |
| Telemetry client bits of `MacTelemetry`                 | `ArgusCore` (event enum stays per app)                                          | Server gets its own enum                         |

### Single instance

- App level: on launch, if another `NSRunningApplication` with our bundle id
  exists, activate nothing and exit 0 (a login item + manual double-click must
  not race).
- Host level: unchanged `host.lock` per `ARGUS_HOME`. Native server and Mac
  app/desktop can never collide because homes differ (`~/.argus-server` vs
  `~/.argus`).
- Electron server on the same home: lock owner `electron` → supervisor state
  `.locked` → menu offers **Take Over from the Old Argus Server** (`takeOver()`,
  already implemented) — the migration path, §8.
- Lock owner: add `mac-server` to `HostLockOwner` (TS + Swift) so conflict
  messages and `mac_host_*` telemetry say "Argus Server" not "Argus for Mac".
  Older Swift decodes unknown owners as `.cli` (already tolerant).

## 4. Host supervision

- `HostSupervisor.Configuration` gains `mode: .desktop | .server` (default
  `.desktop`); `launch()` passes `--desktop` or `--server` instead of the
  hardcoded `--desktop`. Everything else (UI socket, `--owner-pid`, `ARGUS_HOME`,
  `ARGUS_RESOURCES`, crash backoff, `logs/host.log` rotation, orphan reaping)
  is shared.
- Host side (`hostEnv.ts` / `argus-host.ts`): replace the `desktopMode`
  boolean with `hostMode: "desktop" | "server" | "cli"`.

| Behaviour                                | `--desktop` (Mac app)               | `--server` (native server)                                                                                         | none (`argus-host`) |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `ARGUS_SERVER=1`                         | no                                  | yes                                                                                                                | yes                 |
| Default home                             | `~/.argus`                          | supervisor always passes one                                                                                       | `~/.argus-host`     |
| Default port                             | 47615                               | 47617                                                                                                              | 47617               |
| Lock owner                               | `mac`                               | `mac-server`                                                                                                       | `cli`               |
| `forceRemote`                            | no (follows settings)               | **yes**                                                                                                            | yes                 |
| Power assertion                          | no                                  | **yes**                                                                                                            | yes                 |
| UI socket `supervised`                   | yes                                 | yes                                                                                                                | no                  |
| Quit                                     | `stopAgentsForQuit()` then teardown | `stopAgentsForQuit()` then teardown (better than Electron's "just goes"; capped by supervisor's 15 s stop timeout) | immediate           |
| TTY console (`pair`, `login`, `account`) | no                                  | no                                                                                                                 | yes                 |
| `repo-roots.json` replay                 | via host                            | via host (verify `startHost` does it under `ARGUS_SERVER`, as Electron server relies on it)                        | same                |

- Crash restart: `HostSupervisor` restarts the host (5 crashes / 120 s, then
  `.failed`). The menu shows the state and a **Restart Host** item on
  `.failed`. The _app_ itself is restarted by launchd via `SMAppService`
  (`KeepAlive` on unsuccessful exit, §5).
- Logs: host → `~/.argus-server/logs/host.log` (supervisor, rotating). The
  host's own rotating log stays where it is. App-level `os.Logger` subsystem
  `dev.houwert.argus.server`. No more `launchd.{out,err}.log` once migrated.
- Dev loopback (`ARGUS_DEV_TRUST`) stays Electron/`argus-host` only for now;
  if wanted, gate it the same way (`#if DEBUG` + env) — open question.

## 5. App lifecycle, login item, updates, signing

**Login item.** `SMAppService.agent(plistName: "dev.houwert.argus.server.agent.plist")`
shipped in `Contents/Library/LaunchAgents/` with `BundleProgram`,
`RunAtLoad`, `KeepAlive {SuccessfulExit: false}`, `ProcessType Interactive` —
the same semantics as today's hand-installed plist, but registered by the app
and visible in System Settings → Login Items. `SMAppService.mainApp` is not
enough: it has no crash restart. Menu checkbox **Open at Login**; status
`.requiresApproval` shows **Allow in Login Items…** (`SMAppService.openSystemSettingsLoginItems()`).
Quit from the menu exits 0, so launchd does not resurrect it.

**Updates.** Sparkle 2, shared with the Mac app's M7 parity row (build it once
in a small shared `ArgusUpdate` package or ArgusCore file; each app supplies
feed URL + policy).

- Own appcast per product and channel (`latest`/`beta`/`alpha`), EdDSA signed,
  hosted next to the GitHub release assets.
- Background check hourly (Sparkle `SUScheduledCheckInterval=3600`),
  download only on click (`SUAutomaticallyUpdate=NO`), mirroring Electron.
- Install guard: custom `SPUUserDriver`/delegate that refuses
  **Restart and Install** while any agent is running (count from the
  `LocalBackend` agents store, prewarmed excluded — same rule as the Electron
  tray) and shows `3 agents running — cannot restart`.
- **Install Automatically When Idle** (default off), stored where Electron
  stores it: `server_auto_install_updates` in `$ARGUS_HOME/app-settings.json`
  (read/written via the host's settings command so it survives the switch).
  Idle re-check every minute.
- Sparkle replaces the whole `.app`, host included, so app and host versions
  never skew.

**Signing / notarization.** Developer ID Application cert from match
(`fastlane certs`, already exists). New lane `mac_server_release`:
`xcodebuild archive -scheme ArgusServer -configuration Release` →
`-exportArchive` (method `developer-id`) → `notarytool submit --wait` (reuse
`prepare_notarize_env`) → `stapler staple` → `ditto -c -k --keepParent` zip →
Sparkle `generate_appcast`/`sign_update` → GitHub release upload. No DMG
(matches Electron server). Nested code in `Resources/host` is already signed by
`build-mac-host.ts`; notarization covers it. CI on `macos` runner (not a
plexinc repo; Blacksmith not required).

## 6. Menu-bar UI

`MenuBarExtra` with `.menuBarExtraStyle(.menu)`: native NSMenu look, matches
the Electron tray, keyboard-navigable. Anything that needs more than a menu
line (QR, a link code to read, SAS + grant choice) opens a small utility
`Window` scene, and the app activates for it (`NSApp.activate`). Icon: the
existing template tray icon pair (idle / agents active), moved into the
target's asset catalog.

Menu built from a pure `ServerMenuModel` (ArgusServer, no SwiftUI) →
`[MenuItem]`, so it is unit-testable like the Electron tray.

| Section            | Items                                                                                                                                                                                                                                                                                                    | Backing                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status             | `Argus Server 1.2.3` · `Host: running / restarting (2) / failed` · `Gateway: ws://<lan>:47617` · `State: ~/.argus-server` (click: reveal)                                                                                                                                                                | `HostSupervisor.state`, `remote_get_status`                                                                                                        |
| Agents             | `● Project (n)` → `● session (n)` → `● agent`; disabled leaves (no window to navigate to), or **Open in Web Client** deep link (open question)                                                                                                                                                           | `LocalBackend` sessions/agents stores                                                                                                              |
| Routes             | `LAN: 192.168.1.20`, `Tailscale: …`, `Tunnel: argus-….houwert.dev (up / starting / off / failed)`; **Copy Address**                                                                                                                                                                                      | `remote_get_status` routes + managed tunnel (as `RemoteTunnelSections`)                                                                            |
| Pairing            | **Pair a Device…** → window: QR + code (copied to clipboard and written to `$ARGUS_HOME/pairing-code.txt`, 0600, deleted on settle/quit), then `Confirm this matches: 123 456` with **Approve — watch only / run agents / full control of this Mac** and **Reject**; states mirror `buildPairingItems()` | `remote_start_pairing`, `remote_confirm_pairing`, `remote_cancel_pairing` via shared `PairingModel`                                                |
| Account (unlinked) | **Link to Your Account…** → window: code `WDJB-MJHT`, expiry, "or open houwert.dev/argus/link"; then SAS confirm or "Make it the first computer"                                                                                                                                                         | `account_link_local_begin/finish`, shared `HostLinkModel`                                                                                          |
| Account (linked)   | `Linked as "Mac mini"` · `Safety code: …` · `Waiting to join: 2` → per request **Review…** (SAS window, Approve/Deny) · **Rename This Computer…** · Tunnel on/off · **Unlink…** (confirm alert)                                                                                                          | `account_get_status`, `account_list_requests`, `account_approve_join`/`confirm`/`deny`, `account_set_name`, `account_set_config`, `account_logout` |
| Open               | **Open Web Client** (`http://127.0.0.1:47617/` in the default browser) · **Open Logs** (reveals `logs/`) · **Show State Folder**                                                                                                                                                                         | `NSWorkspace`                                                                                                                                      |
| Updates            | identical rows to `buildUpdateItems()` / `buildInstallItem()` + **Install Automatically When Idle**                                                                                                                                                                                                      | Sparkle wrapper                                                                                                                                    |
| App                | **Open at Login** ✓ · **Settings…** · **Quit Argus Server**                                                                                                                                                                                                                                              | `SMAppService`, Settings scene                                                                                                                     |

Labels and ordering follow the Electron tray (including the account section
being added now); reconcile wording with that change before phase 2 lands, so
docs describe one menu.

A pending join request or pairing SAS also posts a local notification (signed
app, `UNUserNotificationCenter`) — useful when the menu is closed; clicking it
opens the review window.

### Settings window (minimal)

One `Settings` scene, two tabs, reusing `SettingsField`-style shared rows
(moved to ArgusUI if not already):

- **General**: Open at Login, Install Automatically When Idle, update channel,
  telemetry consent (Off / Presence / Full — there is no onboarding to ask).
- **Account & Remote**: the computer-settings table from `docs/accounts.md`
  (use the account, service URL, iPhone/browser grant, Mac/desktop grant,
  publish LAN/Tailscale/Cloudflare, managed tunnel, approve from this
  computer, name) and the paired-devices list with grants/revoke.

Everything else (Claude accounts, MCP, LLM runners, tools) is managed from a
paired admin desktop, as today.

## 7. Telemetry

Host events are already captured by the host (`agent_started`,
`session_created`, account/tunnel events…); the server sends nothing for those.
New Swift enum `ServerTelemetryEvent` (enum-with-payload; wrong props fail to
compile), same consent gating.

| Event                    | When                                     | Props                                                                                                                                                         |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mac_server_launched`    | App start                                | `login_item` (`enabled`, `requires_approval`, `off`), `launched_by_launchd` bool                                                                              |
| `mac_server_host`        | Supervisor events (mirrors `mac_host_*`) | `stage` (`started`, `crashed`, `gave_up`, `lock_conflict`, `handover`), `restarts`, `exit_code`, `holder` (`electron`, `mac`, `mac_server`, `cli`), `success` |
| `mac_server_menu_action` | Menu/window action                       | `action` (`pair`, `link`, `approve_join`, `deny_join`, `rename`, `unlink`, `toggle_tunnel`, `open_web`, `open_logs`, `restart_host`, `quit`)                  |
| `mac_server_pairing`     | Pairing settled                          | `stage` (`confirmed`, `rejected`, `failed`, `cancelled`), `grant` (`monitor`, `control`, `admin`, `none`)                                                     |
| `mac_server_update`      | Update step                              | `stage` (`checked`, `downloaded`, `installed`, `blocked_by_agents`, `auto_installed`, `failed`)                                                               |
| `mac_server_login_item`  | Toggled                                  | `enabled`, `status`                                                                                                                                           |
| `mac_server_migrated`    | Old Electron server replaced             | `from` (`electron_agent`, `electron_running`), `success`                                                                                                      |

No names, paths, URLs, codes. Document all in `docs/telemetry-events.md`
(`telemetryDocs.test.ts` must see the Swift catalog — extend it to read
`ServerTelemetryEvent.swift`).

## 8. Migration from the Electron server

Same bundle id + same Developer ID team → same designated requirement, so TCC
grants (Full Disk Access, Accessibility, Screen Recording for the sim bridge)
and `~/Library/Preferences/dev.houwert.argus.server.plist` carry over.

| Concern                       | Plan                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State dir                     | Same `~/.argus-server`: worktrees, `repo-roots.json`, `tools.json`, `app-settings.json`, account keys, chat history are host-owned and already shared format                                                                                                                                                                                                          |
| Secrets                       | `remote-devices.json`/`mcp-tokens.json` must be in the keychain format ("Argus Host Secret Storage" for that home). Require the last Electron server release to have run once (same rule as `docs/mac-app.md`); if not, the menu shows "Paired devices still in the old format — open the old Argus Server once" and remote stays off (reuse the Mac app's detection) |
| Running Electron server       | Lock owner `electron` → menu: **Take Over from the Old Argus Server** → `takeOver()` (SIGTERM, wait for release, launch)                                                                                                                                                                                                                                              |
| Old launch agent              | On first run, if `~/Library/LaunchAgents/dev.houwert.argus.server.plist` exists: `launchctl bootout gui/$UID/dev.houwert.argus.server`, move the plist to `~/.argus-server/migrated/`, register the `SMAppService` agent. Ask once in a window (it changes what starts at login)                                                                                      |
| `pnpm server:install-agent`   | Keep for the Electron build until it's removed; print a deprecation note pointing at Open at Login                                                                                                                                                                                                                                                                    |
| Old app in `/Applications`    | Native release ships as `Argus Server.app`; Sparkle/the user replaces it in place. Optional: final Electron server release delivers the native zip through its updater (Squirrel.Mac checks the same DR, which the native app satisfies) — open question                                                                                                              |
| `server_auto_install_updates` | Same key, same file                                                                                                                                                                                                                                                                                                                                                   |
| Rollback                      | Re-installing the Electron server works: same home, same lock protocol; it re-installs its plist with `server:install-agent`                                                                                                                                                                                                                                          |

## 9. Docs to update

- `docs/server-app.md`: rewrite around the native app (menu, Open at Login,
  account section, updates via Sparkle, migration); keep a short "Electron
  server (deprecated)" section until removal.
- `docs/accounts.md`: "Linking a computer" and the naming table gain the
  Argus Server menu row; drop "the tray does not offer linking yet".
- `docs/mac-app.md`: "Under the hood" mentions the server sibling.
- `docs/telemetry-events.md`: §7 events.
- `plan/swiftui-parity.md`: Argus Server row → Mac ✅ with this plan linked.
- `CLAUDE.md`: `xcodebuild -scheme ArgusServer` command, Debug home
  `~/.argus-mac-server-dev`, never point a dev server at `~/.argus-server`.
- Changesets (`argus`, `minor`) per user-visible phase.

## 10. Tests

| Layer                                 | Test                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host                                  | `hostEnv`/`hostArgs` tests for `--server` (env, port, owner, forceRemote, power assertion, quit drain); `hostLock` accepts `mac-server`                                                                                                                                                       |
| ArgusCore (`swift test`)              | `HostSupervisor` launches with `--server` for `.server` mode; `HostLockRecord` decodes `mac-server`; `HostLinkModel`/`PairingModel` state machines (moved, existing behaviour pinned first)                                                                                                   |
| ArgusServer unit (`ArgusServerTests`) | `ServerMenuModel` snapshots for every pairing/link/update/host state, agent-count guard, install-when-idle trigger; migration detector (old plist present, lock owner `electron`)                                                                                                             |
| Typetests                             | Telemetry docs test covers `ServerTelemetryEvent`                                                                                                                                                                                                                                             |
| CI                                    | `xcodebuild -scheme ArgusServer -destination 'platform=macOS' build` (+ `test`) alongside ArgusDesktop                                                                                                                                                                                        |
| Manual (mini)                         | Fresh install, login item approve, reboot with auto-login, kill -9 host (supervisor restarts), kill -9 app (launchd restarts), pair phone, link + approve, tunnel reach from LTE, update blocked while agent runs, idle auto-install, migration from a running Electron server with its plist |

Never test against a live `~/.argus-server`: Debug uses its own home and port.

## 11. Phased rollout

Status: ✅ 0, ✅ 1, ✅ 2, ✅ 3 (code; first release needs the Sparkle key and the
proxy serving the appcast, below), ✅ 4, ⏸ 5 (held, §13).

| Phase                  | Scope                                                                                                                                                                           | Acceptance                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Refactor            | Move `HostLocation`, link/pairing models, QR/SAS views, telemetry client to ArgusCore/ArgusUI; `HostSupervisor` mode; host `--server` mode + `mac-server` owner                 | Mac app unchanged (tests green, manual smoke); `argus-host --server` under a supervisor behaves per §4 table                                                 |
| 1. Target + host       | `ArgusServer` target, LSUIElement, bundled host, status + agents sections, Quit, Open Logs/Web Client/State, host restart, Debug home/port                                      | Debug build runs next to Mac app and Electron desktop without lock conflicts; web client loads from 47619; crash restart observed                            |
| 2. Pairing + account   | Pairing window, account link/approve/rename/unlink/tunnel, notifications, minimal Settings, telemetry                                                                           | Phone pairs via QR/code with grant choice; host links with a code and approves a phone join; menu labels match the Electron tray; telemetry docs test passes |
| 3. Lifecycle + release | `SMAppService` agent, Open at Login, Sparkle + guard + install-when-idle, `mac_server_release` lane, notarized zip + appcast                                                    | Notarized build passes `spctl -a -vv`; survives reboot on an auto-login mini; update refuses while agents run and auto-installs when idle                    |
| 4. Migration + cutover | Old plist migration, takeover flow, secrets-format check, docs, changeset; Electron server marked deprecated                                                                    | A mini running the Electron server + plist switches with one confirmation, keeps paired devices, account link, TCC grants and worktrees                      |
| 5. Removal             | Delete `build:app:server`, `electron-builder-server.config.cjs`, `server.js` banner, `serverUpdates.ts`, server branches in `electron/main.ts` and tray, `server:install-agent` | After one release cycle with no Electron-server installs in presence telemetry                                                                               |

## 12. Decisions (were open questions)

1. **Bundle id**: reuse `dev.houwert.argus.server` (Debug `.dev`), so TCC grants
   and defaults carry over.
2. **Electron users move over through the Electron server's last update**:
   `electron/serverHandoff.ts` checks the native appcast and, from the menu or
   when idle, downloads, verifies (codesign, team, bundle id, not Electron) and
   swaps the app with a detached script that keeps the old app in
   `~/.argus-server/migrated/`. Squirrel.Mac could never update a server (the
   desktop feed's bundle id differs), so this replaces the server's updater.
   The Electron server also quits quietly when `host.lock` is held by
   `mac-server`.
3. **Lock owner** `mac-server` (TS + Swift; telemetry holder `mac_server`).
4. **Agent leaves** open the web client at `?agent=<id>`.
5. **`.menu` style** plus small windows: pairing (QR + SAS + grants), link
   code, join approval; alerts for rename, unlink, take-over, quit.
6. **Quit** asks when agents run: **Quit** drains (`stopAgentsForQuit`, 15 s
   supervisor cap), **Quit Now** stops after 2 s. SIGTERM (a take-over) drains.
7. **Sparkle** lives in the shared `clients/apple/ArgusUpdate` package
   (`StandardUpdater` for the Mac app's Check for Updates…, `MenuUpdater` with a
   custom user driver for the server's menu and its agents guard). Both stay
   inert until `SPARKLE_PUBLIC_ED_KEY` is set. Left to do before the first
   release: run Sparkle's `generate_keys` once, put the public key in CI's
   `SPARKLE_PUBLIC_ED_KEY` and the private one in `SPARKLE_ED_PRIVATE_KEY`, make
   the `houwert.dev/argus/updates` proxy serve `argus-server-<channel>.xml`,
   `argus-mac-<channel>.xml` and the zips, and call `mac_server_release` from
   the release workflow.
8. **`ARGUS_DEV_TRUST`** is set by Debug builds; the host arms it only when its
   resources aren't under an `Applications` folder (`devTrustAllowed`).
9. **Telemetry consent** defaults to presence; Settings → General changes it.
10. **Apple silicon only** (`ARCHS = arm64`), like the Electron server.

Also decided while building: the login agent plist is generated by a build
phase (`Tools/embed-login-agent.sh`) with label `<bundle id>.agent`, so Debug
and Release register apart; the old launch agent is replaced only after a
one-time prompt (or **Start at Login with This App…**), moving its plist to
`~/.argus-server/migrated/` and leaving a running old job to end at logout;
"Install Automatically When Idle" also downloads, since nobody is there to
click Download on an unattended mini.

## 13. Phase 5 follow-up (the release after the hand-off build)

Held so the hand-off build can still ship from the Electron server target.
Once a release with `electron/serverHandoff.ts` is out and presence telemetry
shows no Electron server installs for a cycle, remove:

- `package.json`: `build:app:server`, `dev:server`, `server:install-agent`.
- `scripts/electron-builder-server.config.cjs`, `scripts/install-server-agent.sh`,
  `build/dev.houwert.argus.server.plist`.
- `build-electron.mjs`: the `dist-electron/server.js` banner entry.
- `electron/serverHandoff.ts`, `electron/serverHandoffModel.ts` (+ test), the
  `electron_server_handoff` event (`telemetryEvents.ts`, docs).
- `electron/main.ts`: every `isServerMode()` branch (userData name, protocol
  claim, window creation, headless platform, forceRemote, tray host lines, the
  hand-off init).
- `electron/hostLockGate.ts`: the `mac-server` quiet-quit branch.
- `electron/services/tray/index.ts` and `accountTray.ts`/`accountMenu.ts` (+
  test): the server-mode sections (account, pairing, hand-off rows); the
  desktop tray keeps its agent tree.
- `packages/host/src/services/remote/serverPairing.ts` if nothing else uses it.
- `.argus.json`: the "Dev: Server" run command.
- `docs/server-app.md`: the "Electron server (deprecated)" section.

The host side stays: `ARGUS_SERVER`/`isServerMode()` is what `--server` and
`argus-host` run on.
