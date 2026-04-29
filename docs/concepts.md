# Concepts

This page introduces the vocabulary you'll see throughout the app and the
rest of these docs. Each concept maps to something concrete on disk — Argus
is deliberately built on filesystem and git primitives so nothing is
hidden inside a database.

---

## Project

A **project** is just a git repository on your machine. Argus opens a
project by pointing at its root directory; it never copies your repo or
moves files around inside it.

Each project has a single `.argus.json` at its root. This is the team-shared
configuration that tells Argus how to set up worktrees, what commands to
run, which platforms it targets, and so on. See
[Project settings](/argus/docs/project-settings).

---

## Session

A **session** is the unit of work. Each session has:

- Its own **isolated git worktree** under
  `~/.argus/worktrees/{Repo}-argus-worktrees/{branch}/`.
- Its own **Claude Code agent** subprocess — independent conversation,
  independent permissions, independent tool history.
- Its own **runtime views** — simulators, embedded browser, run command
  output, terminals — that mirror the state of _that worktree only_.
- Its own **branch**, created from `main` (or your configured base
  branch) when the session starts.

Sessions are designed to run in parallel. You can have ten sessions open
and they don't share state, processes, or working trees. When a session
finishes, you merge or PR its branch back to `main` and delete the
worktree — Argus offers a one-click cleanup for both.

---

## Worktree

A **worktree** is a checkout of your repo into a different directory,
managed by `git worktree`. Argus uses one worktree per session to keep
sessions truly independent.

Your _primary_ checkout — the one you cloned into — is never touched by
agents. Argus puts every session's worktree under
`~/.argus/worktrees/`, so your project directory stays clean.

Setup for a fresh worktree (copying `node_modules`, symlinking `.env`,
running `pnpm install`, etc.) is configured in `.argus.json`.

---

## Agent

An **agent** is a running Claude Code process bound to a session's
worktree. Its streaming tool calls appear in the Agent area as they
happen.

Each tool call surfaces as a card you can expand to inspect arguments and
results. If a tool needs permission, the **permission broker** asks you
inline without halting the agent — you can approve once, deny, or
allow-list a pattern for the rest of the session.

Argus also supports nested **subagents** (an agent spawning another agent
to delegate work). The orchestration tree visualises the live hierarchy.

---

## Workspace, Agent, Runtime

Argus organises work around three areas:

| Area          | What lives there                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace** | Projects, sessions, and organisations — pick what to work on.                                                                      |
| **Agent**     | The agent's chat thread, tool-call timeline, and prompt input.                                                                     |
| **Runtime**   | Live view of the agent's work: iOS simulator, Android emulator, embedded browser, run output, terminals, git diff, VS Code editor. |

Every screen has a URL. `Cmd+[` and `Cmd+]` navigate back and forward;
deep-link any session or project view directly.

---

## Runtime view

A **runtime view** is anything in the Runtime area: a simulator, an
emulator, the embedded Chromium browser, run-command output, a
terminal, the git diff viewer, or the VS Code editor.

Most runtime views are **per-session** — they reflect the state of the
session's worktree, not your primary checkout. Simulators boot fresh per
session; the browser navigates to the URL allocated for that session;
terminals start in the worktree directory.

---

## Run command

A **run command** is a long-running process you've declared in
`.argus.json` (e.g. `pnpm dev`, `expo start`). Argus runs it inside the
session's worktree and streams its output to the Runtime. You can
restart, stop, and inspect each one. Run commands can declare
prerequisites (`requires: ["backend"]`) so a frontend dev server only
starts once its backend is up.

See [Project settings → Run commands](/argus/docs/project-settings) for
the full schema.

---

## Organisation

An **organisation** groups multiple repositories that ship as one product
— for example, a mobile app, a backend, and a marketing site that each
live in separate repos.

When a session belongs to an organisation, the agent receives extra
context about the sibling repos: what they do, where they live, and how
to spawn agents inside them. This unlocks cross-repo work — a single
prompt can drive coordinated changes across a frontend repo and its API.

---

## Permission broker

Every tool call an agent makes is mediated by Argus's permission broker.
You can:

- **Approve once** — let the call go through, ask again next time.
- **Always allow this pattern** — e.g. "any read inside `src/`".
- **Deny** — the agent gets a refusal back and adapts.

The default permission mode is configurable in App settings. The broker
runs inline, so you never have to stop the agent to grant access.
