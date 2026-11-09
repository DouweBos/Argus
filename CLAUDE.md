# Argus

Agentic IDE for front-end development: Argus for Mac (native SwiftUI over a Node host core), an iPhone client and a web client. Multiple Claude Code agents work in parallel, each in an isolated git worktree, with an embedded browser, iOS simulators and Android emulators.

Argus for Mac replaced the Electron app in v0.72.0, and the Electron app has since been removed. Production Mac releases still publish `cutover-mac.yml`, the feed still-installed Electron apps update into Argus for Mac from — keep it.

## Commands

- `pnpm build` — type-check every package, build the host (`dist-host`) and the web client
- `pnpm lint` — `pnpm typecheck && eslint && prettier --check`, plus the CSS-module, import-cycle and Swift style checks and `pnpm gen:protocol --check`
- `pnpm build:mac-host --out <dir> [--sign <identity>]` — stage Node + `dist-host` + node-pty + resources for the Mac app (its Xcode build phase runs it)
- `swift test` in `clients/apple/{ArgusKit,ArgusCore,ArgusUI}`; `xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusDesktop -destination 'platform=macOS' build` for the Mac app (`test` runs `ArgusDesktopTests`). Debug Mac builds ("Argus Dev") default to `~/.argus-mac-dev` — never point a dev build's `ARGUS_HOME` at `~/.argus`; `ARGUS_ATTACH_HOME=~/.argus` is allowed, since it only ever attaches as a client to the Argus running there (no host, no lock, no migration). Never drive the running Argus with UI scripting
- TestFlight: the `TestFlight` workflow runs `bundle exec fastlane ios testflight` (version from `package.json`, build = commit count). `fastlane ios testflight_setup` once, locally, creates the App Store Connect app and its App Store profiles
- `pnpm gen:protocol` — regenerate ArgusKit's Swift wire types (`ArgusKit/Sources/ArgusKit/Generated/`) from the command catalog
- `pnpm dev:host` / `pnpm start:host` — the host core as a plain Node process (`dist-host/argus-host.js`, no Electron). Prints the gateway address; type `pair` to pair a device from the terminal
- `pnpm storybook` — Peacock design system at :6006
- Tooling via `mise.toml` (node 24, pnpm 10)

## Architecture

pnpm monorepo. Three-panel layout: workspace sidebar / agent control / runtime & testing.

- `packages/peacock` → `@argus/peacock` design system (tokens, icons, components)
- `packages/host` → `@argus/host` host core — sessions, agents, git, terminals, simulators, the command registry. **Plain Node, never imports `electron`** (enforced by `packages/host/src/noElectron.test.ts` and a `no-restricted-imports` rule)
- `packages/remote-protocol` (the command catalog, wire models, capabilities), `packages/client-core` and `packages/remote-client` → shared by the host and the web client
- `clients/argus-web` → the web client (React + Vite), served by the host to paired browsers and hosted at `houwert.dev/argus/app/`
- `clients/apple` → the native Swift apps, one Xcode project (`ArgusRemote.xcodeproj`):
  - `ArgusKit` (protocol, Noise, generated wire types, `Transport` for the gateway, `LocalTransport` for the host's UI socket), `ArgusCore` (the shared stores behind a `HostBackend`: `GatewayBackend` for the phone, `LocalBackend` for the Mac; the transcript reducer; `HostSupervisor`; no SwiftUI), `ArgusUI` (design system + shared views, iOS 18 and macOS 15)
  - `ArgusRemote` — the iOS app shell. `ArgusDesktop` — Argus for Mac, the desktop app (see `docs/mac-app.md`): bundles and supervises the Node host and talks to it over `$ARGUS_HOME/host.sock`

### Web client (`clients/argus-web`)

React 19 + TypeScript + Vite 7, Zustand stores, CSS Modules colocated with components. Talks to the host's gateway over the Noise channel like the phone does; see `clients/argus-web/README.md`.

### Host core (`packages/host`)

Node.js + TypeScript. No Electron — a Linux box or a CLI can run it.

- `src/state.ts` — `AppState` singleton with `Map`s (no locking; Node is single-threaded)
- `src/platform.ts` — `HostPlatform`: the seam for everything plain Node can't do, provided by the app around the host over its UI socket (`openExternal`, `openPath`, `revealInFinder`, `secretStorage`, `appVersion`, `isPackaged`, `resourcesPath`, `userDataPath`, `notify`, `isForeground`, `focusUi`, `closeDevicePopout`). `nodeHostPlatform()` is the headless implementation; every capability degrades to a documented no-op
- `src/boot.ts` — `startHost()` / `shutdownHost()`: everything the core runs, shared by the desktop and `src/bin/argus-host.ts`
- `src/commands/<domain>.ts` — every host command, registered with `defineTypedCommand` against the catalog in `packages/remote-protocol/src/commands/`
- `src/bus.ts` — transport-agnostic event fan-out. Services call `emitHostEvent(channel, payload)`; transports register an `addHostEventSink`
- `src/services/` — one dir per domain: `session/` (git worktree + setup + merge), `agent/` (Claude Code subprocess, stream-json), `terminal/` (node-pty), `simulator/` (simctl + native bridge), `file/`, `command/` (the registry), `remote/` (the Noise/WS gateway)
- `native/argus-sim-bridge/` — standalone Swift/ObjC binary for simulator capture + HID injection, JSON-over-stdio

## Conventions

**File size:** target <500 lines; split responsibilities when approaching. Components <300 lines — extract subcomponents/hooks/pure logic. Keep orchestrators thin.

**Backend:**

- Host commands are `snake_case`
- `child_process.execFile` for git (not libgit2); `node-pty` for terminals
- Throw string errors from command handlers
- Events: `emitHostEvent(name, payload)` from `@argus/host/bus` — never reach for a transport from a service
- Need the app around the host (browser, keychain, notification, window)? Add it to `HostPlatform`
- Access `appState` directly

**Web client:**

- CSS Modules only — no inline styles, no global class names
- Zustand: plain `create<State>()`, no providers

**Routing** (the route is the single source of truth for which screen shows; full inventory in [`docs/routing.md`](docs/routing.md) — update when adding/renaming/removing routes):

1. Every screen has a route. New screens → add it to `ArgusRoute` (`clients/apple/ArgusCore/Sources/ArgusCore/Routing/`, the Mac and the phone) and, when the web client has the screen, to `packages/client-core/src/routes/route.ts`, then doc it.
2. On the Mac, navigate through `DesktopModel.navigate`, one navigation per user action (two back-to-back stack history and break the back button).
3. Read the route, don't mirror it — no separate "which screen" state.
4. **Prefer routes over ad-hoc state for switching views inside a screen.** If a tab, sub-view, sidebar selection, or filtered drill-down (e.g. focused branch/tag/file) changes what the screen shows, give it its own route. That makes "which item is selected" a single route-equality check, gets back/forward and deep links for free, and prevents two pieces of state disagreeing about what's active.

**Design system (`@argus/peacock`) — all of the web client's visuals come from Peacock** (the Mac and iPhone apps use ArgusUI):

1. Check Storybook first. If something fits, use it.
2. Missing/new variant → add to `packages/peacock/src/components/` with `.module.css` + `.stories.tsx`. No duplicate one-offs in `clients/argus-web`.
3. App-specific components wire transport/state but compose Peacock primitives.
4. Tokens live in `packages/peacock/src/styles/tokens.css`. Need a new one → add it there (both dark + light), document in Tokens story.
5. **Only tokens — never hardcoded colors.** No hex, no `rgba()`/`hsl()` with numbers, no `var(--token, #fallback)`, no inline `style={{ color: "#..." }}`. Hardcoded colors silently break the opposite theme. Exceptions (project-accent palette, git-graph palette, traffic lights, folder tints) all live behind named tokens in `tokens.css`. Use `color-mix(in srgb, var(--token) N%, transparent)` for custom alphas.
6. Icons: `Icons` from `@argus/peacock` only. No Lucide/Heroicons/icon fonts. Missing icon → add to `packages/peacock/src/icons/Icons.tsx` at matching stroke weight.
7. **No inline `<svg>` in `clients/argus-web`** (most common violation). Every SVG — icons, badges, shapes, data-viz (graphs, charts, sparklines, arcs), loaders, illustrations — belongs in `packages/peacock/src/components/<Name>/` with a story. Data-driven too: extract the pure renderer, move its types/constants (palettes, row shapes) into Peacock, compose from the app. Before adding a primitive, `grep -r '<svg' packages/peacock/src` for existing coverage.
8. **Never hand-roll dialog padding.** A `Dialog`'s children go in `DialogBody` (+ `DialogFooter` as a sibling, never nested inside the body) from `@argus/peacock`. Bespoke `.body { padding: … }` drifts out of line with the dialog header — that's how nine different paddings happened. Body needs no padding → `<DialogBody flush>`.
9. No emoji, third-party UI kits, or Tailwind. Peacock is the only UI layer.

Every Peacock component ships with a Storybook story covering meaningful states.

**Command contract (adding a command):**

1. Handler in `packages/host/src/services/<domain>/`
2. Catalog entry in `packages/remote-protocol/src/commands/<domain>.ts` — `{ tier, params, result, tool? }` zod schemas; result models in `models/<domain>.ts`. Params keep the wire keys the sender uses (camelCase args stay camelCase). A model mirroring a host interface gets an `Expect<Equal<…>>` check in `packages/host/src/commands/<domain>.typetest.ts`
3. Register in `packages/host/src/commands/<domain>.ts` via `defineTypedCommand("command_name", (p) => …)` — params are validated at dispatch, results checked in dev and tests
4. `pnpm gen:protocol` to regenerate the Swift types

**The Mac app is the desktop app.** Every desktop feature lands in `ArgusDesktop` (plus host commands), with the iPhone client in the same PR. Releases ship it with `fastlane mac mac_app_release` (the release workflow).

**Design a screen, don't just expose its fields.** Before building UI, find the screen that already does the same job (picking projects, editing a playbook, a run history) and reuse its components — two screens choosing the same thing must look and work the same. Extract the shared piece rather than copying it. Lists get one row per item with an icon and a trailing control, never a column of controls inside a `LabeledContent`; the primary action goes in the toolbar, not a section header; long multi-selects get Select All / Clear. Then launch a dev build (`ARGUS_DEV_ROUTE`, `ARGUS_ATTACH_HOME=~/.argus`), screenshot the window and look at it with real data before calling it done — compiling is not a design review.

**Mac app: everything clickable shows the pointing hand.** SwiftUI never does this on its own, so it goes through ArgusUI (`DesignSystem/Clickable.swift`):

- `.buttonStyle(.argusPlain)` / `.argusBorderless` — never `.plain` / `.borderless`
- `.clickable()` on anything made clickable another way (`onTapGesture`, `Menu`, `Link`); `.clickable(false)` while it isn't (e.g. renaming)
- A new custom `ButtonStyle` applies `.clickable()` in its `makeBody`
- Never call `.pointerStyle` directly. Native `.bordered` / `.borderedProminent` buttons keep the macOS arrow

**The iOS client is a first-class citizen.** Every feature you add or change on the desktop also lands in `clients/apple` in the same PR. The only excuses are that it genuinely makes no sense on a phone (window management, tray, simulator HID injection) or that exposing it over the gateway is a real security risk — say which, don't just skip it. "Desktop first, phone later" is how the phone falls behind.

Adding one (worked example: `automations.revise_playbook`):

1. Method + params/results in `packages/remote-protocol/src/messages.ts`
2. Tier in `packages/remote-protocol/src/capabilities.ts` (`monitor` reads, `control` anything that acts or spends), scope rule in `scope.ts` — `Record<RemoteMethod, …>` means both fail to compile until decided
3. Handler in `packages/host/src/services/remote/capabilities.ts`, reusing the same host service the host command calls. Wrap in `control()` only when host state actually changes
4. `RemoteMethod` case in `ArgusKit/Sources/ArgusKit/Protocol/Envelopes.swift`, then a store method in `ArgusRemote/Stores/`
5. UI in `ArgusRemote/Views/` or `Screens/`, gated on `app.hasControl` when the method is control-tier
6. A new Swift file in `ArgusRemote` needs four `project.pbxproj` entries by hand (build file, file reference, group child, sources phase). Shared code belongs in `ArgusCore`/`ArgusUI` (SPM, no pbxproj edits); `ArgusDesktop` uses a file-system-synchronized group
7. Verify with `xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusRemote -destination 'generic/platform=iOS Simulator' build` — `pnpm lint` does not see Swift

**Worktrees:** `~/.argus/worktrees/{RepoName}-argus-worktrees/{branch}/`. Post-`git worktree add` setup (copy dirs, symlink files, run commands) configured in `.argus.json`.

**Plan files:** write to `plan/` in the repo root (gitignored, never published), never `docs/` (which is published to the website).

**Commit when a thing is done.** Every feature, fix or refactor gets its own commit the moment it works — don't leave finished work sitting in the tree waiting for the end of the session. One commit per feature/fix, with its tests, docs and changeset in it, so each one stands alone and is revertable. Several unrelated changes already piled up in the tree → split them by hunk rather than committing one lump. Committing is not pushing: push only when asked.

**Commit messages:** Conventional Commits — `type(scope): subject`, one short single-sentence subject, lower case, no trailing period. No body paragraphs, no bullet lists, no `Co-Authored-By` trailer.

- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `chore`. A breaking change is `!` after the scope (`feat(remote)!: …`).
- The scope is the area, not the path — existing ones include `remote`, `ios`, `peacock`, `llm`, `terminal`, `automations`, `devices`, `push`, `settings`, `mcp`, `web`. Reuse one before inventing another; drop it entirely when a change is genuinely repo-wide.
- The type has to match the changeset: a `feat` is a `minor`, a `fix` is a `patch`, and anything with no changeset should not be a `feat` or a `fix`.

**Changesets:** every user-visible change gets one in `.changeset/`. Written for end users: 1–2 short sentences, present tense, no internals/file paths/type names. Bump `argus` for app changes, `@argus/peacock` for public design-system changes. `patch` for fixes, `minor` for new behavior. Skip for pure refactors/tests/tooling.

**Telemetry: a feature ships with the events that measure it.** Every user-facing behaviour you add or change gets events in the same commit — "there is no event for it yet" is a gap to close, not a reason to skip it. Ask what question the event answers ("is this used?", "does it fail?") and send the smallest thing that answers it.

1. Host/desktop → add the name and prop shape to `EventMap` in `packages/host/src/telemetryEvents.ts`, capture from the host service that does the work.
2. iOS → add a case to `TelemetryEvent` in `clients/apple/ArgusRemote/Telemetry/TelemetryEvent.swift` and capture at the call site. Enum-with-payload there, `EventMap` here: wrong props must fail to compile.
3. **Never double-count.** If the host already captures something when the phone asks for it (`agent_started`, `session_created`, `session_merged`), the phone sends nothing. iOS events cover what the host cannot see: app lifecycle, navigation, pairing, and phone-local actions.
4. Group by verb rather than minting a name per button — one event with an `action` enum (`ios_work_landed`, `ios_agent_controlled`) keeps the catalog readable.
5. **Document it in [`docs/telemetry-events.md`](docs/telemetry-events.md)** — name, when it fires, every prop. That file is published to the website and is the overview people are owed. `packages/host/src/telemetryDocs.test.ts` reads both catalogs and the doc and fails on any disagreement: an undocumented event or prop, a documented event no catalog has, or a catalog entry nothing ever captures. Don't weaken the test to land a change — document the event.
6. **Privacy is the hard constraint.** Never send prompts, file contents, agent output, project / repo / branch / session / automation names, host or device names, paths, URLs, or anything the user typed. Send booleans, counts, enums and buckets instead (`has_images`, `length_bucket`, `success`). Screen names are route patterns, never identifiers. Messages and stack traces go through the scrubbers.
7. Errors ride the existing sinks — `log.error` / `setErrorSink` on the host, `AppStore.report` / a store's `fail(_:_:)` on iOS. Don't open a second error path.
8. Consent gates everything: `presence` sends only the launch heartbeat, the catalog is `full`-only, and no key configured means nothing is sent at all.

**Configurability of new features:** when adding a feature, ask whether the user might reasonably want to customize it. If yes, expose it as a setting:

- **App-level** (per developer, machine-local) → add it to the host's `app-settings.json` (`AppSettings` in `packages/remote-protocol/src/models/settings.ts`, stored by `packages/host/src/services/appSettings/store.ts`), or to `AppPreferences` (`UserDefaults`) for a Mac-only view preference; surface it in the Mac app's Settings window (`clients/apple/ArgusDesktop/Settings/`) and document it in [`docs/app-settings.md`](docs/app-settings.md). Per-project personal prefs (e.g. branch prefix) go in `~/.argus/user-project-settings.json` instead — see `packages/host/src/services/userProjectSettings/store.ts`.
- **Project-level** (shared with the team, checked in) → add the field to `ArgusConfig` in `packages/host/src/services/session/models.ts`, parse/normalize it in `packages/host/src/services/session/setup.ts`, optionally extend onboarding inference in `packages/host/src/services/onboarding/argusJson.ts`, **wire it into the Mac app's Project Settings sheet** (`clients/apple/ArgusDesktop/Project/`, drafted by `ArgusConfigDraft` in ArgusCore) so it's editable in-app, and document in [`docs/project-settings.md`](docs/project-settings.md). Never mark a new project setting as "hand-edit only" in the docs unless the user explicitly asks for it — the sheet is the default surface.

If the new setting needs UI primitives ArgusUI doesn't have, add them to ArgusUI first.

## Key technical decisions

- `node-pty` for terminals (same as VSCode) — spawn at 80x24, resize
- Git CLI via `child_process.execFile` — better worktree support than libgit2
- Claude Code as subprocess with `--output-format stream-json` (piped stdio, not PTY)
- Simulator bridge as standalone macOS binary over JSON-over-stdio — uses private frameworks that can't run in Node
- Worktrees outside project dir to keep user's repo clean
