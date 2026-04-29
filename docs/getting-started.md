# Getting started

Argus is a desktop app for macOS (Apple Silicon) that runs Claude Code agents
in parallel — each in its own isolated git worktree, with a live iOS
simulator, Android emulator, embedded Chromium browser, and a real VS Code
editor side-by-side.

This page walks through the first five minutes: install, prerequisites, and
opening your first project.

---

## Install

Download the `.dmg` (or `.zip`) for Apple Silicon from the
[Argus product page](/argus). Drag it to **Applications** and launch it from
Spotlight or the Dock.

Argus is signed with a Developer ID and notarised by Apple. The first launch
takes a moment while macOS verifies the signature.

Updates ship automatically. When a new version is released, Argus downloads
it in the background and prompts you to relaunch.

---

## Prerequisites

Argus orchestrates other tools rather than reimplementing them, so a few
things should already be on your machine. The first-launch onboarding runs
a Preflight check and tells you exactly what's missing.

| Tool                  | Why                                                                                                        | Install hint                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **`git`**             | Worktrees, branches, commits — the entire session model is built on git worktrees.                         | `xcode-select --install` brings it in.    |
| **`claude` CLI**      | Each agent is a Claude Code subprocess. Argus pipes JSON over stdin/stdout to it.                          | See [claude.com/claude-code](https://docs.anthropic.com/en/docs/claude-code). |
| **Xcode** (optional)  | Required if you want iOS simulators. Only the Command Line Tools are needed for git.                       | Mac App Store.                            |
| **Android SDK** (optional) | Required if you want Android emulators. Argus discovers your `ANDROID_HOME` / `ANDROID_SDK_ROOT`.     | Android Studio installs the SDK for you.  |
| **Node.js / pnpm / npm / yarn** (optional) | Whatever package manager your project uses — Argus runs your project's setup commands as-is. | Whatever you already use.                 |

You don't need to authenticate Argus separately; it uses the same `claude`
CLI authentication that's already on your machine.

---

## First launch

The first time you open Argus, it walks you through:

1. **Preflight** — confirms `git`, `claude`, simulator support, etc. Each
   row links to a fix if something's missing.
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
2. Click **New session** in the sidebar.
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
  the three-panel layout.
- [Features](/argus/docs/features) — simulators, browser, terminals,
  run commands, git workflow, VS Code, permissions.
- [Project settings](/argus/docs/project-settings) — every option in
  `.argus.json`.
- [App settings](/argus/docs/app-settings) — personal preferences.
- [Telemetry](/argus/docs/telemetry) — exactly what Argus sends home.
