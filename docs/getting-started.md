# Getting started

Argus is a desktop app for macOS (Apple Silicon) that runs Claude Code agents
in parallel — each in its own isolated git worktree, with a live iOS
simulator, Android emulator, embedded Chromium browser, and a full git
client side-by-side.

This page walks through the first five minutes: install, prerequisites, and
opening your first project.

---

## Install

Download the `.dmg` (or `.zip`) for Apple Silicon from the
[Argus product page](/argus). Drag it to **Applications** and launch it.

Updates install automatically.

---

## Prerequisites

Argus orchestrates other tools rather than reimplementing them, so a few
things should already be on your machine. Argus checks for them and shows a
card on the home screen for anything that's missing.

| Tool                       | Why                                                             |
| -------------------------- | --------------------------------------------------------------- |
| **`git`**                  | Sessions are isolated git worktrees, so git is required.        |
| **`claude` CLI**           | Argus runs Claude Code agents — install and sign in to the CLI. |
| **Xcode** (optional)       | Required if you want iOS simulators.                            |
| **Android SDK** (optional) | Required if you want Android emulators.                         |
| **Project tooling**        | Whatever your project already needs — Node, pnpm, Cocoapods, …  |

You don't need to authenticate Argus separately; it uses the same `claude`
CLI authentication that's already on your machine.

---

## First launch

The first time you open Argus you get a short welcome and a telemetry
choice, then the app itself. From there:

1. **Fix anything flagged** — the home screen shows a card for each
   missing piece (`claude` CLI, Claude sign-in, git identity, simulator
   support, notifications) with a one-click fix.
2. **Pick a project** — point at a git repo on disk.
3. **Generate `.argus.json`** — Argus reads `package.json`, `Podfile`,
   `build.gradle`, and friends to infer how your project sets up. You can
   choose between **Quick generate** (fast, deterministic) and **Generate
   with Claude** (the `claude` CLI inspects your project and produces a
   tailored config). Either way, Argus shows the proposed file for review
   before writing it to your repo.

`.argus.json` is checked into your repo so the whole team shares the same
worktree setup. See [Project settings](/argus/docs/project-settings) for
every field it can contain.

---

## Your first session

A **session** is the unit of work in Argus. One session = one isolated git
worktree + one Claude Code agent + the runtime views (simulators, browser,
terminals) attached to it.

To start one:

1. Open the project from the home screen.
2. Click **New session**.
3. Type a goal in plain English — the agent picks up from there.

Argus creates a fresh worktree under `~/.argus/worktrees/`, runs your
project's setup commands, allocates ports if your `.argus.json` declares a
`workspace_env`, boots simulators per-platform, and starts the agent. You
can fan out five sessions in parallel and they won't step on each other.

When a session is done, Argus helps you review the diff hunk-by-hunk,
commit, and merge or open a PR — without leaving the app.

---

## Where to go next

- [Concepts](/argus/docs/concepts) — sessions, worktrees, agents,
  and how Argus organises work.
- [Features](/argus/docs/features) — simulators, browser, terminals,
  run commands, git workflow, remote access, permissions.
- [Project settings](/argus/docs/project-settings) — every option in
  `.argus.json`.
- [App settings](/argus/docs/app-settings) — personal preferences.
- [Telemetry](/argus/docs/telemetry) — exactly what Argus sends home.
