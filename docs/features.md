# Features

A catalogue of what Argus supports today. Each section names the surface
area, what's included, and which configuration controls it.

---

## iOS simulators

- Boot any installed iOS Simulator runtime per-session.
- Mirrored live in the runtime panel using a native macOS bridge
  (`argus-sim-bridge`) — Argus captures the simulator's frame buffer
  directly rather than screen-recording the OS.
- HID injection: agents (and you) can tap, swipe, scroll, type, press
  hardware buttons, rotate, and trigger system gestures.
- Per-session isolation: each session boots its own simulator clone, so
  parallel sessions never interfere with each other.
- Argus discovers your installed runtimes via `simctl` — you don't
  configure simulators directly.

Enable iOS in `.argus.json` with `"platforms": ["ios", …]`.

---

## Android emulators

- Boot any installed AVD per-session.
- Mirrored using `scrcpy` — bundled with Argus, no separate install.
- HID injection: tap, swipe, type, hardware keys.
- Per-session isolation, like iOS.

Argus discovers AVDs from `$ANDROID_HOME` / `$ANDROID_SDK_ROOT`.

Enable Android in `.argus.json` with `"platforms": ["android", …]`.

---

## Embedded Chromium browser

- Real Chromium running inside Argus, with the Chrome DevTools Protocol
  (CDP) screencast surfaced into the runtime panel.
- Per-session: the browser navigates to the session's allocated URL (you
  declare a `browser_url` template in `.argus.json` that's
  port-substituted per session).
- HID injection: agents can click, type, scroll, fill forms, and run
  JavaScript via CDP.
- DevTools available on demand, per-session.

Enable the web platform with `"platforms": ["web", …]` and configure
`browser_url` (e.g. `"http://localhost:{PORT}"`).

---

## Terminals

- Real PTY-backed terminals (the same `node-pty` library VS Code uses).
- Per-session, started in the session's worktree directory.
- Configurable in `.argus.json` under `terminals[]` — declare a name,
  starting directory, and any auto-launch commands. Argus opens them on
  session start.
- You can also open ad-hoc terminals at any time.

Both the agent and you can drive the same terminal — useful for paired
debugging.

---

## Run commands

- Long-running processes declared in `.argus.json` under `run[]` —
  typically your dev server, watcher, or build.
- Each run command has a title, a shell command, and optional flags:
  - `restartOnRerun` — kill and restart on every relaunch.
  - `cwd` — run in a subdirectory of the worktree.
  - `requires` — wait for other run commands by title before starting.
  - `prerequisites` — block start until a check command passes.
- Output is streamed live into the runtime panel with ANSI colour and
  link detection.

See [Project settings → Run commands](/argus/docs/project-settings) for
the full schema.

---

## Git workflow

A real git workflow lives inside Argus:

- **Branches** — create, switch, delete; sessions branch from your
  configured base branch automatically.
- **Worktrees** — one per session; managed for you.
- **Diff viewer** — file-level and hunk-level, with side-by-side and
  inline modes.
- **Hunk-level staging** — accept individual hunks, reject others, and
  refine before committing.
- **Commit & amend** — commit from the UI with the conventional
  one-sentence subject style.
- **Stash** — list, apply, drop; useful when an agent needs to test a
  clean state.
- **Merge & rebase** — Argus runs `git merge` / `git rebase` for you and
  surfaces conflicts with an inline resolver.
- **Pull request** — open a draft PR via `gh` directly from the session.

Argus uses the git CLI under the hood (not libgit2), so anything you can
do in your shell, Argus can do — and vice versa.

---

## VS Code editor

- A real, embedded VS Code via `@codingame/monaco-vscode-api`.
- Extensions, multi-file edits, project-wide search, IntelliSense, the
  command palette — all functional.
- The editor opens the session's worktree, so what you see is what the
  agent has been changing.
- Not a chat box pretending to be an IDE.

---

## Permission broker

- Every tool call an agent makes runs through Argus's permission broker.
- Inline approval — the agent isn't halted; the prompt appears beside
  the tool call and the agent waits for your response.
- "Always allow" patterns persist for the rest of the session (or until
  you revoke them).
- Default permission mode is configurable in App settings:
  `default`, `acceptEdits`, `bypassPermissions`, `plan`.

---

## Orchestration tree

- Visualises agents that have spawned subagents to delegate work.
- Live: subagent status updates in real time as they run.
- Per-agent model swapping — change the model on a running agent
  mid-conversation.
- Persisted history — long-running conversations are saved to disk and
  can be resumed across app restarts.

---

## Organisations

- Group multiple repos that ship as one product (e.g. mobile app +
  backend + marketing site).
- An **org host** session is a neutral cross-repo agent — it can spawn
  child sessions inside specific member repos to coordinate changes.
- Each member repo's agent receives organisation context: what the org
  does, what the sibling repos are for, and how to delegate to them.

Organisations are configured in App settings.

---

## Onboarding

- **Preflight** — checks `git`, `claude`, simulator support, and other
  prerequisites with one-click hints to fix anything missing.
- **`.argus.json` generation** — Argus inspects your project and either
  writes a sensible default (Quick generate) or asks the `claude` CLI
  for a tailored config (Generate with Claude). Both modes show the
  proposed file for review before writing.

---

## Auto-update

- Signed and notarised macOS arm64 builds.
- Updates fetched through the houwert.dev → GitHub Releases reverse
  proxy, so the update channel stays under our domain.
- Background download; relaunch when convenient.

---

## What Argus deliberately does *not* do

- **No cloud sync.** Sessions, worktrees, and conversations live on your
  machine.
- **No mandatory account.** You sign into the `claude` CLI; Argus has no
  account of its own.
- **No telemetry by default for privacy-sensitive data.** Anonymous
  distinct id only, opt-out toggle in App settings, full event catalogue
  in [Telemetry](/argus/docs/telemetry).
- **No proprietary editor.** Argus embeds VS Code; your existing
  extensions and muscle memory carry over.
