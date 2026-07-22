# Argus

Electron agentic IDE for mobile development. Multiple Claude Code agents work in parallel, each in an isolated git worktree, with embedded iOS simulators.

## Commands

- `pnpm dev` — Vite + Electron (concurrently)
- `pnpm build` — type-check + Vite + electron TS compile
- `pnpm build:app` — build + electron-builder (.app/.dmg)
- `pnpm lint` — `tsc --noEmit && eslint && prettier --check`
- `pnpm storybook` — Peacock design system at :6006
- Tooling via `mise.toml` (node 24, pnpm 10)

## Architecture

pnpm monorepo. Three-panel layout: workspace sidebar / agent control / runtime & testing.

- `packages/peacock` → `@argus/peacock` design system (tokens, icons, components)
- `app/` + `electron/` → desktop app, consumes Peacock via `workspace:*`

### Frontend (`app/`, also `src/`)

React 19 + TypeScript + Vite 7. Zustand stores in `src/stores/`. CSS Modules colocated with components; globals in `src/styles/global.css`.

- IPC: typed wrappers in `src/lib/ipc.ts` — always add new commands here, never call `window.argus.invoke()` directly
- Events: `src/lib/events.ts` `listen()`; subscribe via `src/hooks/useIpcEvent.ts`
- Shared types: `src/lib/types.ts` (keep in sync with backend manually)
- Components organized by panel: `layout/`, `sidebar/`, `agent/`, `runtime/`, `home/`

### Backend (`electron/`)

Node.js + TypeScript + Electron.

- `main.ts` — BrowserWindow, lifecycle, PATH fixup
- `preload.ts` — exposes `window.argus` via `contextBridge`
- `ipc.ts` — `ipcMain.handle` registrations, routes to services
- `state.ts` — `AppState` singleton with `Map`s (no locking; Node is single-threaded)
- `services/` — one dir per domain: `workspace/` (git worktree + setup + merge), `agent/` (Claude Code subprocess, stream-json), `terminal/` (node-pty), `simulator/` (simctl + native bridge), `file/`
- `native/argus-sim-bridge/` — standalone Swift/ObjC binary for simulator capture + HID injection, JSON-over-stdio

## Conventions

**File size:** target <500 lines; split responsibilities when approaching. Components <300 lines — extract subcomponents/hooks/pure logic. Keep orchestrators thin.

**Backend:**

- IPC commands are `snake_case`
- `child_process.execFile` for git (not libgit2); `node-pty` for terminals
- Throw string errors from IPC handlers
- Events: `getMainWindow()?.webContents.send(name, payload)`
- Access `appState` directly

**Frontend:**

- CSS Modules only — no inline styles, no global class names
- Pure logic → `src/lib/` (no React imports)
- Zustand: plain `create<State>()`, no providers

**Routing** (URL is the single source of truth; full inventory in [`docs/routing.md`](docs/routing.md) — update when adding/renaming/removing routes):

1. Every screen has a URL. New screens → add route to `app/lib/router.tsx` + doc it.
2. Navigate via `appNavigate(route)` or semantic wrappers (`selectSession`, `setCenterView`, `openOrganization`, `setActiveCenterView`). Never React Router's `navigate()` from components — bypasses the registered-navigator indirection.
3. One navigation call per user action (two back-to-back stack history and break the back button).
4. Read the URL, don't mirror it. Use hooks (`useSelectedSessionId`, `useCenterView`, etc.) or getters (`getSelectedSessionId()`, `getActiveCenterView()`, `getCurrentRoute()`). No Zustand state for "which screen".
5. **Prefer routes over ad-hoc state for switching views inside a panel/screen.** If a tab, sub-view, sidebar selection, or filtered drill-down (e.g. focused branch/tag/file) changes what the panel shows, give it its own URL — extend `ParsedRoute` (add a field like `gitRefName`) and add a `set…` helper in the relevant store. This makes "which item is selected" a single route-equality check, gets back/forward + deep linking for free, and prevents two pieces of state disagreeing about what's active. Don't introduce a Zustand `selectedX` slice when a route segment or query param can carry it.

**Design system (`@argus/peacock`) — all visuals come from Peacock:**

1. Check Storybook first. If something fits, use it.
2. Missing/new variant → add to `packages/peacock/src/components/` with `.module.css` + `.stories.tsx`. No duplicate one-offs in `app/components/`.
3. App-specific components wire IPC/state but compose Peacock primitives.
4. Tokens live in `packages/peacock/src/styles/tokens.css`. Need a new one → add it there (both dark + light), document in Tokens story.
5. **Only tokens — never hardcoded colors.** No hex, no `rgba()`/`hsl()` with numbers, no `var(--token, #fallback)`, no inline `style={{ color: "#..." }}`. Hardcoded colors silently break the opposite theme. Exceptions (project-accent palette, git-graph palette, traffic lights, folder tints) all live behind named tokens in `tokens.css`. Use `color-mix(in srgb, var(--token) N%, transparent)` for custom alphas.
6. Icons: `Icons` from `@argus/peacock` only. No Lucide/Heroicons/icon fonts. Missing icon → add to `packages/peacock/src/icons/Icons.tsx` at matching stroke weight.
7. **No inline `<svg>` in `app/`** (most common violation). Every SVG — icons, badges, shapes, data-viz (graphs, charts, sparklines, arcs), loaders, illustrations — belongs in `packages/peacock/src/components/<Name>/` with a story. Data-driven too: extract the pure renderer, move its types/constants (palettes, row shapes) into Peacock, compose from the app. Before adding a primitive, `grep -r '<svg' packages/peacock/src` for existing coverage.
8. No emoji, third-party UI kits, or Tailwind. Peacock is the only UI layer.
9. **Rebuilding a desktop feature in the embedded web client → reuse the desktop component, don't rebuild it.** Everything is already built in desktop. Decouple the component (strip IPC/Electron-specific deps), move it into Peacock, and compose it from both the desktop app and the web client, each wiring their own data/transport. Only build fresh when no desktop equivalent exists.

Every Peacock component ships with a Storybook story covering meaningful states.

**IPC contract (adding a command):**

1. Handler in `electron/services/<domain>/`
2. Register in `electron/ipc.ts` via `handle('command_name', handler)`
3. Typed wrapper in `src/lib/ipc.ts`
4. Types in `src/lib/types.ts` if new

**Worktrees:** `~/.argus/worktrees/{RepoName}-argus-worktrees/{branch}/`. Post-`git worktree add` setup (copy dirs, symlink files, run commands) configured in `.argus.json`.

**Plan files:** write to `plan/` in the repo root, never `docs/` (which is published to the website).

**Commit messages:** one short single-sentence subject line. No body paragraphs, no bullet lists, no `Co-Authored-By` trailer.

**Changesets:** every user-visible change gets one in `.changeset/`. Written for end users: 1–2 short sentences, present tense, no internals/file paths/type names. Bump `argus` for app changes, `@argus/peacock` for public design-system changes. `patch` for fixes, `minor` for new behavior. Skip for pure refactors/tests/tooling.

**Configurability of new features:** when adding a feature, ask whether the user might reasonably want to customize it. If yes, expose it as a setting:

- **App-level** (per developer, machine-local) → add to `app/stores/settingsStore.ts`, surface in the Settings dialog (`app/components/shared/SettingsDialog/`), and document in [`docs/app-settings.md`](docs/app-settings.md). Use `SettingsScreenField` from Peacock for layout consistency. Per-project personal prefs (e.g. branch prefix) go in `~/.argus/user-project-settings.json` instead — see `electron/services/userProjectSettings/store.ts`.
- **Project-level** (shared with the team, checked in) → add the field to `ArgusConfig` in `electron/services/session/models.ts`, parse/normalize it in `electron/services/session/setup.ts`, optionally extend onboarding inference in `electron/services/onboarding/argusJson.ts`, **wire it into the Project Settings dialog** (`app/components/sidebar/SetupConfigDialog/`) so it's editable in-app, and document in [`docs/project-settings.md`](docs/project-settings.md). Never mark a new project setting as "hand-edit only" in the docs unless the user explicitly asks for it — the dialog is the default surface.

If the new setting needs UI primitives Peacock doesn't have, add them to Peacock first (with a story) — same rule as everywhere else.

## Key technical decisions

- `node-pty` for terminals (same as VSCode) — spawn at 80x24, resize
- Git CLI via `child_process.execFile` — better worktree support than libgit2
- Claude Code as subprocess with `--output-format stream-json` (piped stdio, not PTY)
- Simulator bridge as standalone macOS binary over JSON-over-stdio — uses private frameworks that can't run in Node
- Worktrees outside project dir to keep user's repo clean
- `@codingame/monaco-vscode-api` for embedded VS Code editor/explorer/search
