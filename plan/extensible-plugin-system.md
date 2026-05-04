# Extensible plugin system

First-party only. Goal: split bundled internal tooling into discrete units the user can enable/disable per install (and optionally per project), with a registry that future tools slot into without touching unrelated surfaces.

## Naming

`plugin` — not `extension`. The `extension` namespace is already taken by `electron/services/extensions/loader.ts` (VS Code/Cursor extension discovery for monaco). Using the same word for a different concept will confuse every future reader.

## Scope of v1 plugins

Four bundled plugins, each currently hardcoded:

| Plugin id          | What it owns today                                                           | Touchpoints                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device-debug`     | Debug toolrail panel + conductor debug streams                               | `app/components/toolrail/tools/DebugTool/`, `electron/services/conductor/debug.ts`, IPC handlers `start_debug_stream` / `run_oneshot_debug_command` etc.                |
| `device-recording` | Simulator screen capture + popout window                                     | `electron/services/simulator/` (capture pipeline, `bridge.ts`, `h264-parser.ts`), `app/components/runtime/SimulatorView/*`, `app/components/runtime/SimulatorControls/` |
| `device-control`   | Conductor CLI usage (deeplinks, mouse/keyboard/wheel, navigate, run-command) | `electron/services/conductor/{devices,logger,openLink}.ts`, `electron/services/cli/conductor.ts`, `electron/services/browser/conductorInput.ts`                         |
| `device-inspector` | UI hierarchy/a11y inspector                                                  | `app/features/inspection/`, `electron/services/inspection/capture.ts`, the `Inspect` segment in `RuntimeView.tsx`                                                       |

These overlap (inspector and recording share simulator capture; debug uses conductor). The plan accounts for the dependencies, not just the labels.

## Architecture

Single source of truth per plugin: a manifest. The manifest is the only thing other code reads to decide whether a plugin's surfaces appear.

### Plugin manifest

```ts
// app/plugins/types.ts (shared shape; backend imports from here too)
export interface PluginManifest {
  id: PluginId; // string-literal union, closed for now
  name: string; // shown in Settings → Plugins
  description: string; // one sentence
  group: PluginGroup; // "Device", "Agent", "Git", "Misc" — drives Settings grouping
  defaultEnabled: boolean;
  requires?: PluginId[]; // hard deps — disabling a base disables dependents
  prereqs?: PrereqId[]; // host-machine checks (xcode, android_sdk, …); see "Prereqs"
  assets?: PluginAsset[]; // pinned to app version; see "Distribution" below
  bundled?: boolean; // ships in extraResources (default: true)
  lazy?: boolean; // fetched from the app's GH release on enable (default: false)
  // Capability surfaces this plugin contributes. Each is optional.
  contributes?: {
    toolRail?: ToolRailContribution[]; // bottom/right rail tools
    runtimeMode?: RuntimeModeContribution[]; // segments inside RuntimeView
    settingsSection?: SettingsSectionContribution[];
    ipcGroup?: string; // logical name; backend uses to gate handlers
  };
}
```

`PluginId` stays a closed union for now — we don't load arbitrary code, we just toggle bundled features. `PluginGroup` is also closed (`"Device" | "Agent" | "Git" | "Misc"`); v1's four plugins all live in `"Device"`.

### Grouping in the Settings dialog

The Plugins screen renders one section header per `group`, plugins listed underneath in manifest order. Grouping is a pure UI concern — the registry stays a flat array, and `useEnabledPlugins()` returns a flat map. Empty groups (no plugins yet) don't render. When a group only has one plugin, it still gets the header so the layout doesn't reflow when you ship the second `"Agent"` plugin later.

### Registry

- `app/plugins/registry.ts` — array of manifests. Single file, edited when adding a plugin.
- `app/plugins/store.ts` — Zustand store (`useEnabledPlugins`, `setPluginEnabled(id, on)`). Persisted to localStorage under `argus:plugins`. Mirrors the `settingsStore.ts` pattern. Computes effective enabled state by walking `requires` (a disabled base force-disables dependents).
- `electron/services/plugins/state.ts` — backend mirror. Renderer pushes the enabled set to main via a single IPC command (`set_enabled_plugins`) on every change; main also reads from disk on boot (write-through to `~/.argus/plugins.json`) so backend startup doesn't depend on the renderer.

The two stores agree because the renderer is authoritative and main only needs to know "is X on" before invoking handlers.

### Gating contributions

**ToolRail** (`app/components/toolrail/ToolRail/ToolRail.tsx`):

- Replace hardcoded `TOP_TOOLS`/`BOTTOM_TOOLS` with `useEnabledToolRailContributions()` — returns merged static-core tools (`changes`, `terminal`, `notifications` are not plugins) + plugin-contributed entries.
- `ToolId` becomes `string` (or `CoreToolId | PluginToolId`). `TOOL_PLACEMENT` becomes a runtime map populated from contributions. `mountedToolIds` becomes `Record<string, boolean>` keyed dynamically.
- `app/components/toolrail/ToolPanel/` already routes by id → render component. Replace its `switch` with a lookup against the contributions registry.

**RuntimeView modes** (`app/components/runtime/SimulatorView/RuntimeView.tsx`):

- The `Simulate` / `Inspect` `SegmentedControl` is hardcoded. `Inspect` is `device-inspector`'s contribution. With it disabled, the segmented control collapses to no toggle (just `Simulate`) and `InspectionPanel` is not mounted. Make the options array come from `useEnabledRuntimeModes()`.

**Simulator controls** (`SimulatorControls.tsx`): the device picker + boot/disconnect stays core. Capture (start/stopSimulatorCapture, MJPEG port wiring) belongs to `device-recording`. When that plugin is off, `<SimulatorControls>` shows the picker but no capture; `<IosSimulatorView>`/`<AndroidDeviceView>` render a "recording disabled" placeholder instead of the canvas. This is a conditional render, not deletion of the components.

**Conductor IPC** (`electron/ipc.ts`):

- The conductor handlers currently registered unconditionally (lines ~1690–1820). Wrap registration in `if (pluginEnabled("device-control"))` checks at boot, and re-register/unregister on toggle. Simpler alternative: keep them registered, but reject inside the handler with a typed "plugin disabled" error. Pick the rejection approach — Electron's `ipcMain.handle` does not support clean unregister-then-reregister cycles without bookkeeping, and the cost of an early-return in the handler is negligible.
- Same pattern for `start_debug_stream` etc. (`device-debug`) and capture handlers (`device-recording`).

**Settings dialog** (`app/components/shared/SettingsDialog/SettingsDialog.tsx`):

- Add a new top-level section `"Plugins"` listing each manifest with a toggle, description, dependency hints, and inline links to the plugin's own settings (if any). This is the entry point users reach via ⌘,.
- Plugin-owned settings sections (e.g. `device-recording` could expose a default capture FPS later) come from `contributes.settingsSection` and are merged into the Settings dialog `groups` array.

### Distribution & lazy install

**Plugin assets are pinned to the app version.** No independent plugin versions, no in-app update flow, no separate CDN. Every Argus release publishes its plugin artifacts as additional assets on the same GH release that ships the `.dmg`/`.zip`, behind the existing reverse proxy. Updating Argus = updating its plugins, atomically. This collapses most of the previous draft.

**Asset URL is derived, not authored.** The manifest only names the asset; the resolver builds the URL:

```
<reverse-proxy>/releases/v<APP_VERSION>/<plugin-id>/<asset-name>-<arch>-<platform>.zip
```

`APP_VERSION` is read from `app.getVersion()` at runtime. The plugin manifest never carries a version field, never carries a URL, and never gets stale relative to the app it ships with.

**Manifest.**

```ts
type PluginAsset =
  | { kind: "native"; name: string; executable: true } // Mach-O / .exe; per-arch
  | { kind: "node"; name: string } // tarball, untarred on install
  | { kind: "jar" | "data"; name: string }; // single file
```

No `url`, no `sha256`, no `version`. The asset's checksum lives in a per-release `manifest.json` published alongside the artifacts (generated by the release pipeline, signed by the same key the app updater already trusts), so the app verifies what it downloaded but doesn't carry hashes baked into source code.

**Storage layout.** `<userData>/plugins/<app-version>/<plugin-id>/<asset-name>`. Versioning the cache directory by app version means a downgrade or upgrade does not collide, and stale versions can be GC'd on launch (keep current + previous, drop everything else). Read-path resolvers (`getConductorDir`, `getSimBridgePath`, etc.) check this location first, then fall back to `extraResources` if the asset is also bundled.

**Bundle vs. fetch policy per plugin.** Same two flags as before:

- `bundled: boolean` — asset ships inside the `.app` via `extraResources` (current behavior).
- `lazy: boolean` — asset is fetched from the GH release on first enable.

`lazy: true, bundled: false` is what actually shrinks the installer. `lazy: true, bundled: true` is "shipped in-app, but if the bundled copy disappears we can re-fetch" — useful for development and recovery, not a size win.

**Install flow.**

1. User toggles a plugin on in Settings → Plugins.
2. Resolver checks `<userData>/plugins/<app-version>/<plugin-id>/`. If all assets are present + checksums match the release manifest, enable instantly.
3. Otherwise download the missing assets from the GH release. Show inline progress on the toggle. On failure, surface the error and revert the toggle.
4. On success, persist the enable + the install record (just a list of asset names; the directory itself is the source of truth).
5. App update → on next launch the resolver sees a new `app-version` directory with no cached assets and re-downloads on first plugin use. No prompts, no diffing.

**Native-binary signing simplifies dramatically.** GH-release artifacts can be notarized by the same fastlane lane that already notarizes the `.app` — the build pipeline produces `argus-sim-bridge-arm64-darwin.zip` (notarized + stapled) and uploads it as a release asset. Gatekeeper accepts the executable on first run because the staple is on the file. No new signing infra; just additional steps in the existing release CI.

**Release pipeline change (small).** Today fastlane builds the `.app`, signs/notarizes, and uploads the `.dmg`. Add: package each plugin asset (the four native binaries + scrcpy jar + conductor tree tarball) into individually-notarized zips, generate a `plugin-manifest.json` with SHA-256 per asset, sign that manifest, upload everything as release artifacts. The reverse proxy already fronts these URLs.

**End state.** Every v1 plugin ships `lazy: true, bundled: false` and `defaultEnabled: false`. The base `.app` contains nothing under `extraResources` for plugins — no conductor tree, no native bridges, no scrcpy jar. The user explicitly opts in to each plugin (during onboarding or later via Settings), and only then are its assets downloaded from the GH release for the running app version. Cache lives at `<userData>/plugins/<app-version>/`.

**No background prefetch, no implicit downloads.** Toggling a plugin on in the UI is what triggers the fetch — that's the user's signal that they want it. A plugin in the "disabled" state never hits the network. After app update, the resolver sees an empty `<app-version>/` cache; the next time the user reaches a plugin's surface (or re-toggles it), assets are re-fetched then. We accept the small "first use after update" delay as the cost of not silently pulling tens of MB on every release.

### Onboarding plugin picker

A new step `"plugins"` is inserted into `ONBOARDING_STEPS` (`electron/services/onboarding/types.ts`) **before `preflight`** — order becomes `welcome → permissions → plugins → preflight → claude_auth → launcher → telemetry → completion`. Order matters: the picker drives which prereqs preflight runs (see next section).

The step renders the same grouped picker the Settings dialog uses, framed as "Pick the tools you'll use — you can change this later in Settings." Each plugin row shows name, one-line description, prereq summary (e.g. "Needs Xcode + iOS Simulator"), and approximate download size. Selecting a plugin drives the same `setPluginEnabled` path as the Settings toggle and starts its asset download immediately so assets are cached by the time onboarding finishes.

The step is skippable (the "Skip" affordance leaves every plugin off; nothing breaks because every IPC handler and surface is gated). Existing installs that already completed onboarding don't re-trigger it — `OnboardingStateData.completed` stays true, and the Settings dialog is the upgrade path. We bump `OnboardingStateData.version` only if we want to force the picker on existing users at some point; v1 ships without forcing.

**New files / changes for the picker.**

- `app/components/onboarding/PluginsStep.tsx` — wraps the same `PluginsSection` component used in Settings, with onboarding chrome.
- `electron/services/onboarding/types.ts` — add `"plugins"` to `ONBOARDING_STEPS` in the right slot.
- `app/stores/onboardingStore.ts` — `ONBOARDING_STEPS_ORDER` updates automatically since it derives from the const tuple.
- `app/components/onboarding/OnboardingRoot.tsx` — switch case routes to `PluginsStep`.

### Plugin prereqs (preflight gating + Settings integration)

The current `PREREQ_IDS` mix four core requirements (`claude_cli`, `claude_auth`, `git_cli`, `git_identity`) with six device-tooling requirements that only matter if the user actually wants the device plugins. Today they all run for everyone with `mobileOnly: true` softening the failure surface. With the picker in place, the device prereqs become _conditional on the plugins the user picked_.

**Mapping prereqs to plugins.**

| Prereq          | Now required by                                                                            |
| --------------- | ------------------------------------------------------------------------------------------ |
| `claude_cli`    | core (no plugin)                                                                           |
| `claude_auth`   | core                                                                                       |
| `git_cli`       | core                                                                                       |
| `git_identity`  | core                                                                                       |
| `native_bridge` | `device-recording` (iOS capture + HID), `device-inspector` (reads frames from same bridge) |
| `xcode`         | `device-recording` (iOS), `device-control` (when targeting iOS)                            |
| `ios_runtimes`  | `device-recording` (iOS)                                                                   |
| `android_sdk`   | `device-recording` (Android), `device-control` (adb-driven input)                          |
| `android_avd`   | `device-recording` (Android)                                                               |
| `playwright`    | `device-control` (headless Chromium for web)                                               |

Encoded on the manifest:

```ts
interface PluginManifest {
  // …
  prereqs?: PrereqId[]; // additional preflight checks this plugin needs
}
```

`PrereqId` stays the existing closed union. A plugin lists every prereq it needs; preflight unions across enabled plugins.

**Preflight step changes.**

- `runPrereqChecks` already accepts an `ids?: PrereqId[]` filter. The `preflight` IPC entry point now derives that filter from `core_prereqs ∪ flatMap(enabledPlugins, p => p.prereqs)`.
- Prereqs no longer carry `mobileOnly` as a UI hint — the absence of a prereq from the active set is the signal. Drop `mobileOnly` from `PrereqResult` (or keep it as a no-op for now to avoid a breaking change, and remove later).
- A user who picked zero plugins sees only the four core checks. A user who picked just `device-control` for web sees core + `playwright`. A user who picked everything sees today's full list.

**Settings → Plugins integration.**

When a plugin is toggled on (in onboarding _or_ later in Settings), the row expands to show a live prereq panel — same `PrereqResult` cards as preflight, scoped to that plugin's `prereqs`. Failures keep the toggle in a "Needs setup" state with the existing `Fix` buttons (which already exist for `claude_cli`, `git_identity`, `playwright`, `native_bridge`, `ios_runtimes`). The user can still enable the plugin without resolving warnings — assets download regardless — but the surfaces that depend on the missing prereq error gracefully when used (existing simulator code already handles "no iOS runtimes" etc.).

This means a user who skipped a plugin during onboarding and toggles it on six months later gets exactly the same prereq experience they would have seen during preflight, just inline in Settings instead of as a wizard step. No second source of truth.

**Implementation details for this slice.**

- `electron/services/onboarding/types.ts` — keep `PrereqId` union; optionally retire `mobileOnly` from `PrereqResult` later.
- `electron/services/onboarding/prereqs.ts` — `runPrereqChecks` is already filterable; the IPC handler that calls it gains a "compute filter from enabled-plugins set" step.
- `app/components/onboarding/PreflightStep.tsx` — pulls the active prereq id list from the plugin store rather than hardcoding all of them.
- `app/components/shared/SettingsDialog/PluginsSection.tsx` — embeds the prereq panel per row, reusing the existing `PrereqRow` component that PreflightStep uses (extract it to `app/components/onboarding/PrereqRow.tsx` if it isn't already a standalone component).
- `app/plugins/registry.ts` — each manifest declares its `prereqs`.

### Settings: plugin management

Settings → Plugins is the canonical management surface. For each plugin in the registry, the row shows: name, description, group header, enable toggle, dependency hint when forced off by a missing `requires` base, and — when the plugin is enabled but assets are not yet downloaded for the running app version — a "Download" button with progress. Disabling a plugin removes assets from the per-version cache (next enable re-fetches). This is also where users land after an app update if they want to re-pull plugin assets.

### Project-level overrides

App-level enable/disable is the default. Add `plugins?: { disabled?: PluginId[] } | null` to `ArgusConfig` (`electron/services/session/models.ts`). A project can mask out plugins for everyone working on it (e.g. a server-only repo turning off `device-*` entirely), but cannot force a plugin on if the user has it off. Effective state = `userEnabled && !projectDisabled`. Surface in `SetupConfigDialog/` as a checklist. Document in `docs/project-settings.md`.

### Dependency rules between v1 plugins

- `device-recording` requires nothing.
- `device-inspector` requires `device-recording` (capture is how the inspector gets the underlying frame to overlay). Encode this in `requires`. Disabling recording auto-disables inspector with a tooltip explanation.
- `device-control` is independent (conductor can drive a device that the user is watching elsewhere).
- `device-debug` requires `device-control` (it's just streaming conductor subprocesses).

These constraints keep the toggle UX honest — users don't end up in a broken state where the inspector is on but has no source pixels.

## Implementation surface (one PR)

Single landing. The change touches a known set of files and is mechanical once the registry exists; splitting it would just create awkward intermediate states where some plugins are gated and others aren't.

**New files.**

- `app/plugins/types.ts` — `PluginManifest`, `PluginId`, `PluginGroup`, `PluginAsset`, contribution interfaces.
- `app/plugins/registry.ts` — the four manifests.
- `app/plugins/store.ts` — Zustand store, persistence, effective-enabled computation (walks `requires`, applies project-disable mask).
- `app/plugins/hooks.ts` — `useEnabledPlugins`, `usePluginEnabled(id)`, `useToolRailContributions`, `useRuntimeModeContributions`.
- `electron/services/plugins/state.ts` — backend mirror, disk persistence, `pluginEnabled(id)` helper.
- `electron/services/plugins/assets.ts` — resolver: `resolveAssetPath(pluginId, assetName)`, GH-release fetch, checksum verify, cache GC.
- `app/components/shared/SettingsDialog/PluginsSection.tsx` — grouped list with toggles, dependency hints, download progress.
- `scripts/release-plugins.ts` — fastlane-invoked: zips + notarizes each asset, emits signed `plugin-manifest.json`, uploads to GH release.

**Modified files.**

- `app/components/toolrail/ToolRail/ToolRail.tsx`, `app/components/toolrail/ToolPanel/*`, `app/stores/layoutStore.ts` — `ToolId` becomes string, `TOOL_PLACEMENT` and `mountedToolIds` keyed dynamically, tools merged from registry.
- `app/components/runtime/SimulatorView/RuntimeView.tsx` — segmented-control options come from `useRuntimeModeContributions()`; `Inspect` panel only mounts when contributed.
- `app/components/runtime/SimulatorControls/SimulatorControls.tsx` — capture-control branches gated on `device-recording`.
- `electron/ipc.ts` — every conductor / debug-stream / capture / inspection handler early-returns `"plugin disabled"` when the corresponding plugin is off.
- `electron/services/cli/conductor.ts`, `electron/services/simulator/bridge.ts`, `electron/native/argus-sim-bridge` resolvers — read paths go through `resolveAssetPath` instead of `extraResources`.
- `electron-builder.yml` — drop the four plugin entries from `extraResources` (they're now lazy).
- `electron/services/session/models.ts` + `app/components/sidebar/SetupConfigDialog/*` — `plugins.disabled` field + project settings UI.
- `app/components/onboarding/OnboardingRoot.tsx`, `electron/services/onboarding/types.ts` — new `plugins` step before `preflight` (see Onboarding section).
- `app/components/onboarding/PreflightStep.tsx`, `electron/services/onboarding/prereqs.ts` (caller) — preflight runs a filtered prereq set derived from enabled plugins (see Prereqs section).
- `electron/services/onboarding/argusJson.ts` — leave inference alone; new field defaults to empty.
- `fastlane/Fastfile` — invoke `scripts/release-plugins.ts` after the existing notarize+upload steps.
- `docs/app-settings.md`, `docs/project-settings.md`, `docs/features.md` — document the Plugins screen and the project-level disable list.
- `.changeset/extensible-plugin-system.md` — single end-user-facing entry.

After this lands, adding a future plugin is: append a manifest entry, register contributions, gate the IPC group. No edits to `ToolRail.tsx`, `RuntimeView.tsx`, `SettingsDialog.tsx`, `layoutStore.ts`, or `electron-builder.yml`.

## Pre-release builds (alpha / RC)

Testing the lazy-fetch path requires real GH releases — the resolver downloads from `<reverse-proxy>/releases/v<version>/...`, which doesn't exist for unreleased branches. Today `.github/workflows/release.yml` is hardcoded to `main` and a single stable channel. We extend it to support pre-release builds from arbitrary branches without disturbing the stable path.

### Channel model

Three channels, mutually exclusive:

- `stable` — current behavior. Tag `v0.19.0`, GitHub release marked latest, electron-updater feed `latest-mac.yml`. Only from `main`.
- `alpha` — for plugin/feature work in progress. Tag `v0.19.0-alpha.3`, GitHub release marked pre-release, feed `alpha-mac.yml`. Any branch.
- `rc` — for release-candidate stabilization. Tag `v0.19.0-rc.1`, GitHub release marked pre-release, feed `beta-mac.yml` (electron-updater calls it beta but we use it for RCs). Typically a `release/0.19.0` branch.

Stable users on the `latest` channel never see alpha/RC builds — different feed file, different release flag.

### Workflow trigger

Replace the workflow_dispatch input with a channel selector + branch:

```yaml
on:
  workflow_dispatch:
    inputs:
      channel:
        type: choice
        options: [stable, alpha, rc]
        default: stable
```

Drop the `branches: [main]` restriction. Add a guard at the top of the job: `if: inputs.channel != 'stable' || github.ref == 'refs/heads/main'`. That keeps stable builds main-only without blocking alphas from feature branches.

### Versioning

Changesets supports pre-release mode out of the box but it's stateful (a `.changeset/pre.json` file). Two practical approaches:

- **Permanent pre-release branches.** A long-lived `next` branch sits in pre-release mode (`pnpm changeset pre enter alpha` committed once). Alphas are cut from `next`; merging to main exits pre-release mode and ships stable. Clean but requires branch discipline.
- **Per-build pre-release.** The workflow runs `pnpm changeset pre enter <channel>` → `pnpm changeset version` → captures the bumped version → `pnpm changeset pre exit` (without committing the exit) so the source branch's changeset state stays untouched. Adds ~10 lines of bash to `release.yml`. Recommended for v1: it doesn't require new branches, and the alpha/RC version numbers live only in tag-space, never in source.

Either way, the resulting tag is `v0.19.0-alpha.3` and `package.json` reads the same. The plugin asset URL `(<proxy>/releases/v0.19.0-alpha.3/...)` resolves to the prerelease GH release because we tag it that way.

### electron-builder + updater

Two config knobs:

- `publish.releaseType` — `release` for stable, `prerelease` for alpha/RC. Set via env var `EP_PRE_RELEASE=true` (electron-builder reads it) or by passing `--prerelease` on the CLI.
- `publish.channel` — `latest` (stable), `alpha`, `beta`. Drives the `*-mac.yml` filename. Set via env var `EP_CHANNEL`.

Add to the `release` lane in `fastlane/Fastfile` a `channel:` parameter (default `stable`) that exports these env vars before invoking electron-builder. Workflow passes the input through.

### Auto-update behavior

Stable users only auto-update to `latest-mac.yml` — no change. Add a hidden setting (`updaterChannel: "latest" | "alpha" | "beta"`) to `app/stores/settingsStore.ts`, written into `electron-updater`'s `channel` property at startup. Default `"latest"`. A power user (you, internal testers) can flip it to `"alpha"` to subscribe to the alpha feed. Surface this only in Settings → Advanced once the rest lands; don't make it visible during onboarding.

### Side-effects to gate on stable-only

- Pushing the changesets-bumped commit + tag back to `main`: stable only. For alpha/RC, build the tag on the fly (`git tag v… && git push origin v…`) but don't push commits — the source branch stays clean.
- Website-sync `repository_dispatch`: stable only. Pre-releases shouldn't pollute the public changelog.
- Bumping `CHANGELOG.md`: skip for pre-releases. The changeset entries stay queued until a stable cut consumes them.

### Implementation surface for this slice

- `.github/workflows/release.yml` — add `channel` input, branch guard, conditional pre/post steps.
- `fastlane/Fastfile` — `channel:` option on the `release` lane, sets `EP_CHANNEL` + `EP_PRE_RELEASE` for electron-builder.
- `electron-builder.release.yml` — read `channel` from env (electron-builder supports env interpolation), or build channel-specific configs.
- `app/stores/settingsStore.ts` + electron-updater wiring — `updaterChannel` setting.
- `docs/releases.md` — document the three channels and how to cut each.
- `scripts/release-plugins.ts` — already version-derived; no change needed since the GH release tag carries the pre-release suffix and the upload target is still "the release for this tag."

This is purely workflow plumbing — no app code logic changes beyond the updater channel setting. Lands as part of the same plugin-system PR so the test loop is real from day one (build alpha → install → toggle plugin → confirm assets fetch from the alpha release).

## Non-goals (call out explicitly)

- **No dynamic code loading.** Plugins are bundled. Disabling just gates surfaces; the JS still ships in the binary. Tree-shaking and dynamic `import()` for heavy plugins (e.g. inspection) can come later as a size optimization, not part of this plan.
- **No third-party plugins.** No sandbox, no permission model, no manifest schema validation beyond what TypeScript already enforces.
- **No per-session toggling.** App-level + project-level only. Per-session would multiply the state matrix without a clear use case yet.
- **No hot path changes for VS Code extensions.** `electron/services/extensions/loader.ts` keeps its name in v1 (renaming touches monaco bootstrap); we just stop using "extension" for the new concept.

## Open questions

1. Do we want a "developer plugins" hidden flag for tools you (Douwe) are mid-building and don't want shipped to other users yet? Could piggyback on `defaultEnabled: false` + a `hidden: boolean` manifest field.
2. Should `device-recording` being off also hide the simulator toolrail entry entirely, or keep the device picker visible (current plan)? Argues for keeping it: a user might want conductor-driven control without watching the screen.
3. Telemetry: do we want to record which plugins each install has off? Useful for prioritization, but check `docs/telemetry-events.md` consent model first.
4. After an app update, should the Plugins screen surface a banner like "Plugin assets need re-downloading for v0.20.0" so the user knows to revisit it, or just re-fetch silently the next time they touch a surface that needs them? The silent path keeps the UI quieter; the banner avoids the surprise wait.
