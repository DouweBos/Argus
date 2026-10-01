# SwiftUI parity checklist

The cutover gate for [`swiftui-desktop.md`](./swiftui-desktop.md): the native
Mac app replaces Electron only when every row below is ticked in the Mac
column. One row per route in [`docs/routing.md`](../docs/routing.md) and per
feature in [`docs/features.md`](../docs/features.md), plus the core-loop rows
M0/M1 own that `features.md` doesn't catalogue.

Legend: ✅ supported · ◐ partial (Notes say what's missing) · ☐ missing ·
— not applicable (Notes say why).

How to tick a row:

- A row is ✅ in the Mac column only after it was verified by running the Mac
  app against its bundled host — not because the code merged.
- A milestone isn't done until every row naming it is ticked.
- ◐ "in progress (M0/M1)" marks rows being built on the M0/M1 branch; the
  parent agent ticks them once verified.
- The iOS column follows the CLAUDE.md rule: a ☐ there is a gap to close, not a
  decision. A — needs its reason in Notes.

## Routes

### Top-level screens

| Route                                    | Electron | Mac | iOS | Milestone | Notes                                                                                    |
| ---------------------------------------- | -------- | --- | --- | --------- | ---------------------------------------------------------------------------------------- |
| `/` Home / project picker                | ✅       | ◐   | ✅  | M0        | Mac: in progress (M0/M1). iOS: Projects tab.                                             |
| `/agents` Agents overview                | ✅       | ☐   | ◐   | M1        | iOS: agents only per project (iPad sidebar lists them); no cross-session overview.       |
| `/automations`                           | ✅       | ☐   | ✅  | M5        |                                                                                          |
| `/automations/quick` Quick run           | ✅       | ☐   | ✅  | M5        |                                                                                          |
| `/automations/quick/runs/:runId`         | ✅       | ☐   | ✅  | M5        | iOS: shared run screen; save-as-automation via `automations.save_scratch_run`.           |
| `/automations/:automationId`             | ✅       | ☐   | ✅  | M5        | iOS: detail plus a separate editor screen, memories editable.                            |
| `/automations/:automationId/runs/:runId` | ✅       | ☐   | ✅  | M5        |                                                                                          |
| `/devices`                               | ✅       | ☐   | ◐   | M3        | iOS: lists booted devices only; no boot/shutdown or AVD lifecycle.                       |
| `/inbox`                                 | ✅       | ☐   | ✅  | M5        |                                                                                          |
| `/inbox/proposals/:proposalId`           | ✅       | ☐   | ◐   | M5        | iOS: proposals decided inline on a card; no detail screen, no request-revision.          |
| `/notifications`                         | ✅       | ☐   | ☐   | M5        | Warnings & errors list. OS notifications are a separate M1 row.                          |
| `/pull-requests`                         | ✅       | ☐   | ✅  | M4        |                                                                                          |
| `/pull-requests/:owner/:repo/:number`    | ✅       | ☐   | ✅  | M4        | iOS: view, comment, merge.                                                               |
| `/runtimes` Runtimes overview            | ✅       | ☐   | ☐   | M2        | iOS: no terminal or run-command methods on the gateway.                                  |
| `/sessions/:sessionId` (→ home)          | ✅       | ◐   | ◐   | M0        | Mac: in progress (M0/M1). iOS: sessions live inside the project screen, no session home. |
| `/sessions/:sessionId/home`              | ✅       | ☐   | ◐   | M1        | iOS: setup state, land-work card and agents on the project screen; no per-session panel. |
| `/sessions/:sessionId/agents`            | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                                                |
| `/sessions/:sessionId/git`               | ✅       | ☐   | ◐   | M4        | iOS: Changes and Branches screens; see sub-views.                                        |

### Git sub-views (`/sessions/:sessionId/git/:gitView`)

| Sub-view                        | Electron | Mac | iOS | Milestone | Notes                                                                                |
| ------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------ |
| `working`                       | ✅       | ☐   | ◐   | M4        | iOS: read-only diff with commit/push/merge; no staging or discard.                   |
| `branch`                        | ✅       | ☐   | ✅  | M4        |                                                                                      |
| `history`                       | ✅       | ☐   | ◐   | M4        | iOS: per-branch log and commit diff; no graph.                                       |
| `stashes`                       | ✅       | ☐   | ☐   | M4        | iOS: only "stash & switch" on checkout.                                              |
| `reflog`                        | ✅       | ☐   | ☐   | M4        |                                                                                      |
| `conflicts`                     | ✅       | ☐   | ◐   | M4        | iOS: merge blockers shown; no resolver.                                              |
| `branches`                      | ✅       | ☐   | ✅  | M4        | iOS: checkout, create, delete, rename, pin, push, pull.                              |
| `branches/:branchName`          | ✅       | ☐   | ✅  | M4        |                                                                                      |
| `tags`, `tags/:tagName`         | ✅       | ☐   | ☐   | M4        |                                                                                      |
| `submodules`                    | ✅       | ☐   | ☐   | M4        | Project-root sessions only.                                                          |
| `bisect`                        | ✅       | ☐   | ☐   | M4        | Project-root sessions only.                                                          |
| `hooks`                         | ✅       | ☐   | ☐   | M4        | Project-root sessions only.                                                          |
| `compare` (`?left=&right=`)     | ✅       | ☐   | ✅  | M4        |                                                                                      |
| `blame` (`?path=&ref=`)         | ✅       | ☐   | ☐   | M4        | iOS: no file-read method on the gateway.                                             |
| `settings`                      | ✅       | ☐   | ☐   | M4        |                                                                                      |
| `pull-requests`                 | ✅       | ☐   | ◐   | M4        | In code, missing from `routing.md`. iOS: covered by the PR screens, not per session. |
| `branches-review`               | ✅       | ☐   | ☐   | M4        | In code, missing from `routing.md`.                                                  |
| `interactive-rebase` (`?from=`) | ✅       | ☐   | ☐   | M4        | In code, missing from `routing.md`. iOS: only rebase-on-current.                     |

### Navigation

| Item                           | Electron | Mac | iOS | Milestone | Notes                                                                           |
| ------------------------------ | -------- | --- | --- | --------- | ------------------------------------------------------------------------------- |
| Settings dialog (overlay)      | ✅       | ☐   | ◐   | M5        | iOS: device name, appearance, push, Claude accounts, telemetry, computers only. |
| Window tabs                    | ✅       | ☐   | —   | M6        | iOS: window management; a phone switches computers instead.                     |
| Per-tab back / forward         | ✅       | ☐   | ✅  | M5        | Not owned by a plan milestone; assigned M5. iOS: per-section navigation stacks. |
| Deep links (`navigation:goto`) | ✅       | ☐   | ✅  | M5        | iOS: notification taps and Handoff open routes.                                 |
| `?host=` focused host          | ✅       | ☐   | ◐   | M6        | iOS: many paired computers, one connected at a time.                            |

## Features

### Core loop (plan M0/M1, not catalogued in `features.md`)

| Feature                                   | Electron | Mac | iOS | Milestone | Notes                                                                   |
| ----------------------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------------------------- |
| Three-panel window, projects and sessions | ✅       | ◐   | ✅  | M0        | Mac: in progress (M0/M1). iOS: tabs on a phone, split view on an iPad.  |
| Session create / delete, setup progress   | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1). iOS: also retry setup, rename, base branch.   |
| Agent tabs                                | ✅       | ◐   | ◐   | M1        | Mac: in progress (M0/M1). iOS: one agent per screen, no tabs.           |
| Live transcript                           | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Chat input: slash commands                | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Chat input: mentions                      | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Chat input: images                        | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Chat input: model / mode / effort         | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Chat input: message queue                 | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Permission prompts                        | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Plan approval                             | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1). iOS: no draft persistence.                    |
| Questions                                 | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                                               |
| Notifications (OS)                        | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1). iOS: background push.                         |
| Find in chat                              | ✅       | ◐   | ☐   | M1        | Mac: in progress (M0/M1).                                               |
| Transcript text selection                 | ✅       | ◐   | ☐   | M1        | Mac: in progress (M0/M1). iOS: transcript text isn't selectable.        |
| File-path links                           | ✅       | ◐   | ☐   | M1        | Mac: in progress (M0/M1). iOS: no file viewer (no file-read method).    |
| Scratch pads                              | ✅       | ☐   | ✅  | M1        | Sidebar section; not in the M1 list, assigned with the session sidebar. |

### iOS simulators

| Feature                                     | Electron | Mac | iOS | Milestone | Notes                                                |
| ------------------------------------------- | -------- | --- | --- | --------- | ---------------------------------------------------- |
| Boot a runtime per session                  | ✅       | ☐   | ☐   | M3        | iOS: no boot method on the gateway.                  |
| Live mirror in the runtime panel            | ✅       | ☐   | ✅  | M3        |                                                      |
| Tap, swipe, type, buttons, rotate, gestures | ✅       | ☐   | ✅  | M3        | iOS: no system-gesture shortcuts.                    |
| Per-session isolation                       | ✅       | ☐   | ✅  | M3        | Host-side; verify with two sessions running at once. |

### Android emulators

| Feature                     | Electron | Mac | iOS | Milestone | Notes                               |
| --------------------------- | -------- | --- | --- | --------- | ----------------------------------- |
| Boot an AVD per session     | ✅       | ☐   | ☐   | M3        | iOS: no boot method on the gateway. |
| Live mirror                 | ✅       | ☐   | ✅  | M3        |                                     |
| Tap, swipe, type, hard keys | ✅       | ☐   | ✅  | M3        | iOS: also fold poses.               |
| Per-session isolation       | ✅       | ☐   | ✅  | M3        | Host-side.                          |

### Embedded Chromium browser

| Feature                                | Electron | Mac | iOS | Milestone | Notes                                                        |
| -------------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------ |
| Per-session browser at the session URL | ✅       | ☐   | ☐   | M3        | iOS: `browser.watch` exists on the gateway but is unused.    |
| Agents click, type, scroll, run JS     | ✅       | ☐   | —   | M3        | Agent-side; nothing for a phone to render beyond the mirror. |
| DevTools on demand                     | ✅       | ☐   | —   | M3        | Needs a desktop window.                                      |

### Terminals

| Feature                           | Electron | Mac | iOS | Milestone | Notes                                     |
| --------------------------------- | -------- | --- | --- | --------- | ----------------------------------------- |
| Per-session terminals in worktree | ✅       | ☐   | ☐   | M2        | iOS: no terminal methods on the gateway.  |
| `terminals[]` config, auto-launch | ✅       | ☐   | ☐   | M2        |                                           |
| Agent and user share a terminal   | ✅       | ☐   | ☐   | M2        | Mac: needs the scrollback replay command. |

### Run commands

| Feature                                              | Electron | Mac | iOS | Milestone | Notes                                   |
| ---------------------------------------------------- | -------- | --- | --- | --------- | --------------------------------------- |
| `run[]` processes                                    | ✅       | ☐   | ☐   | M2        | iOS: no run-command methods.            |
| `restartOnRerun`, `cwd`, `requires`, `prerequisites` | ✅       | ☐   | ☐   | M2        | Host-side; verify each from the Mac UI. |
| Live output with ANSI colour and links               | ✅       | ☐   | ☐   | M2        |                                         |

### Git workflow

| Feature                            | Electron | Mac | iOS | Milestone | Notes                                                |
| ---------------------------------- | -------- | --- | --- | --------- | ---------------------------------------------------- |
| Branches: create, switch, delete   | ✅       | ☐   | ✅  | M4        |                                                      |
| Worktree per session               | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1), comes with session create. |
| Diff viewer, side-by-side / inline | ✅       | ☐   | ◐   | M4        | iOS: inline only.                                    |
| Hunk-level staging                 | ✅       | ☐   | ☐   | M4        |                                                      |
| Commit & amend                     | ✅       | ☐   | ◐   | M4        | iOS: commit only, no amend.                          |
| Stash: list, apply, drop           | ✅       | ☐   | ☐   | M4        | iOS: only "stash & switch".                          |
| Merge & rebase, conflict resolver  | ✅       | ☐   | ◐   | M4        | iOS: merge into base, rebase current; no resolver.   |
| Open a draft PR                    | ✅       | ☐   | ✅  | M4        |                                                      |

### Remote access

| Feature                             | Electron | Mac | iOS | Milestone | Notes                                                                   |
| ----------------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------------------------- |
| Gateway on/off, pairing             | ✅       | ☐   | ✅  | M5        | iOS: the pairing client. Mac: host-tier commands over the local socket. |
| Ways in: LAN, Tailscale, Cloudflare | ✅       | ☐   | ✅  | M5        | iOS: races the live addresses.                                          |
| Grants per device                   | ✅       | ☐   | —   | M5        | Host-tier; exposing grant changes over the gateway is a security risk.  |
| Background push                     | ✅       | ☐   | ✅  | M5        | Mac: host-side sending; the Mac UI only configures it.                  |
| Web client (phone / tablet layouts) | ✅       | ☐   | ✅  | M5        | Mac: the bundled host must serve `argus-web`. iOS: iPad split view.     |
| Handoff                             | ✅       | ☐   | ✅  | M5        | Not owned by a plan milestone; assigned M5.                             |
| Revoke a device                     | ✅       | ☐   | —   | M5        | Host-tier, same reason as grants.                                       |

### Working across several Macs

| Feature                                  | Electron | Mac | iOS | Milestone | Notes                                         |
| ---------------------------------------- | -------- | --- | --- | --------- | --------------------------------------------- |
| Attach several hosts, routed per subject | ✅       | ☐   | ◐   | M6        | iOS: one computer at a time.                  |
| Pair another Mac with Admin              | ✅       | ☐   | —   | M6        | Admin is a desktop-to-host grant.             |
| Offline host keeps its last snapshot     | ✅       | ☐   | ◐   | M6        | iOS: shows cached lists; no per-host routing. |

### Huddles

| Feature                                   | Electron | Mac | iOS | Milestone | Notes                                  |
| ----------------------------------------- | -------- | --- | --- | --------- | -------------------------------------- |
| Start / end, approve guests, scoped grant | ✅       | ☐   | ☐   | M5        | iOS: no huddle methods on the gateway. |
| Typing presence, device driver, refusals  | ✅       | ☐   | ☐   | M5        |                                        |
| Side chat                                 | ✅       | ☐   | ☐   | M5        |                                        |

### Argus Server

| Feature                      | Electron | Mac | iOS | Milestone | Notes                                                                                                             |
| ---------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Headless host, tray-only app | ✅       | ☐   | —   | M7        | The plan doesn't say what replaces it at cutover (plain `argus-host` or a Mac target). iOS: a phone isn't a host. |

### Automations

| Feature                                   | Electron | Mac | iOS | Milestone | Notes                                                 |
| ----------------------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------- |
| Triggers: schedule and signals            | ✅       | ☐   | ✅  | M5        |                                                       |
| Proposals: accept, mark done, dismiss     | ✅       | ☐   | ✅  | M5        |                                                       |
| Proposal request-revision                 | ✅       | ☐   | ☐   | M5        | No gateway method.                                    |
| Autonomy ladder                           | ✅       | ☐   | ◐   | M5        | iOS: per-automation guardrails; no app-level default. |
| Memories, playbook revision, run feedback | ✅       | ☐   | ✅  | M5        |                                                       |

### MCP server

| Feature                                     | Electron | Mac | iOS | Milestone | Notes                                                                                                             |
| ------------------------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Argus MCP for agents, gated for automations | ✅       | ☐   | —   | M0        | Host-side; verify an agent spawned from the Mac app gets the tools. iOS: agents it spawns get them from the host. |
| MCP server settings                         | ✅       | ☐   | ☐   | M5        |                                                                                                                   |

### Permissions

| Feature                                | Electron | Mac | iOS | Milestone | Notes                                                  |
| -------------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------ |
| Inline approval beside the tool call   | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1).                              |
| "Always allow" patterns                | ✅       | ◐   | ☐   | M1        | Mac: in progress (M0/M1). iOS: allow once / deny only. |
| Default permission mode (App settings) | ✅       | ☐   | ◐   | M5        | iOS: per-agent mode switch; no default setting.        |

### Orchestration tree

| Feature                               | Electron | Mac | iOS | Milestone | Notes                                                                                |
| ------------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------ |
| Subagent tree, live status            | ✅       | ☐   | ◐   | M1        | Not in the M1 list; assigned with agent tabs. iOS: subagents as tool cards, no tree. |
| Per-agent model swap mid-conversation | ✅       | ◐   | ✅  | M1        | Mac: in progress (M0/M1), part of the model picker.                                  |
| Persisted history, resume             | ✅       | ☐   | ◐   | M1        | iOS: read stopped transcripts; no resume.                                            |

### Organisations

| Feature                            | Electron | Mac | iOS | Milestone | Notes                         |
| ---------------------------------- | -------- | --- | --- | --------- | ----------------------------- |
| Organisations in App settings      | ✅       | ☐   | ☐   | M5        | iOS: no app-settings methods. |
| Org host session, child sessions   | ✅       | ☐   | ☐   | M5        |                               |
| Member-repo org context for agents | ✅       | ☐   | —   | M5        | Host-side prompt context.     |

### Onboarding

| Feature                          | Electron | Mac | iOS | Milestone | Notes                                                           |
| -------------------------------- | -------- | --- | --- | --------- | --------------------------------------------------------------- |
| Welcome + telemetry choice       | ✅       | ☐   | ✅  | M5        | iOS: its own consent sheet and pairing flow.                    |
| Setup cards with one-click fixes | ✅       | ☐   | ◐   | M5        | iOS: Claude account sign-in only; the rest are Mac-local fixes. |
| `.argus.json` generation         | ✅       | ☐   | ☐   | M5        |                                                                 |

### Tools

| Feature                         | Electron | Mac | iOS | Milestone | Notes                                |
| ------------------------------- | -------- | --- | --- | --------- | ------------------------------------ |
| Tool toggles (Settings → Tools) | ✅       | ☐   | ☐   | M5        | Also `.argus.json#tools.disabled`.   |
| Device recording                | ✅       | ☐   | ✅  | M3        |                                      |
| Device UI inspector             | ✅       | ☐   | ☐   | M3        |                                      |
| Device control                  | ✅       | ☐   | ✅  | M3        | iOS: touch and keys, not deep links. |
| Device debug (logs, probes)     | ✅       | ☐   | ☐   | M3        |                                      |

### Auto-update and telemetry

| Feature                              | Electron | Mac | iOS | Milestone | Notes                                      |
| ------------------------------------ | -------- | --- | --- | --------- | ------------------------------------------ |
| Background updates, relaunch prompt  | ✅       | ☐   | —   | M7        | Mac: Sparkle. iOS: App Store / TestFlight. |
| Release channels (latest/beta/alpha) | ✅       | ☐   | —   | M7        | iOS: TestFlight is the beta channel.       |
| Telemetry consent (presence / full)  | ✅       | ☐   | ✅  | M7        |                                            |
