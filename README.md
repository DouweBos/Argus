# Stagehand

Agentic IDE for mobile development. Multiple Claude Code agents work on features in parallel, each in an isolated git worktree, with embedded iOS simulators for live testing.

Built with Electron (Node.js backend + React frontend). macOS 13+.

## Prerequisites

- [mise](https://mise.jdx.dev/) — manages Node 24 and pnpm 10 (see `mise.toml`)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `claude` must be on your PATH
- Xcode + iOS Simulators (for simulator features)

```sh
mise install        # installs node, pnpm
pnpm install        # installs dependencies
```

### Native bridge (required for simulator features)

The simulator capture binary must be compiled locally:

```sh
cd native/stagehand-sim-bridge
make
```

## Development

```sh
pnpm dev            # starts Vite dev server + Electron together
```

### Linting

```sh
pnpm lint           # tsc + eslint + prettier
pnpm lint:fix       # auto-fix eslint + prettier
```

### Building

```sh
pnpm build          # type-check + Vite build + Electron TS compile
pnpm build:app      # build + electron-builder (.app/.dmg)
```

## Architecture

Three-panel layout: workspace sidebar (left), agent control (center), runtime & testing (right).

```
+----------------+-------------------------+------------------+
|  Workspaces    |     Agent Control       |    Runtime &     |
|                |                         |    Testing       |
| - Repo list    | - Claude Code agent     | - Shell tabs     |
| - Worktrees    | - Tool call cards       | - Simulator view |
| - Status       | - Instruction input     | - Device picker  |
+----------------+-------------------------+------------------+
```

### Frontend (`app/`)

React 19 + TypeScript + Vite 7. State managed by Zustand stores (`app/stores/`). Styling via CSS Modules colocated with components.

| Directory             | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `components/layout/`  | AppShell (CSS grid), TitleBar, ResizablePanel, ErrorBoundary  |
| `components/sidebar/` | Workspace list, cards, create/setup dialogs                   |
| `components/agent/`   | AgentPanel, AgentChat, ChatMessage, ChatInput, ToolCallCard   |
| `components/runtime/` | TerminalTabs, ShellTerminal, SimulatorView, SimulatorControls |
| `hooks/`              | useIpcEvent, useWorkspaces, useTerminal, useAgent             |
| `stores/`             | workspaceStore, terminalStore, agentStore, conversationStore  |
| `lib/ipc.ts`          | Typed `invoke()` wrappers for every backend command           |
| `lib/types.ts`        | TypeScript interfaces shared with the backend                 |

### Backend (`electron/`)

Node.js + TypeScript, Electron. Entry point in `main.ts` (BrowserWindow creation, app lifecycle).

| Module                | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `state.ts`            | `AppState` — singleton `Map`s for workspaces, agents, terminals            |
| `ipc.ts`              | All `ipcMain.handle` registrations, routes to services                     |
| `preload.ts`          | `contextBridge.exposeInMainWorld('stagehand', { invoke, on })`             |
| `services/workspace/` | Git worktree create/delete/list, `.stagehand.json` parsing, setup pipeline |
| `services/agent/`     | Spawn/kill Claude Code as subprocess, stream parsing, permission broker    |
| `services/terminal/`  | node-pty lifecycle + event emission                                        |
| `services/simulator/` | `xcrun simctl` wrapper, native bridge binary communication                 |
| `services/file/`      | Workspace file operations (list, read, write)                              |

### Native (`native/stagehand-sim-bridge/`)

Standalone Swift/ObjC binary for simulator screen capture and HID injection. Communicates with the Electron backend via JSON-over-stdio.

### IPC

Frontend <-> backend communication via Electron's IPC (request/response) and events (push streams).

**Commands** go through typed wrappers in `app/lib/ipc.ts`. **Events** use the pattern `{domain}:{action}:{id}` — e.g. `terminal:data:{session_id}` carries base64-encoded PTY output.

Key event patterns:

| Event                             | Purpose                        |
| --------------------------------- | ------------------------------ |
| `terminal:data:{session_id}`      | PTY output -> xterm.js         |
| `terminal:exit:{session_id}`      | PTY process exited             |
| `agent:status:{workspace_id}`     | Agent state changes            |
| `agent:event:{workspace_id}`      | Claude Code streaming events   |
| `workspace:status:{workspace_id}` | Workspace init complete/failed |

## Workspace lifecycle

Each workspace maps 1:1 with a git worktree stored in `~/.stagehand/worktrees/{RepoName}-stagehand-worktrees/{branch}/`.

1. **Create** — `git worktree add` from the base branch
2. **Setup** — run the pipeline defined in `.stagehand.json`:
   - **Copy** large untracked dirs (e.g. `node_modules`) from the main repo
   - **Symlink** secret/config files (e.g. `.env`) from the main repo
   - **Run commands** (e.g. `pnpm install --frozen-lockfile`) to reconcile
3. **Work** — Claude Code agent operates in the worktree; shell terminals available for manual commands
4. **Review** — view diffs, stage/unstage hunks, commit, merge back to base
5. **Delete** — kills agent + terminals, removes the worktree

### `.stagehand.json`

Drop this in any repo root to configure Stagehand for that project:

```json
{
  "setup": {
    "copy": ["node_modules", "Pods"],
    "symlink": [".env", ".env.local"],
    "commands": ["pnpm install --frozen-lockfile"]
  },
  "terminals": [{ "name": "Shell", "dir": "." }],
  "workspace_env": {
    "name": "PORT",
    "base_value": 3000,
    "range": 100,
    "strategy": "sequential"
  },
  "run": "pnpm start"
}
```

| Field            | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `setup.copy`     | Dirs/files to copy into new worktrees (supports globs) |
| `setup.symlink`  | Files to symlink from the main repo (supports globs)   |
| `setup.commands` | Shell commands to run after copy/symlink               |
| `terminals`      | Tabs to auto-open (name + working directory)           |
| `workspace_env`  | Env var set per-workspace with a unique port/offset    |
| `run`            | Command executed by the Run button                     |

A `.stagehand.local.json` can override/extend the base config (not committed).

### Port isolation

`workspace_env` assigns each worktree a unique value for the named env var. Two strategies:

- **`sequential`** — base + 0, base + 1, base + 2, ...
- **`hash`** (default) — base + (hash(workspace_id) % range)

This lets multiple instances of the same project run in parallel without port conflicts.

## Key technical decisions

| Decision                                  | Rationale                                                          |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `node-pty` for terminals                  | Same as VSCode — spawns immediately, reliable PTY implementation   |
| Git CLI over libgit2                      | libgit2 has incomplete worktree support                            |
| Claude Code as subprocess (`stream-json`) | Piped stdin/stdout, structured JSON events, not interactive PTY    |
| Simulator bridge as standalone binary     | Swift/ObjC code uses private frameworks that can't run in Node.js  |
| Worktrees outside project directory       | Keeps the user's repo and git client clean                         |
| Zustand over Redux/Context                | Minimal boilerplate, no providers, good async story                |
| `@codingame/monaco-vscode-api`            | Embeds real VS Code editor/explorer/search without forking VS Code |

## License

See [LICENSE](LICENSE) for details.
