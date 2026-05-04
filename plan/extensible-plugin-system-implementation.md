# Implementation plan — extensible plugin system

Companion to `extensible-plugin-system.md`. That document is the architecture; this one is the build order.

Work is grouped into 14 sequential chunks. Each chunk is **independently green** (compiles, lints, type-checks, doesn't break the running app) so the PR can be reviewed commit-by-commit even though it lands as one. Behavior only changes meaningfully at chunks 11 and 12 — everything before that is plumbing.

---

## 1. Types and constants

**Goal.** Lay down the type surface so every later chunk has stable imports.

**Files (new):**

- `app/plugins/types.ts` — `PluginId`, `PluginGroup`, `PluginManifest`, `PluginAsset`, `ToolRailContribution`, `RuntimeModeContribution`, `SettingsSectionContribution`. Exports `PLUGIN_IDS` const tuple.
- `electron/services/plugins/types.ts` — re-exports the renderer types. Backend imports from here so the dependency direction is `electron → app/plugins/types`.

**Behavior:** none. Pure types.

**Verify:** `pnpm lint` clean. `PluginId` referenced by no one yet.

---

## 2. Registry

**Goal.** Declare the four v1 plugins.

**Files (new):**

- `app/plugins/registry.ts` — exports `PLUGINS: PluginManifest[]`. Fill in for each of `device-recording`, `device-inspector`, `device-control`, `device-debug`:
  - `defaultEnabled: true` (temporary — flipped to `false` in chunk 12)
  - `bundled: true, lazy: false` (temporary — flipped in chunk 11)
  - `requires`, `prereqs`, `assets`, `contributes` per the architecture doc's tables
- `app/plugins/index.ts` — barrel export.

**Behavior:** none. Manifest array is unread.

**Verify:** lint + a unit test (`app/plugins/registry.test.ts`) asserting every `requires` and `prereqs` reference resolves, no cycles, every contribution id is unique across manifests.

---

## 3. Plugin store (renderer)

**Goal.** Persist enable/disable state, expose hooks.

**Files (new):**

- `app/plugins/store.ts` — Zustand store mirroring `settingsStore.ts` patterns. Persists to `localStorage["argus:plugins"]` as `{ enabled: PluginId[] }`. Loads at module init from registry's `defaultEnabled`. Exposes:
  - `setPluginEnabled(id, on)`, `usePluginEnabled(id)`, `useEnabledPluginIds()`
  - `useEffectivePluginEnabled(id)` — returns `enabled[id] && all(requires).every(useEffectivePluginEnabled)`
  - `useEnabledToolRailContributions()`, `useEnabledRuntimeModes()`, `useEnabledSettingsSections()` — read registry, filter by effective-enabled
- `app/plugins/store.test.ts` — covers `requires` cascading and project-disable mask (mask integration deferred to chunk 9 but the function shape lands now).

**Behavior:** state exists but nothing reads it. Settings localStorage key appears.

**Verify:** unit tests pass. Manually: `localStorage.getItem("argus:plugins")` shows the default-enabled set after first load.

---

## 4. Plugin store (main)

**Goal.** Backend has the same view, persists independently.

**Files (new):**

- `electron/services/plugins/state.ts` — `getEnabledPlugins(): Set<PluginId>`, `setEnabledPlugins(ids)`, `pluginEnabled(id): boolean`. Persists to `~/.argus/plugins.json` (alongside the existing onboarding state). On startup, reads disk; if absent, seeds from registry defaults.
- `electron/ipc.ts` — register `set_enabled_plugins` and `get_enabled_plugins` handlers.
- `app/lib/ipc.ts` — typed wrappers `setEnabledPluginsIpc`, `getEnabledPluginsIpc`.
- `app/lib/types.ts` — shared payload type.

**Wire:** `app/plugins/store.ts` calls `setEnabledPluginsIpc` after every `setPluginEnabled` (debounced 100ms). On app start, the renderer reads from disk via `getEnabledPluginsIpc` and reconciles with localStorage (disk wins — backend ran first).

**Behavior:** disk and localStorage both track state. No surface gating yet.

**Verify:** toggle via devtools console, restart app, state persists. Disk file has the union.

---

## 5. ToolRail becomes contribution-driven

**Goal.** Move `simulator` and `debug` from hardcoded arrays into the registry. `terminal`, `changes`, `notifications` stay core (not plugins).

**Files (modified):**

- `app/stores/layoutStore.ts` — `ToolId` becomes `string`. `TOOL_PLACEMENT` becomes a `Map<string, ToolPlacement>` populated lazily (core entries hardcoded, plugin entries merged from `useEnabledToolRailContributions()`). `mountedToolIds` becomes `Record<string, boolean>`. Replace the literal-typed defaults with a helper.
- `app/components/toolrail/ToolRail/ToolRail.tsx` — merge core tools (`changes`, `terminal`, `notifications`) with `useEnabledToolRailContributions()`. Drop the hardcoded `simulator` and `debug` entries.
- `app/components/toolrail/ToolPanel/*` — render switch becomes a lookup: `contribution.render()` for plugin tools, hardcoded JSX for core tools.
- `app/plugins/registry.ts` — `device-recording` contributes `simulator`, `device-debug` contributes `debug`.

**Behavior:** identical to today. UI is now plugin-shaped but every plugin is `defaultEnabled: true`.

**Verify:** click each toolrail icon, panels work, layout state persists across restart. Type-check confirms no remaining `ToolId` literal-union users.

---

## 6. RuntimeView modes become contribution-driven

**Files (modified):**

- `app/components/runtime/SimulatorView/RuntimeView.tsx` — `SegmentedControl` `options` come from `useEnabledRuntimeModes()`. `Simulate` is core (always present). `Inspect` is contributed by `device-inspector`. `InspectionPanel` only mounts when `inspect` is in the active modes.
- `app/plugins/registry.ts` — `device-inspector` contributes `runtimeMode: "inspect"`.

**Behavior:** identical. Inspector still shows up because `device-inspector` is enabled by default.

**Verify:** runtime toggle still flips between Simulate and Inspect; inspector overlays still render.

---

## 7. IPC gating layer

**Goal.** Every plugin-owned IPC handler early-rejects when its plugin is disabled.

**Files (modified):**

- `electron/ipc.ts` — wrap each plugin-owned handler body in:
  ```ts
  handle("start_debug_stream", async (a) => {
    if (!pluginEnabled("device-debug")) throw "device-debug plugin disabled";
    // existing body…
  });
  ```
  Apply to: all conductor handlers (~10), `start_debug_stream`, `run_oneshot_debug_command`, simulator capture handlers, inspection capture, deeplink open, conductor input on web browser view.
- `app/lib/ipc.ts` — typed wrappers swallow `"plugin disabled"` errors and return a sentinel where callers expect best-effort. Most call sites already handle "best-effort with `.catch(() => {})`" so this is mostly a no-op.

**Behavior:** identical (everything still enabled). Disabling a plugin via devtools now silences its IPC.

**Verify:** unit test on each handler asserting it rejects when disabled. Manual: disable `device-debug` in devtools, the Debug toolrail panel still mounts (chunk 5 already gated visibility but extra defense is cheap), but if it tried to call `start_debug_stream` it would error.

---

## 8. Asset resolver (compat mode)

**Goal.** All read paths for plugin assets go through one function. Initially returns bundled paths; lazy fetch comes in chunk 11.

**Files (new):**

- `electron/services/plugins/assets.ts`:
  ```ts
  export function resolveAssetPath(pluginId, assetName): Promise<string>;
  export function ensureAssetCached(pluginId): Promise<void>; // no-op when bundled
  export function clearAssetCache(pluginId, version?): Promise<void>; // GC
  ```
  Phase-1 implementation: `<userData>/plugins/<app-version>/<plugin>/<asset>` if cached, else `<resourcesPath>/<asset>` (current bundled path), else throw. Cache check uses a sidecar `.installed` file with sha256 from the embedded manifest (chunk 13's release script writes that manifest into the app at build time).
- `electron/services/plugins/manifest.json` — embedded at build time, lists asset names + checksums for the current app version. Initially hand-authored (one entry per asset). Chunk 13 generates it.

**Files (modified):**

- `electron/services/cli/conductor.ts` — `getConductorDir()` calls `resolveAssetPath("device-control", "conductor")`.
- `electron/services/simulator/bridge.ts` — sim-bridge path resolution.
- Anywhere else reaching into `process.resourcesPath` for a plugin asset (grep the four asset names).

**Behavior:** identical. Resolver hits the existing bundled path because nothing is cached yet.

**Verify:** every existing flow that uses these binaries still works — boot a sim, run conductor, etc. `pnpm dev` and packaged build both work because the resolver handles dev (`native/`) and packaged (`extraResources`) layouts.

---

## 9. Project-level disable mask

**Files (modified):**

- `electron/services/session/models.ts` — add `plugins?: { disabled?: PluginId[] } | null` to `ArgusConfig`. Update `defaultArgusConfig()`.
- `electron/services/session/setup.ts` — parse + normalize.
- `app/components/sidebar/SetupConfigDialog/*` — checklist UI for disabling plugins per project.
- `app/plugins/store.ts` — `useEffectivePluginEnabled(id)` consumes the active session's config and ANDs against the user toggle.
- `docs/project-settings.md` — document.

**Behavior:** projects can mask out plugins. With no project config the surface is unchanged.

**Verify:** add `"plugins": { "disabled": ["device-debug"] }` to a test project's `.argus.json`, confirm Debug toolrail entry disappears for sessions in that project but reappears in others.

---

## 10. Settings → Plugins screen

**Files (new):**

- `app/components/shared/SettingsDialog/PluginsSection.tsx` — grouped list (one section header per `PluginGroup`), per-plugin row with: name, description, toggle, dependency hint when force-disabled, prereq panel (chunk 13 wires the live data; chunk 10 just shows static labels).
- `app/components/onboarding/PrereqRow.tsx` — extracted from `PreflightStep` so both surfaces share the row component.

**Files (modified):**

- `app/components/shared/SettingsDialog/SettingsDialog.tsx` — add `"Plugins"` section to `groups`.

**Behavior:** Settings has a working Plugins screen. Toggling triggers `setPluginEnabled` → backend mirror → IPC gating already in place.

**Verify:** flip toggles, observe the simulator/debug/inspect surfaces appearing/disappearing without restart. Prereq panel renders static text (filled in at chunk 13).

---

## 11. Lazy asset fetch + resolver phase 2

**Goal.** First chunk that actually changes user-visible behavior. Resolver downloads from the GH release on-demand.

**Files (modified):**

- `electron/services/plugins/assets.ts`:
  - `resolveAssetPath` checks cache, else awaits `ensureAssetCached`, else falls back to bundled (so partial rollouts during this chunk's review don't break).
  - `ensureAssetCached(pluginId)` — fetches `<reverseProxy>/releases/v<APP_VERSION>/<plugin>/<asset>-<arch>-<platform>.zip` per asset, verifies sha256 against embedded `manifest.json`, unzips/untars into `<userData>/plugins/<app-version>/<plugin>/`, writes `.installed` sentinel.
  - Concurrency: one download per asset at a time; multiple assets in parallel within a plugin.
  - GC at startup: keep current + previous `<app-version>/` dirs, delete the rest.
  - Progress events emitted as `plugin:download:{id}` for the Settings UI to render a progress bar.
- `electron/ipc.ts` — `download_plugin_assets(pluginId)`, `cancel_plugin_download(pluginId)`.
- `app/lib/ipc.ts` — typed wrappers + event subscription.
- `app/components/shared/SettingsDialog/PluginsSection.tsx` — wire toggle to call `download_plugin_assets` first; show progress; revert on failure.
- `app/plugins/store.ts` — toggle-on now resolves only after assets are cached. Block UI in a "Downloading…" state until done.

**Behavior:** assets still bundled (`bundled: true` in registry), so the cache miss path falls back to bundled and downloads never happen yet. The full download flow exists and is testable manually by deleting the bundled copy.

**Verify:** delete `native/argus-sim-bridge/...` in a dev build, toggle the plugin off and on — download triggers, progress shows, asset lands in `<userData>`. Re-enable shouldn't re-download.

---

## 12. The flip — defaults off, assets unbundled

**Goal.** Make the whole system live.

**Files (modified):**

- `app/plugins/registry.ts` — every plugin: `defaultEnabled: false`, `bundled: false`, `lazy: true`.
- `electron-builder.yml` — drop the four plugin entries from `extraResources`:
  - `argus-sim-bridge`
  - `argus-hotkey-bridge`
  - `scrcpy-server.jar`
  - the prepared `native/conductor/` tree (the `prepare-conductor.ts` script still runs at build time but its output is now packaged separately — see chunk 13)
- `scripts/prepare-conductor.ts` — output directory changes to `release/plugin-staging/device-control/` so chunk 13's release script picks it up.
- `electron/services/plugins/assets.ts` — drop the bundled-fallback branch (resolver now requires the cache). Add a clear error when an enabled plugin has no cached assets ("Plugin asset missing — re-enable from Settings").

**Behavior:** ⚠️ this is the user-visible cliff. Fresh installs have no plugins enabled and no assets bundled. The onboarding step (chunk 14) handles this gracefully; existing installs migrating across this commit see the four plugins flip to disabled. Settings → Plugins is the recovery path.

**Verify:** clean install + `pnpm build:app` — `.dmg` is materially smaller. Launch, no simulator/debug/inspector surfaces. Enable each plugin in Settings → assets download → surfaces appear.

---

## 13. Onboarding step + preflight filter + prereq panel

**Goal.** First-run users get the picker before preflight, and Settings prereq panels show live data.

**Files (modified):**

- `electron/services/onboarding/types.ts` — insert `"plugins"` between `"permissions"` and `"preflight"` in `ONBOARDING_STEPS`.
- `app/components/onboarding/OnboardingRoot.tsx` — switch case routes to new `PluginsStep`.
- `app/components/onboarding/PluginsStep.tsx` (new) — wraps `PluginsSection` with onboarding chrome ("Pick the tools you'll use…").
- `electron/services/onboarding/prereqs.ts` — already filterable. No change to the function itself.
- `electron/ipc.ts` — the preflight handler that calls `runPrereqChecks` derives the filter as `CORE_PREREQS ∪ flatMap(enabledPlugins, p => p.prereqs ?? [])`.
- `app/components/onboarding/PreflightStep.tsx` — passes the active set, no longer renders rows for non-active prereq ids.
- `app/components/shared/SettingsDialog/PluginsSection.tsx` — per-row prereq panel calls `runPrereqChecks` with that plugin's `prereqs` only, renders `PrereqRow`s including Fix actions.
- `electron/services/onboarding/types.ts` — optionally drop `mobileOnly` from `PrereqResult` (or leave as no-op).

**Behavior:** new users hit Plugins step before Preflight; their preflight is filtered. Existing users see no change to their already-completed onboarding but get the live prereq panel in Settings.

**Verify:** wipe `~/.argus/onboarding.json`, walk through onboarding picking only `device-control` for web. Preflight only checks core + `playwright`. Then go to Settings → Plugins → enable `device-recording`; the prereq panel runs `xcode`/`ios_runtimes`/`native_bridge`/`android_sdk`/`android_avd` checks live with Fix buttons.

---

## 14. Release pipeline + alpha/RC channels

**Goal.** GH releases publish plugin asset zips and a signed `plugin-manifest.json`; CI/CD supports alpha/RC builds from any branch.

**Files (new):**

- `scripts/release-plugins.ts` — invoked by Fastfile after notarization. Per asset:
  1. Determine arch/platform matrix.
  2. Stage into `release/plugin-staging/<plugin>/<asset>/`.
  3. Notarize each native binary (reuses existing API key path).
  4. Zip with `ditto` (preserves notarization staple).
  5. Compute sha256, append to `plugin-manifest.json`.
  6. Sign manifest with the same key used for `latest-mac.yml`.
  7. Upload all zips + signed manifest as assets on the current GH release.

**Files (modified):**

- `fastlane/Fastfile`:
  - `release` lane gains `channel:` parameter (default `"stable"`); sets `EP_CHANNEL` and `EP_PRE_RELEASE` env vars before electron-builder.
  - After electron-builder publishes, invoke `scripts/release-plugins.ts`.
  - Skip `git push origin main` and the website-dispatch when `channel != "stable"`.
- `.github/workflows/release.yml`:
  - `workflow_dispatch.inputs.channel`: choice `[stable, alpha, rc]`, default `stable`.
  - Drop `branches: [main]`. Add guard `if: inputs.channel != 'stable' || github.ref == 'refs/heads/main'`.
  - When `channel != "stable"`: run `pnpm changeset pre enter <channel>` → `pnpm changeset version` → `pnpm changeset pre exit` (without committing the exit), capture bumped version, tag `v<version>`, push only the tag (not the commit).
  - When `channel != "stable"`: skip CHANGELOG bump-and-push and website notification.
- `electron-builder.release.yml` — `publish.channel` and `releaseType` read from env.
- `app/stores/settingsStore.ts` — add `updaterChannel: "latest" | "alpha" | "beta"` (default `"latest"`).
- `electron/main.ts` (or wherever `autoUpdater` is configured) — pass `updaterChannel` into electron-updater's `channel` option.
- `app/components/shared/SettingsDialog/SettingsDialog.tsx` — add an "Advanced" section exposing the channel switcher (gated behind a hidden flag or a clear "Internal testers only" warning).
- `electron/services/plugins/manifest.json` (build-time generated) — populated by `release-plugins.ts`; chunk 8's hand-authored seed is replaced.
- `docs/releases.md` — document the three channels.

**Behavior:** CI can produce alpha/RC builds from any branch; their plugin assets are published under `v<version>-<channel>.<n>` tags. Stable users on `latest` channel never see them.

**Verify:** push a branch, run `release.yml` with `channel: alpha`, observe a prerelease GH release with both the `.dmg` and per-plugin asset zips. Install the alpha, flip `updaterChannel` to `alpha` in settings, toggle a plugin → assets fetch from the alpha release.

---

## Final state checklist

After chunk 14 lands:

- [ ] `pnpm build:app` produces a smaller `.dmg` (no plugin assets in `extraResources`).
- [ ] Fresh install → onboarding shows Plugins step before Preflight; user picks zero plugins → Preflight runs only the four core checks.
- [ ] Settings → Plugins shows grouped plugins; toggling each downloads assets from the GH release and surfaces enable.
- [ ] Project-level `plugins.disabled` masks per-project.
- [ ] CI workflow publishes alpha builds from any branch; stable users don't see them.
- [ ] Adding a future plugin = manifest entry + IPC group rejection + asset zip in the release pipeline. No edits to `ToolRail.tsx`, `RuntimeView.tsx`, `SettingsDialog.tsx`, or `electron-builder.yml`.

---

## Risk notes

- **Chunk 12 is the only one with a behavior cliff.** Land 1–11 first, validate end-to-end with a developer build (delete bundled assets manually to exercise the lazy path), then commit 12 last.
- **The conductor tree is the riskiest asset.** It's a node_modules tree containing thousands of files; tarball + untar must be deterministic across platforms. Use `tar -xf` from Node, not a JS tar implementation, to avoid extracting on case-insensitive filesystems incorrectly.
- **Notarization wall-clock per native binary is ~2 min.** Adding two notarized binaries to the release lane bumps total release time by ~5 min. Acceptable.
- **electron-updater channel switching has known caching quirks.** First run after switching channels may show "no update available" until the feed file is re-fetched; document this in `docs/releases.md`.
- **Existing installs after chunk 12 ship.** Their `~/.argus/plugins.json` won't exist → backend seeds from registry defaults (which are now `false`). The user opens the app and the simulator/debug/inspector are gone. Mitigation: a one-shot migration on first launch under the new version that flips every plugin to enabled if the user has any prior session/onboarding state. Implement this in chunk 4's `state.ts` initializer; document in the changeset.
