# Argus

Agentic IDE for mobile development. Electron desktop app (Node.js/TypeScript backend + React frontend) where multiple Claude Code agents work on features in parallel, each in an isolated git worktree, with embedded iOS simulators for live testing.

## Quick reference

- **Dev:** `pnpm dev` (starts Vite dev server + Electron together via concurrently)
- **Build:** `pnpm build` (type-check + Vite build + electron TS compile)
- **Build app:** `pnpm build:app` (build + electron-builder → .app/.dmg)
- **Lint:** `pnpm lint` (runs `tsc --noEmit && eslint && prettier --check`)
- **Storybook:** `pnpm storybook` (serves the Peacock design system at :6006)
- **Tooling:** managed via `mise.toml` — node 24, pnpm 10

## Architecture

This repo is a **pnpm monorepo**. Packages live in `packages/`; the Electron app lives at the repo root.

- `packages/peacock` → **`@argus/peacock`**, the shared design system (tokens, icons, components).
- `app/` + `electron/` → the Argus desktop app. Consumes `@argus/peacock` via `workspace:*`.

Three-panel layout: workspace sidebar (left), agent control (center), runtime & testing (right).

### Frontend (`src/`)

- **React 19 + TypeScript + Vite 7**
- **State:** Zustand stores in `src/stores/` — `workspaceStore`, `terminalStore`, `agentStore`
- **Styling:** CSS Modules (`*.module.css`) colocated with components. Global variables/reset in `src/styles/global.css`
- **IPC wrappers:** `src/lib/ipc.ts` — typed `invoke()` wrappers for every backend command. Always add new commands here
- **Event helpers:** `src/lib/events.ts` — `listen()` wrapper for backend push events
- **Shared types:** `src/lib/types.ts` — TypeScript interfaces matching backend types. Keep in sync manually
- **Hooks:** `src/hooks/` — `useIpcEvent`, `useWorkspaces`, `useTerminal`, `useAgent`
- **Components:** organized by panel — `layout/`, `sidebar/`, `agent/`, `runtime/`, `home/`
- **Routing:** URL is the single source of truth for "which screen". See [`docs/routing.md`](docs/routing.md) for the full URL inventory and navigation API. When adding, removing, or renaming a route, update that doc in the same change.

### Backend (`electron/`)

- **Node.js + TypeScript, Electron**
- **Entry:** `main.ts` — BrowserWindow creation, app lifecycle, PATH fixup
- **Preload:** `preload.ts` — `contextBridge.exposeInMainWorld('argus', { invoke, on })`
- **IPC:** `ipc.ts` — all `ipcMain.handle` registrations, routes to services
- **State:** `state.ts` — `AppState` singleton with `Map`s (no Mutex needed, Node.js is single-threaded)
- **Services:** `services/` — one directory per domain:
  - `workspace/` — git worktree CRUD, setup pipeline, file watching, merge
  - `agent/` — Claude Code subprocess, stream-json parsing, permission broker
  - `terminal/` — node-pty multiplexer, shell env PATH fixup
  - `simulator/` — xcrun simctl wrapper, native bridge binary communication
  - `file/` — workspace file operations (list, read, write)
- **Native:** `native/argus-sim-bridge/` — standalone Swift/ObjC binary for simulator capture + HID injection (communicates via JSON-over-stdio)

## Conventions

### File size

- Ideally, files stay under 500 lines of code. When a file approaches that size, split responsibilities into smaller, focused modules rather than letting it grow. Going over is acceptable only when a clean split genuinely isn't possible — the default answer is to split.

### Backend (Node.js/TypeScript)

- IPC commands are `snake_case` strings — the frontend calls them via `window.argus.invoke('snake_case')`
- Use `child_process.execFile` for git CLI calls (not libgit2)
- Use `node-pty` for terminal sessions (same as VSCode)
- Errors: throw string errors from IPC handlers (Electron rejects the renderer's promise)
- Events: send via `getMainWindow()?.webContents.send(eventName, payload)`
- State: access `appState` singleton directly (no locking needed)

### TypeScript / React

- CSS Modules for all component styling — no inline styles, no global class names
- One component per file, colocated `.module.css`
- Prefer small, focused components (under 300 lines). Extract subcomponents, hooks, and pure logic into separate files when a component grows beyond this. Keep orchestrator/container components thin — they should wire data and layout, not contain business logic or complex UI
- Extract pure logic (parsers, transforms, utilities) into `src/lib/` — no React imports in utility modules
- Zustand stores: simple `create<State>()` pattern, no providers
- IPC: always go through `src/lib/ipc.ts` wrappers, never call `window.argus.invoke()` directly from components
- Events: use `src/hooks/useIpcEvent.ts` for event subscriptions

### Routing

The URL is the single source of truth for the current screen. Full inventory and navigation API live in [`docs/routing.md`](docs/routing.md) — keep that doc in sync whenever you add, rename, or remove a route.

1. **Every screen has a URL.** If you're adding a new screen (tool-rail button, sidebar entry, modal-that-acts-like-a-page), add a route for it in `app/lib/router.tsx` and document it in `docs/routing.md`.
2. **Navigate via `appNavigate(route)`** from `app/lib/router.tsx`, or one of the thin semantic wrappers (`selectSession`, `setCenterView`, `openOrganization`, `setActiveCenterView`). Never call React Router's `navigate()` from components directly — it bypasses the registered-navigator indirection used by non-hook callers.
3. **One navigation call per user action.** Two `appNavigate` calls back-to-back stack two history entries and break the back button. Collapse them into a single call with the final destination; `syncRouteToStores` does not exist — there's nothing to reconcile.
4. **Read the URL, don't mirror it.** No Zustand state holds "which session/view is selected". Use the URL-derived hooks (`useSelectedSessionId`, `useCenterView`, `useActiveCenterView`, `useSelectedOrganizationId`, or the raw `useCurrentRoute`/`useRouteSessionId` in `app/lib/routeHooks.ts`). For non-hook code, use `getSelectedSessionId()`, `getActiveCenterView()`, `getCurrentRoute()`.

### Design system (`@argus/peacock`)

**All visual primitives and shared composites come from `@argus/peacock`.** The app should not re-invent buttons, badges, cards, chat inputs, sidebar items, tool-call rows, etc. — import them from Peacock.

When building a new UI:

1. **Check Storybook first** (`pnpm storybook`) to see what Peacock already ships. If a component fits — use it.
2. **If a component is missing or needs a new variant**, add it to `packages/peacock/src/components/` with a colocated `.module.css` and a `.stories.tsx` file. Then import it from the app. Do **not** ship one-off styled components in `app/components/` that duplicate design-system responsibility.
3. **If a component is app-specific** (wires up IPC, reads Zustand state, orchestrates a panel), keep it in `app/components/` — but compose it from Peacock primitives. The app-specific component wires data; Peacock provides the look.
4. **Design tokens live in `@argus/peacock/tokens.css`.** Do not redefine `--accent`, `--bg-*`, `--glass-*`, spacing, radii, or type vars anywhere else. If you need a new token, add it to `packages/peacock/src/styles/tokens.css` and document it in the Tokens story.
5. **Only tokens — never hardcoded colors.** No literal hex (`#fff`, `#0a0a0f`), no `rgba()`/`hsl()` with numbers, and no `var(--token, #fallback)` fallback values in any `.module.css`, `.tsx`, or `.ts` file outside `tokens.css` itself. This includes inline `style={{ color: "#..." }}` in JSX. If the color doesn't have a token, add one to `tokens.css` (both dark and light blocks) before using it. A hardcoded color that "looks right in dark mode" will silently break the light theme — the whole point of tokens is that both themes stay in sync. Exceptions are limited and already documented in `tokens.css`: the project-accent palette (`packages/peacock/src/lib/projectAccent.ts`), the git-graph branch palette, and semantic identity colors like traffic-light buttons or folder-icon tints — all of which live behind named tokens too. If you reach for a literal color, that is the signal to add a token first. Use `color-mix(in srgb, var(--token) N%, transparent)` when you need a custom alpha of a semantic color.
6. **Icons:** use `Icons` from `@argus/peacock` (43 hand-rolled SVGs + `ArgusLogo`). Do not introduce Lucide, Heroicons, or an icon font. If an icon is missing, add it to `packages/peacock/src/icons/Icons.tsx` at matching stroke weight (filled by default; 1.3–2px stroke for diagrammatic icons).
7. **No inline `<svg>` in `app/`.** This is non-negotiable and the most common violation. If you are about to write `<svg>`, `<path>`, `<circle>`, `<line>`, or any other SVG element inside an `app/components/` file, stop. That is a design-system responsibility and belongs in Peacock. This applies to every SVG — icons, badges, decorative shapes, data-visualization primitives (graphs, charts, sparklines, progress arcs), loading indicators, empty-state illustrations. All of it. The rule holds even when the SVG is data-driven: extract the pure rendering primitive to `packages/peacock/src/components/<Name>/` with a story, move any shared types/constants the primitive owns (palettes, row/data shapes) into that Peacock file, then compose it from the app with data you compute locally. Before adding a new SVG primitive to Peacock, `grep -r '<svg' packages/peacock/src` to check an existing one doesn't already cover it. If you catch yourself reaching for `<svg>` in `app/`, that is the signal to pause and add the primitive to Peacock first — do not ship the app change without it.
8. **No emoji, no third-party UI kits, no Tailwind.** Peacock is the only UI layer.

Every Peacock component must ship with a Storybook story covering its meaningful states (default, hover, selected, disabled, status variants, etc.) so designers and agents can review it in isolation.

### IPC contract

When adding a new backend command:

1. Add the handler function in the appropriate `electron/services/` module
2. Register it in `electron/ipc.ts` via `handle('command_name', handler)`
3. Add a typed wrapper in `src/lib/ipc.ts`
4. Add/update TypeScript interfaces in `src/lib/types.ts` if the command uses new types

### Worktree lifecycle

Worktrees live in `~/.argus/worktrees/{RepoName}-argus-worktrees/{branch}/`. Workspace initialization after `git worktree add`: copy dirs, symlink files, run commands — all configured in `.argus.json` at repo root.

### Changesets

Every user-visible change ships with a changeset in `.changeset/`. The body is concatenated into app release notes, so write for the end user, not the reviewer:

- One or two short sentences, present tense, describing the behavior change. No implementation details, no file paths, no internal type/component names.
- Bump `"argus"` for app-visible changes and `"@argus/peacock"` when the design system's public surface changes. Use `patch` for fixes, `minor` for new behavior.
- Skip the changeset entirely for pure refactors, tests, tooling, or internal cleanup that users won't notice.

## Key technical decisions

- `node-pty` for terminals — same as VSCode, spawns immediately at 80x24 then resizes
- Git CLI (`child_process.execFile`) for worktree operations — better worktree support than libgit2
- Claude Code spawned as subprocess with `--output-format stream-json` (piped stdin/stdout, not PTY)
- Simulator bridge as standalone macOS binary over JSON-over-stdio — Swift/ObjC code uses private frameworks that can't run in Node.js
- Worktrees stored outside the project directory to keep the user's repo clean
- Electron for desktop app shell — native menus, file system access, protocol handlers
- `@codingame/monaco-vscode-api` for embedding VS Code editor/explorer/search as parts within our layout
