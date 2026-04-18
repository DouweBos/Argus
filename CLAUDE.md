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

- Keep files to 300–500 lines of code. When a file grows larger, architect a solution to split up responsibilities into smaller, focused modules.

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

### Design system (`@argus/peacock`)

**All visual primitives and shared composites come from `@argus/peacock`.** The app should not re-invent buttons, badges, cards, chat inputs, sidebar items, tool-call rows, etc. — import them from Peacock.

When building a new UI:

1. **Check Storybook first** (`pnpm storybook`) to see what Peacock already ships. If a component fits — use it.
2. **If a component is missing or needs a new variant**, add it to `packages/peacock/src/components/` with a colocated `.module.css` and a `.stories.tsx` file. Then import it from the app. Do **not** ship one-off styled components in `app/components/` that duplicate design-system responsibility.
3. **If a component is app-specific** (wires up IPC, reads Zustand state, orchestrates a panel), keep it in `app/components/` — but compose it from Peacock primitives. The app-specific component wires data; Peacock provides the look.
4. **Design tokens live in `@argus/peacock/tokens.css`.** Do not redefine `--accent`, `--bg-*`, `--glass-*`, spacing, radii, or type vars anywhere else. If you need a new token, add it to `packages/peacock/src/styles/tokens.css` and document it in the Tokens story.
5. **Icons:** use `Icons` from `@argus/peacock` (43 hand-rolled SVGs + `ArgusLogo`). Do not introduce Lucide, Heroicons, or an icon font. If an icon is missing, add it to `packages/peacock/src/icons/Icons.tsx` at matching stroke weight (filled by default; 1.3–2px stroke for diagrammatic icons).
6. **No emoji, no third-party UI kits, no Tailwind.** Peacock is the only UI layer.

Every Peacock component must ship with a Storybook story covering its meaningful states (default, hover, selected, disabled, status variants, etc.) so designers and agents can review it in isolation.

### IPC contract

When adding a new backend command:

1. Add the handler function in the appropriate `electron/services/` module
2. Register it in `electron/ipc.ts` via `handle('command_name', handler)`
3. Add a typed wrapper in `src/lib/ipc.ts`
4. Add/update TypeScript interfaces in `src/lib/types.ts` if the command uses new types

### Worktree lifecycle

Worktrees live in `~/.argus/worktrees/{RepoName}-argus-worktrees/{branch}/`. Workspace initialization after `git worktree add`: copy dirs, symlink files, run commands — all configured in `.argus.json` at repo root.

## Key technical decisions

- `node-pty` for terminals — same as VSCode, spawns immediately at 80x24 then resizes
- Git CLI (`child_process.execFile`) for worktree operations — better worktree support than libgit2
- Claude Code spawned as subprocess with `--output-format stream-json` (piped stdin/stdout, not PTY)
- Simulator bridge as standalone macOS binary over JSON-over-stdio — Swift/ObjC code uses private frameworks that can't run in Node.js
- Worktrees stored outside the project directory to keep the user's repo clean
- Electron for desktop app shell — native menus, file system access, protocol handlers
- `@codingame/monaco-vscode-api` for embedding VS Code editor/explorer/search as parts within our layout
