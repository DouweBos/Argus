# Argus 👁️

> _In the myth, Argus Panoptes had a hundred eyes — some always open, some always watching. When he was slain, the goddess Hera set his eyes into the tail of the peacock, where they glitter to this day._
>
> _This repo is those eyes. The [`@argus/peacock`](./packages/peacock) design system is where they live._

**An agentic IDE for mobile _and_ web development.** 🦚 Orchestrate a flock of Claude Code agents in parallel — each in its own isolated git worktree — with live iOS simulators, Android emulators, an embedded Chromium browser, a full VS Code editor, and a first-class git workflow, all in one desktop app.

Argus treats AI agents the way modern teams treat branches: **spin one up for every idea, let them run side by side, review the diffs, and merge what sings.** One developer. A hundred hands. A hundred eyes. Zero context-switching tax.

---

### 🎉 We just welcomed our first collaborator — Argus is officially a flock.

Two pairs of eyes already. If you're into agentic tooling, mobile dev infra, or just want to help a weird and beautiful IDE grow more feathers — [come hack with us](#contributing). 🪶

---

## Why Argus

Coding agents are fast. What slows us down is everything _around_ them — juggling branches, resetting state between attempts, manually poking at simulators, waiting for one idea to finish before the next can start. Death by a thousand context switches.

Argus opens another eye for every one of those problems:

- **👁️ Parallel by default.** Every workspace is an isolated worktree with its own agent, its own simulator, its own terminals. Fan out five ideas at once — none of them step on each other's tails.
- **👁️ See what the agent sees.** Live simulator/emulator mirroring, an embedded Chromium browser with CDP screencast, and streaming tool-call cards — the agent's every move, rendered in real time.
- **👁️ Review like a human.** A full git workflow (branches, commits, stashes, hunk-level staging, diff viewer) is baked into the UI. Accept, reject, or refine without ever leaving the app.
- **👁️ Edit like an engineer.** A real embedded VS Code (via `@codingame/monaco-vscode-api`) — extensions, search, intellisense, multi-file edits. Not a toy textarea. Not a chat box pretending.

## Highlights

### 🦚 Multi-agent orchestration

- Spin up as many Claude Code agents as you have workspaces — each one scoped to its own worktree, chat history, model, and permissions.
- **Orchestration tree** visualizes agent-spawned subagents and their tool calls as a live hierarchy.
- Swap models per-agent on the fly (`ModelPicker`); resume long-running conversations from persisted chat history.
- Granular **permission broker** — approve, deny, or "always allow" specific tool patterns without stopping the agent.

### 🪶 Isolated workspaces

- Each workspace is a real `git worktree` under `~/.argus/worktrees/{Repo}-argus-worktrees/{branch}/` — outside your project directory to keep your primary checkout pristine.
- Configurable **setup pipeline** (`.argus.json`): copy `node_modules`/`Pods`, symlink `.env` secrets, run install commands — all on worktree creation.
- **Port isolation** assigns each worktree a unique value for a named env var (sequential or hashed), so multiple dev servers can run in parallel without conflict.
- One-click **merge back** to the base branch when the work is approved.

### 👁️ Live device & browser runtime

- **iOS simulators** streamed into the app via a native Swift/ObjC bridge with HID injection (tap, scroll, type).
- **Android emulators** via a bundled scrcpy-server pipeline with H.264 decoding and live input.
- **Embedded web browser** with Chrome DevTools Protocol screencasting — perfect for agents that build and test web views.
- The `conductor` CLI is pre-wired so agents can drive simulators/emulators programmatically for UI testing.

### 🌿 Built-in git workflow

- Branch switcher, commit log, stashes, and a graph view — all backed by the git CLI, no libgit2 limitations.
- **Hunk-level staging** in the diff viewer. Edit a diff by hand before committing.
- Commit, merge, and stash from the UI; or drop into a shell terminal and do it yourself.

### ⌨️ Real editor, real terminals

- Embedded **VS Code** (Monaco + `@codingame/monaco-vscode-api`) with the explorer, search, file watchers, and language support you expect — no fork, no reinvention.
- **xterm.js + node-pty** terminals per workspace, same stack as VS Code, with proper shell environment and PATH fixup.
- Auto-opened terminal tabs per workspace, configurable in `.argus.json`.

### 🔌 MCP-ready

- Built-in **Model Context Protocol** server exposes Argus primitives (workspaces, files, projects) to any MCP-aware agent or tool. Bring your own beak.

## Install

### Prerequisites

- macOS 13+
- [mise](https://mise.jdx.dev/) — pins Node 24 and pnpm 10 (see `mise.toml`)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `claude` must be on your `PATH`
- Xcode + iOS Simulators (for iOS features)
- Android SDK + an AVD (for Android features, optional)

```sh
mise install        # node, pnpm
pnpm install        # dependencies + conductor + scrcpy-server bootstrap
```

### Native bridge (required for iOS simulator capture)

```sh
pnpm build:bridge   # or: cd native/argus-sim-bridge && make
```

## Run

```sh
pnpm dev            # Vite dev server + Electron
pnpm build          # type-check + Vite build + Electron compile
pnpm build:app      # produce .app / .dmg via electron-builder
pnpm lint           # tsc + eslint + prettier + CSS-module usage check
pnpm test           # vitest
```

## Configure a project: `.argus.json`

Drop this in any repo root to make it Argus-ready:

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

| Field            | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `setup.copy`     | Dirs/files copied into each new worktree (supports globs) |
| `setup.symlink`  | Files symlinked from the main repo (supports globs)       |
| `setup.commands` | Shell commands run after copy/symlink                     |
| `terminals`      | Tabs auto-opened per workspace (name + working dir)       |
| `workspace_env`  | Env var set per-workspace with a unique port/offset       |
| `run`            | Command executed by the Run button                        |

`.argus.local.json` (gitignored) overrides or extends the base config.

## Architecture

Three-panel desktop shell: sources/workspaces on the left, the agent + editor + git UI in the center, and the live runtime (simulator, browser, terminals) on the right.

### Frontend — `app/`

React 19 + TypeScript + Vite 7. Zustand for state, CSS Modules for styling. Typed IPC wrappers in `app/lib/ipc.ts`; shared types in `app/lib/types.ts`.

| Area                   | What lives here                                                                 |
| ---------------------- | ------------------------------------------------------------------------------- |
| `components/agent/`    | Chat, tool-call cards, orchestration tree, git views, diff viewer, model picker |
| `components/editor/`   | Embedded Monaco / VS Code panel                                                 |
| `components/runtime/`  | Simulator view, web browser view, terminal tabs, merge bar                      |
| `components/sidebar/`  | Workspace list, create/setup dialogs, branch switcher                           |
| `components/toolrail/` | Right-rail tools (simulator, terminal, changes summary)                         |
| `stores/`              | Zustand stores — workspace, terminal, agent, conversation                       |

### Backend — `electron/`

Electron main process in TypeScript. All services are single-threaded around an `AppState` singleton.

| Service                | Responsibility                                                          |
| ---------------------- | ----------------------------------------------------------------------- |
| `services/agent/`      | Claude Code subprocess, stream-json parsing, permission broker, history |
| `services/workspace/`  | Worktree CRUD, setup pipeline, file watcher, merge engine               |
| `services/terminal/`   | `node-pty` multiplexer with environment fixup                           |
| `services/simulator/`  | iOS (`simctl` + native bridge) and Android (scrcpy + H.264) pipelines   |
| `services/browser/`    | CDP screencast + MJPEG pipe for the embedded web browser                |
| `services/mcp/`        | MCP server exposing Argus primitives to external agents                 |
| `services/extensions/` | VS Code extension loading for the embedded editor                       |
| `services/file/`       | Workspace file list/read/write                                          |
| `services/shell/`      | One-shot shell operations                                               |

### Native — `native/argus-sim-bridge/`

Standalone Swift/ObjC binary for iOS simulator screen capture and HID injection. Uses private CoreSimulator frameworks that can't run inside Node.js, so it speaks JSON-over-stdio to the Electron backend.

### IPC

Frontend ↔ backend over Electron IPC. Commands go through `app/lib/ipc.ts` wrappers; events follow `{domain}:{action}:{id}` (e.g. `terminal:data:{session_id}`, `agent:event:{workspace_id}`).

## Workspace lifecycle — the life of a feather

1. **🥚 Create** — `git worktree add` from the base branch. A new eye opens.
2. **🌱 Setup** — the `.argus.json` pipeline runs: copy, symlink, commands. The nest is built.
3. **🦚 Work** — the agent does its thing in the worktree; terminals, simulator, and browser attach automatically.
4. **🔍 Review** — inspect the diff, stage hunks, commit, optionally stash. The eye judges.
5. **🌿 Merge** — one-click merge back into the base branch. The feather joins the tail.
6. **🍂 Delete** — kills the agent + terminals and removes the worktree. The eye closes.

## Key technical decisions

| Decision                                   | Why                                                               |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `node-pty` for terminals                   | Same as VS Code — fast spawn, reliable PTY                        |
| Git CLI over libgit2                       | libgit2's worktree support is incomplete                          |
| Claude Code as a `stream-json` subprocess  | Structured events over piped stdio, not a fragile interactive PTY |
| Native binary for the iOS simulator bridge | Private CoreSimulator frameworks are unreachable from Node.js     |
| Worktrees outside the project directory    | Keeps the user's repo and git client clean                        |
| Zustand over Redux/Context                 | Minimal boilerplate, no providers, clean async                    |
| `@codingame/monaco-vscode-api`             | Real VS Code — editor, explorer, search — without forking VS Code |
| MCP server baked in                        | Any MCP-aware agent can drive Argus workspaces out of the box     |

## Contributing 🪶

Argus is small, opinionated, and moving fast — which is the best time to join. Hack on agent orchestration, polish the simulator pipeline, ship a new MCP primitive, draw an icon in Peacock, file a thoughtful bug report — **all of it counts. All of it is welcome.**

A few ground rules (the full list nests in `CLAUDE.md`):

- **🦚 Peacock first.** All UI primitives come from [`@argus/peacock`](./packages/peacock). No inline `<svg>` in `app/`, no Tailwind, no ad-hoc icon packs — the feathers live in one place.
- **📏 Keep files focused.** ~500 LOC is the soft ceiling. If it's growing, split it. Small modules, many eyes.
- **🔗 Typed IPC everywhere.** Backend handlers register in `electron/ipc.ts`; frontend wrappers live in `app/lib/ipc.ts`. Keep `types.ts` in sync — the two sides have to see each other.
- **🌿 Worktrees are sacred.** Changes to the worktree lifecycle touch real user repos. Tread lightly. Test with `pnpm dev` before you PR.

Open a PR. Drop into an issue. Poke around and tell us what's broken.

> _The eyes of Argus are many — but there's always room for one more feather._
