# Features

A catalogue of what Argus supports today. Each section names the surface
area, what's included, and which configuration controls it.

---

## iOS simulators

- Boot any installed iOS Simulator runtime per-session.
- Mirrored live in the runtime panel.
- Agents (and you) can tap, swipe, scroll, type, press hardware
  buttons, rotate, and trigger system gestures.
- Per-session isolation — parallel sessions never interfere.

Enable iOS in `.argus.json` with `"platforms": ["ios", …]`.

---

## Android emulators

- Boot any installed AVD per-session.
- Mirrored live in the runtime panel.
- Tap, swipe, type, hardware keys.
- Per-session isolation, like iOS.

Enable Android in `.argus.json` with `"platforms": ["android", …]`.

---

## Embedded Chromium browser

- Chromium running inside Argus.
- Per-session: the browser navigates to the session's allocated URL.
- Agents can click, type, scroll, fill forms, and run JavaScript.
- DevTools available on demand, per-session.

Enable the web platform with `"platforms": ["web", …]` and configure
`browser_url` (e.g. `"http://localhost:{PORT}"`).

---

## Terminals

- Real terminals, per-session, started in the session's worktree.
- Configurable in `.argus.json` under `terminals[]` — declare a name,
  starting directory, and any auto-launch commands.
- Both the agent and you can drive the same terminal.

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
- **Diff viewer** — file- and hunk-level, side-by-side or inline.
- **Hunk-level staging** — accept individual hunks, reject others, and
  refine before committing.
- **Commit & amend** — commit from the UI.
- **Stash** — list, apply, drop.
- **Merge & rebase** — Argus runs them for you and surfaces conflicts
  with an inline resolver.
- **Pull request** — open a draft PR directly from the session.

---

## VS Code editor

- A real, embedded VS Code instance.
- Extensions, multi-file edits, project-wide search, IntelliSense, the
  command palette — all functional.
- The editor opens the session's worktree, so what you see is what the
  agent has been changing.

---

## Permissions

- Every tool call an agent makes asks for approval if it isn't already
  allow-listed.
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

Argus checks for updates in the background and prompts you to relaunch
when one is ready.

---

## What Argus deliberately does _not_ do

- **No cloud sync.** Sessions, worktrees, and conversations live on your
  machine.
- **No mandatory account.** You sign into the `claude` CLI; Argus has no
  account of its own.
- **Telemetry is off by default.** Opt in once during onboarding (or
  any time from App settings). When on, Argus sends anonymous,
  feature-level events to PostHog along with standard SDK properties
  (browser/OS/screen/timezone). The raw IP is discarded post-ingestion,
  but city-level GeoIP is still derived from it before discard. No
  session replay, no DOM autocapture, no prompts, no file contents, no
  project names — full audit in [Telemetry](/argus/docs/telemetry).
- **No proprietary editor.** Argus embeds VS Code; your existing
  extensions and muscle memory carry over.
