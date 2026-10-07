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
- M0/M1 rows were verified on 2026-10-01 by running the Mac app against a
  throwaway Argus home; ◐ rows say what is still unverified or missing.
- M3 rows were verified on 2026-10-03 the same way, against a simulator, a tvOS
  simulator and an AVD created for the test, and the Conductor browser.
- M4 rows were verified on 2026-10-03/04 the same way, against scratch repos
  under `/tmp` (with a bare `origin`, a linked worktree session and a 20k-commit
  history); pull requests against a read-only clone of a public repo.
- M5 rows were verified on 2026-10-04 the same way, with a scratch `HOME` too so
  account, git and Claude CLI state stayed off the real machine; pairing used a
  throwaway local client, never a phone.
- M6 rows were verified on 2026-10-04 by pairing the Mac app (scratch Argus
  home) with a second `argus-host` started on its own scratch home and port,
  with a throwaway simulator; never with a real host or device.
- M6.5 rows were verified on 2026-10-05 the same way (scratch homes, a second
  throwaway host, a fake `claude` and `gh`).
- The iOS column follows the CLAUDE.md rule: a ☐ there is a gap to close, not a
  decision. A — needs its reason in Notes.

## Routes

### Top-level screens

| Route | Electron | Mac | iOS | Milestone | Notes |
| `/` Home / project picker | ✅ | ✅ | ✅ | M0 | Mac: project grid, setup cards with fixers, Add Project (⌘O) with `.argus.json` inference; Needs you, Recent runs, notification and dependency cards, Remove from Recents. The update banner waits for M7 (Sparkle). iOS: Projects tab. |
| `/` Home / project picker | ✅ | ✅ | ✅ | M0 | Mac: sidebar lists projects; no project picker or add-project yet (M5 onboarding). iOS: Projects tab. Mac: project grid, setup cards with fixers, Add Project (⌘O) with `.argus.json` inference. |
| `/agents` Agents overview | ✅ | ✅ | ✅ | M1 | Mac: sidebar → Agents; table with live status, agent / session / project links. iOS: Projects → Recent agents → All agents, live. |
| `/automations` | ✅ | ✅ | ✅ | M5 | |
| `/automations/quick` Quick run | ✅ | ✅ | ✅ | M5 | |
| `/automations/quick/runs/:runId` | ✅ | ✅ | ✅ | M5 | iOS: shared run screen; save-as-automation via `automations.save_scratch_run`. Mac: save-as-automation verified. |
| `/automations/:automationId` | ✅ | ✅ | ✅ | M5 | iOS: detail plus a separate editor screen, memories editable. |
| `/automations/:automationId/runs/:runId` | ✅ | ✅ | ✅ | M5 | Mac: Open transcript opens the run's host session. |
| `/devices` | ✅ | ✅ | ◐ | M3 | Mac: table and live grid; boot, shut down, pop out; rows link to their session and agent; `/devices/:platform/:deviceKey` opens as a sheet. iOS: lists booted devices only; no boot/shutdown or AVD lifecycle. |
| `/inbox` | ✅ | ✅ | ✅ | M5 | |
| `/inbox/proposals/:proposalId` | ✅ | ✅ | ✅ | M5 | iOS: proposal screen, request-revision included. |
| `/notifications` | ✅ | ✅ | ✅ | M5 | Warnings & errors list. OS notifications are a separate M1 row. Mac: in-memory list fed by every store error, with an unseen badge in the sidebar. iOS: in-memory warnings & errors under Settings. |
| `/pull-requests` | ✅ | ✅ | ✅ | M4 | |
| `/pull-requests/:owner/:repo/:number` | ✅ | ✅ | ✅ | M4 | Mac: description, commits, checks, diffs, close, merge and comment; merge and comment verified against a stub `gh`. iOS: view, comment, merge. |
| `/runtimes` Runtimes overview | ✅ | ✅ | ◐ | M2 | Mac: sidebar → Runtimes; every run terminal across sessions, stop, open its tab. iOS: per-session terminals, read-only and streaming; no cross-session overview. |
| `/sessions/:sessionId` (→ home) | ✅ | ✅ | ◐ | M0 | Mac: a sidebar click opens the panel the session was last on, else its home, as in Electron. iOS: sessions live inside the project screen, no session home. |
| `/sessions/:sessionId/home` | ✅ | ✅ | ◐ | M1 | Mac: setup progress per step, setup failure with Retry / Mark as ready, active agents, Start / Plan Mode, open in editor / reveal / copy path, the land-work card (commit, push, PR, base branch, merge), chat history (list, read, delete, resume) and branch rename. iOS: setup state, land-work card and agents on the project screen; no per-session panel. |
| `/sessions/:sessionId/agents` | ✅ | ✅ | ✅ | M1 | Mac: verified end to end against the bundled host. |
| `/sessions/:sessionId/git` | ✅ | ✅ | ◐ | M4 | iOS: Changes and Branches screens; see sub-views. |

### Git sub-views (`/sessions/:sessionId/git/:gitView`)

| Sub-view                        | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                          |
| ------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `working`                       | ✅       | ✅  | ◐   | M4        | Mac: file, hunk and line staging, discard, commit, amend; 2,000 files and a 100k-line diff stay responsive. iOS: read-only diff with commit/push/merge; no staging or discard. |
| `branch`                        | ✅       | ✅  | ✅  | M4        |                                                                                                                                                                                |
| `history`                       | ✅       | ✅  | ◐   | M4        | Mac: commit graph, verified on 20k commits. iOS: per-branch log and commit diff; no graph.                                                                                     |
| `stashes`                       | ✅       | ✅  | ✅  | M4        | iOS: list, apply, drop.                                                                                                                                                        |
| `reflog`                        | ✅       | ✅  | ☐   | M4        |                                                                                                                                                                                |
| `conflicts`                     | ✅       | ✅  | ◐   | M4        | Mac: take a side or edit the merged result; continue and abort. iOS: merge blockers shown; no resolver.                                                                        |
| `branches`                      | ✅       | ✅  | ✅  | M4        | iOS: checkout, create, delete, rename, pin, push, pull.                                                                                                                        |
| `branches/:branchName`          | ✅       | ✅  | ✅  | M4        |                                                                                                                                                                                |
| `tags`, `tags/:tagName`         | ✅       | ✅  | ◐   | M4        | iOS: list only.                                                                                                                                                                |
| `submodules`                    | ✅       | ✅  | ☐   | M4        | Project-root sessions only.                                                                                                                                                    |
| `bisect`                        | ✅       | ✅  | ☐   | M4        | Project-root sessions only.                                                                                                                                                    |
| `hooks`                         | ✅       | ✅  | ☐   | M4        | Project-root sessions only.                                                                                                                                                    |
| `compare` (`?left=&right=`)     | ✅       | ✅  | ✅  | M4        |                                                                                                                                                                                |
| `blame` (`?path=&ref=`)         | ✅       | ✅  | ☐   | M4        | Mac: any `ref`, verified on 2026-10-06 against a tag and a branch off HEAD's line, local and remote. iOS: no file-read method on the gateway.                                  |
| `settings`                      | ✅       | ✅  | ☐   | M4        |                                                                                                                                                                                |
| `pull-requests`                 | ✅       | ✅  | ◐   | M4        | iOS: covered by the PR screens, not per session.                                                                                                                               |
| `branches-review`               | ✅       | ✅  | ☐   | M4        |                                                                                                                                                                                |
| `interactive-rebase` (`?from=`) | ✅       | ✅  | ☐   | M4        | iOS: only rebase-on-current.                                                                                                                                                   |

### Navigation

| Item                           | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                                      |
| ------------------------------ | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings dialog (overlay)      | ✅       | ✅  | ◐   | M5        | iOS: device name, appearance, push, Claude accounts, telemetry, computers only. Mac: a Settings window (⌘,) with Git and Git signing tabs; MCP test and tools in Project Settings.         |
| Window tabs                    | ✅       | ✅  | —   | M6        | iOS: window management; a phone switches computers instead. Mac: tabs per machine and session, each with its own history.                                                                  |
| Per-tab back / forward         | ✅       | ✅  | ✅  | M5        | Not owned by a plan milestone; assigned M5. iOS: per-section navigation stacks. Mac: per tab (⌘[ / ⌘]).                                                                                    |
| Deep links (`navigation:goto`) | ✅       | ◐   | ✅  | M5        | iOS: notification taps and Handoff open routes. Mac: paths parse, git, PR, devices and `?host=` included; a link waits for its host. `argus://` isn't claimed until M7 (Electron owns it). |
| `?host=` focused host          | ✅       | ✅  | ◐   | M6        | iOS: many paired computers, one connected at a time. Mac: part of the route; back/forward moves between machines.                                                                          |

## Features

### Core loop (plan M0/M1, not catalogued in `features.md`)

| Feature                                      | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                                                                |
| -------------------------------------------- | -------- | --- | --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three-panel window, projects and sessions    | ✅       | ✅  | ✅  | M0        | Mac: verified; projects and sessions live over the local socket, restored after a restart. iOS: tabs on a phone, split view on an iPad.                                                                              |
| Session create / delete, setup progress      | ✅       | ✅  | ✅  | M1        | Mac: New Session sheet (⌘N), live setup progress, delete from the context menu. Verified by in-window clicks and keys in a debug build. iOS: also retry setup, rename, base branch.                                  |
| Agent tabs                                   | ✅       | ✅  | ◐   | M1        | Mac: start (+, ⌘T, empty-state button), switch, close (×) — closing stops the agent. Verified by in-window clicks and keys in a debug build. iOS: one agent per screen, no tabs.                                     |
| Live transcript                              | ✅       | ✅  | ✅  | M1        | Mac: verified; the host folds it, the Mac pages it and applies `agent.transcript` deltas, as iOS does.                                                                                                               |
| Chat input: slash commands                   | ✅       | ✅  | ✅  | M1        | Mac: / menu, filtering, ↓/Tab/Return. Verified by in-window clicks and keys in a debug build.                                                                                                                        |
| Chat input: mentions                         | ✅       | ✅  | ✅  | M1        | Mac: @ file picker over the worktree, keyboard pick. Verified by in-window clicks and keys in a debug build.                                                                                                         |
| Chat input: images                           | ✅       | ✅  | ✅  | M1        | Mac: drop onto the input and send, image reaches the agent; opens in the viewer. Paste and the attach button share the same path (unit-tested). Verified by in-window clicks and keys in a debug build.              |
| Chat input: model / mode / effort            | ✅       | ✅  | ✅  | M1        | Mac: native menus and ⇧Tab change model, mode and effort on the host. Verified by in-window clicks and keys in a debug build.                                                                                        |
| Chat input: message queue                    | ✅       | ✅  | ✅  | M1        | Mac: queued while running, shown as a card, drained when the turn ends. Verified by in-window clicks and keys in a debug build.                                                                                      |
| Usage-limit auto-continue, banner and cancel | ✅       | ✅  | ✅  | M6.5      | Continues once the limit resets; Cancel stops it.                                                                                                                                                                    |
| Permission prompts                           | ✅       | ✅  | ✅  | M1        | Mac: Allow, Always Allow (same rule as Electron) and Deny. Verified by in-window clicks and keys in a debug build.                                                                                                   |
| Plan approval                                | ✅       | ✅  | ✅  | M1        | Mac: Approve / Keep planning / Approve in new session; approving leaves plan mode. Verified by in-window clicks and keys in a debug build. iOS: no draft persistence.                                                |
| Questions                                    | ✅       | ✅  | ✅  | M1        | Mac: options + Submit answer the agent. Verified by in-window clicks and keys in a debug build.                                                                                                                      |
| Notifications (OS)                           | ✅       | ✅  | ✅  | M1        | Mac: banners raised by the host through platform delegation, with Approve/Deny; approving from Notification Center answered a live prompt. iOS: background push.                                                     |
| Find in chat                                 | ✅       | ✅  | ☐   | M1        | Mac: ⌘F, typing, ⌘G stepping with wrap, Esc closes. Verified by in-window clicks and keys in a debug build.                                                                                                          |
| Transcript text selection                    | ✅       | ✅  | ☐   | M1        | Mac: TextKit 2 selection within a message and code blocks; not across messages (Electron allows that). Verified by in-window clicks and keys in a debug build. iOS: transcript text isn't selectable.                |
| File-path links                              | ✅       | ✅  | ☐   | M1        | Mac: link → host `open_path` → app (verified in dry-open mode); context menu adds Open In / Reveal / Copy Path. Line numbers aren't passed to the editor, as in Electron. iOS: no file viewer (no file-read method). |
| Scratch pads                                 | ✅       | ✅  | ✅  | M1        | Mac: create and delete (verified with a fake `claude`).                                                                                                                                                              |

### iOS simulators

| Feature                                     | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                   |
| ------------------------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot a runtime per session                  | ✅       | ✅  | ☐   | M3        | Mac: picking a shut-down simulator boots it; a Boot button otherwise. iOS: no boot method on the gateway.                                                               |
| Live mirror in the runtime panel            | ✅       | ✅  | ✅  | M3        | Mac: H.264 into `AVSampleBufferDisplayLayer` (ArgusUI's `DeviceVideoView`); panel, popout and devices grid share one stream.                                            |
| Tap, swipe, type, buttons, rotate, gestures | ✅       | ✅  | ✅  | M3        | Mac: mouse as touches, hardware keyboard (⌘⇧H for Home), Home/rotate/fold/deep links, claims with Take Control; tvOS gets the remote. iOS: no system-gesture shortcuts. |
| Per-session isolation                       | ✅       | ✅  | ✅  | M3        | Mac: each session keeps its own pick; two sessions held an iOS simulator and an emulator at once. Host-side.                                                            |

### Android emulators

| Feature                     | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                                                         |
| --------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot an AVD per session     | ✅       | ✅  | ☐   | M3        | Mac: Boot on an offline AVD; the stream retries while the emulator finishes booting. iOS: no boot method on the gateway.                                                                                      |
| Live mirror                 | ✅       | ✅  | ✅  | M3        | Mac: verified with the test AVD.                                                                                                                                                                              |
| Tap, swipe, type, hard keys | ✅       | ◐   | ✅  | M3        | Mac: wired as on iOS; the host accepted touches, keys and Back/Home/Recents but the API 36 test AVD ignored them over gRPC (ADB input worked) — a host-side issue shared with Electron. iOS: also fold poses. |
| Per-session isolation       | ✅       | ✅  | ✅  | M3        | Mac: as for simulators. Host-side.                                                                                                                                                                            |

### Embedded Chromium browser

| Feature                                | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                                          |
| -------------------------------------- | -------- | --- | --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-session browser at the session URL | ✅       | ✅  | ☐   | M3        | Mac: JPEG screencast, address bar, back/forward/reload with nav state, viewport presets (project ones too), pointer, wheel and keys. iOS: `browser.watch` exists on the gateway but is unused. |
| Agents click, type, scroll, run JS     | ✅       | ✅  | —   | M3        | Mac: Conductor taps, keys and swipes on the session's browser show in the mirror. Agent-side; nothing for a phone to render beyond the mirror.                                                 |
| DevTools on demand                     | ✅       | ✅  | —   | M3        | Mac: opens in its own window; needs the Conductor release with `--remote-allow-origins`. iOS: needs a desktop window.                                                                          |

### Terminals

| Feature                           | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                                                                        |
| --------------------------------- | -------- | --- | --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-session terminals in worktree | ✅       | ✅  | ◐   | M2        | Mac: SwiftTerm tabs (new, rename, close, ⌘W, a shell that exits closes its tab), ⇧⌘T panel. iOS: read-only, streaming output per session (`terminals.list` / `terminals.read`, monitor tier); typing stays with the desktop. |
| `terminals[]` config, auto-launch | ✅       | ✅  | —   | M2        | Mac: config terminals open beside the setup terminal on first show, in their `dir`; verified. iOS: the host opens them; nothing for a phone to configure.                                                                    |
| Agent and user share a terminal   | ✅       | ✅  | ◐   | M2        | Mac: an agent's `trigger_run` opens the panel on its run; reattaching replays the 256 KB capture (`terminal_scrollback`) stitched onto live output by event seq. Verified with a real agent. iOS: reads the same output.     |

### Run commands

| Feature                                              | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                                     |
| ---------------------------------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run[]` processes                                    | ✅       | ✅  | ◐   | M2        | Mac: toolbar run control (button, or split menu for several), stop, `single_runtime` stop-others-and-run prompt; verified. iOS: follows their output; starting runs isn't on the gateway. |
| `restartOnRerun`, `cwd`, `requires`, `prerequisites` | ✅       | ✅  | ☐   | M2        | Host-side. Mac: all four verified from the Mac UI.                                                                                                                                        |
| Live output with ANSI colour and links               | ✅       | ✅  | ◐   | M2        | Mac: ANSI colour, the run's exit line, ⌘-click links open on this Mac (verified in dry-open mode), find with match count. iOS: plain text, colours stripped.                              |

### Git workflow

| Feature                            | Electron | Mac | iOS | Milestone | Notes                                                              |
| ---------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------ |
| Branches: create, switch, delete   | ✅       | ✅  | ✅  | M4        | Mac: also rename, merge, rebase, pin, archive, stash & switch.     |
| Worktree per session               | ✅       | ✅  | ✅  | M1        | Mac: verified; sessions created from the app's host get worktrees. |
| Diff viewer, side-by-side / inline | ✅       | ✅  | ◐   | M4        | iOS: inline only.                                                  |
| Hunk-level staging                 | ✅       | ✅  | ☐   | M4        | Mac: and line-level.                                               |
| Commit & amend                     | ✅       | ✅  | ✅  | M4        |                                                                    |
| Stash: list, apply, drop           | ✅       | ✅  | ✅  | M4        |                                                                    |
| Merge & rebase, conflict resolver  | ✅       | ✅  | ◐   | M4        | iOS: merge into base, rebase current; no resolver.                 |
| Open a draft PR                    | ✅       | ✅  | ✅  | M4        | Mac: the New Pull Request sheet; verified against a stub `gh`.     |

### Remote access

| Feature                             | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                      |
| ----------------------------------- | -------- | --- | --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway on/off, pairing             | ✅       | ✅  | ✅  | M5        | iOS: the pairing client. Mac: host-tier commands over the local socket. Mac: paired end to end with a local throwaway client (desktop and phone kinds).    |
| Ways in: LAN, Tailscale, Cloudflare | ✅       | ◐   | ✅  | M5        | iOS: races the live addresses. Mac: LAN verified; tunnels never started against real accounts, Tailscale checklist rendered only.                          |
| Grants per device                   | ✅       | ✅  | —   | M5        | Host-tier; exposing grant changes over the gateway is a security risk.                                                                                     |
| Background push                     | ✅       | ◐   | ✅  | M5        | Mac: host-side sending; the Mac UI only configures it. Mac: config verified; Test push not, no paired device had a token.                                  |
| Web client (phone / tablet layouts) | ✅       | ✅  | ✅  | M5        | Mac: the bundled host must serve `argus-web`. iOS: iPad split view. Mac: the build stages `argus-web` and the gateway served it.                           |
| Handoff                             | ✅       | ◐   | ✅  | M5        | Not owned by a plan milestone; assigned M5. Mac: advertises the session on screen (verified); taking one over from the phone not verified without a phone. |
| Revoke a device                     | ✅       | ✅  | —   | M5        | Host-tier, same reason as grants.                                                                                                                          |

### Working across several Macs

| Feature                                  | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | -------- | --- | --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attach several hosts, routed per subject | ✅       | ✅  | ◐   | M6        | iOS: one computer at a time. Mac: projects keyed by host; verified against a second host on a scratch home (sessions, agent transcript, permission prompts, plan approval, notifications, terminal, git, runtime video and taps, browser runtime, Android, Project Settings, settings of the shown host). |
| Pair another Mac with Admin              | ✅       | ✅  | —   | M6        | Admin is a desktop-to-host grant. Mac: Settings → Hosts; paired with a throwaway `argus-host`, approved there with Admin.                                                                                                                                                                                 |
| Offline host keeps its last snapshot     | ✅       | ✅  | ◐   | M6        | iOS: shows cached lists; no per-host routing. Mac: the last snapshot is saved per host on disk; offline badge, banner, reconnect and refetch.                                                                                                                                                             |

### Huddles

| Feature                                   | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                        |
| ----------------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start / end, approve guests, scoped grant | ✅       | ◐   | ☐   | M5        | Mac: UI verified against an injected room; a real room needs `cloudflared`, not run. iOS: host tier on purpose (a trust decision like pairing; room tokens). |
| Typing presence, device driver, refusals  | ✅       | ✅  | ☐   | M5        | Mac: typing bar and the driver marked on guests, verified on an injected room. iOS: host tier on purpose (a trust decision like pairing; room tokens).       |
| Side chat                                 | ✅       | ◐   | ☐   | M5        | Mac: docked chat verified on an injected room only. iOS: host tier on purpose (a trust decision like pairing; room tokens).                                  |

### Argus Server

| Feature                      | Electron | Mac | iOS | Milestone | Notes                                                                                                             |
| ---------------------------- | -------- | --- | --- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Headless host, tray-only app | ✅       | ☐   | —   | M7        | The plan doesn't say what replaces it at cutover (plain `argus-host` or a Mac target). iOS: a phone isn't a host. |

### Automations

| Feature                                   | Electron | Mac | iOS | Milestone | Notes                                                                                                                 |
| ----------------------------------------- | -------- | --- | --- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| Triggers: schedule and signals            | ✅       | ◐   | ✅  | M5        | Mac: schedules with cron preview and validation verified; signal triggers need GitHub/Linear accounts, not exercised. |
| Proposals: accept, mark done, dismiss     | ✅       | ✅  | ✅  | M5        |                                                                                                                       |
| Proposal request-revision                 | ✅       | ✅  | ✅  | M5        |                                                                                                                       |
| Autonomy ladder                           | ✅       | ✅  | ✅  | M5        |                                                                                                                       |
| Memories, playbook revision, run feedback | ✅       | ◐   | ✅  | M5        | Mac: memories verified; feedback reached the host (refused: session gone); playbook revision not exercised.           |

### MCP server

| Feature                                     | Electron | Mac | iOS | Milestone | Notes                                                                                                                |
| ------------------------------------------- | -------- | --- | --- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Argus MCP for agents, gated for automations | ✅       | ☐   | —   | M0        | Host-side; verify an agent spawned from the Mac app gets the tools. iOS: agents it spawns get them from the host.    |
| MCP server settings                         | ✅       | ✅  | ☐   | M5        | Mac: OAuth verified up to the host's metadata request, no real sign-in; inherited servers have Test and a tool list. |

### Permissions

| Feature                                | Electron | Mac | iOS | Milestone | Notes                                                                                                                                                      |
| -------------------------------------- | -------- | --- | --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline approval beside the tool call   | ✅       | ✅  | ✅  | M1        | Mac: prompts render at the foot of the transcript and scroll into view. Verified by in-window clicks and keys in a debug build.                            |
| "Always allow" patterns                | ✅       | ✅  | ☐   | M1        | Mac: Always Allow on a prompt adds the Electron rule for the session. Verified by in-window clicks and keys in a debug build. iOS: allow once / deny only. |
| Default permission mode (App settings) | ✅       | ✅  | ✅  | M5        | iOS: a phone-local preference.                                                                                                                             |

### Orchestration tree

| Feature                               | Electron | Mac | iOS | Milestone | Notes                                                                                                     |
| ------------------------------------- | -------- | --- | --- | --------- | --------------------------------------------------------------------------------------------------------- |
| Subagent tree, live status            | ✅       | ✅  | ◐   | M1        | Mac: parent arrow and badge on tabs, child count, live status. iOS: subagents as tool cards, no tree.     |
| Per-agent model swap mid-conversation | ✅       | ✅  | ✅  | M1        | Mac: model menu switches the live agent. Verified by in-window clicks and keys in a debug build.          |
| Persisted history, resume             | ✅       | ✅  | ◐   | M1        | Mac: chat history on session home (list, read, delete, resume). iOS: read stopped transcripts; no resume. |

### Organisations

| Feature                            | Electron | Mac | iOS | Milestone | Notes                                |
| ---------------------------------- | -------- | --- | --- | --------- | ------------------------------------ |
| Organisations in App settings      | —        | —   | —   | M5        | Removed from Electron on 2026-09-14. |
| Org host session, child sessions   | —        | —   | —   | M5        | Removed from Electron on 2026-09-14. |
| Member-repo org context for agents | —        | —   | —   | M5        | Removed from Electron on 2026-09-14. |

### Onboarding

| Feature                          | Electron | Mac | iOS | Milestone | Notes                                                                                                                                      |
| -------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Welcome + telemetry choice       | ✅       | ✅  | ✅  | M5        | iOS: its own consent sheet and pairing flow. Mac: also prerequisite checks and a project step.                                             |
| Setup cards with one-click fixes | ✅       | ✅  | ◐   | M5        | iOS: Claude account sign-in only; the rest are Mac-local fixes. Mac: git identity fixer verified under a scratch HOME; installers not run. |
| `.argus.json` generation         | ✅       | ✅  | ☐   | M5        | Mac: quick generation verified; the Claude refine needs a signed-in CLI.                                                                   |

### Tools

| Feature                         | Electron | Mac | iOS | Milestone | Notes                                                                                                                           |
| ------------------------------- | -------- | --- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tool toggles (Settings → Tools) | ✅       | ✅  | ☐   | M5        | Also `.argus.json#tools.disabled`.                                                                                              |
| Device recording                | ✅       | ✅  | ✅  | M3        | Mac: the capture behind every mirror.                                                                                           |
| Device UI inspector             | ✅       | ✅  | ☐   | M3        | Mac: probe, restart with injection, capture, overlay, tree with search, metadata and live property edits.                       |
| Device control                  | ✅       | ✅  | ✅  | M3        | Mac: touch, keys, buttons and deep links. iOS: touch and keys, not deep links.                                                  |
| Device debug (logs, probes)     | ✅       | ✅  | ☐   | M3        | Mac: a Logs mode streams `conductor logs` with filter, errors-only, pause, copy; needs the Conductor release with the logs fix. |

### Auto-update and telemetry

| Feature                              | Electron | Mac | iOS | Milestone | Notes                                      |
| ------------------------------------ | -------- | --- | --- | --------- | ------------------------------------------ |
| Background updates, relaunch prompt  | ✅       | ☐   | —   | M7        | Mac: Sparkle. iOS: App Store / TestFlight. |
| Release channels (latest/beta/alpha) | ✅       | ☐   | —   | M7        | iOS: TestFlight is the beta channel.       |
| Telemetry consent (presence / full)  | ✅       | ☐   | ✅  | M7        |                                            |
