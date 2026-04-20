# First-Launch Onboarding Plan

This document describes the first-launch onboarding flow for **Argus**, the agentic IDE for mobile and web development. It covers goals, prerequisite checks, step-by-step UX, UI composition, state/persistence, IPC surface, edge cases, and open product questions.

The plan is intentionally implementation-agnostic — it describes _what_ is needed and _how the pieces fit together_, not the concrete code. See `CLAUDE.md` and `README.md` for architecture and conventions that must be respected during implementation.

---

## 1. Goals & success criteria

Argus is a multi-panel desktop app that orchestrates parallel Claude Code agents inside isolated git worktrees, with embedded iOS simulators, Android emulators, a Chromium browser, and a VS Code-backed editor. A first-time user arrives with none of that context.

### What the user must leave onboarding with

1. **Confidence in what Argus is** — "parallel Claude Code agents, each in its own git worktree, with live previews for mobile and web."
2. **A working install** — Claude Code CLI on PATH, git identity configured, native simulator bridge built, required permissions granted.
3. **A project opened and configured** — either an existing repo with `.argus.json`, or a fresh `.argus.json` generated with sensible defaults.
4. **One workspace and one agent successfully spawned** — the "aha" moment: see an agent streaming tool calls in a worktree.
5. **A mental model of the three panels** — sidebar (workspaces), center (agent control), right (runtime & testing).

### Success criteria (measurable)

- ≥ 90% of new users reach "first agent spawned" within 10 minutes.
- ≤ 2 hard-blocking prerequisite failures per session on a typical macOS dev machine.
- Onboarding is resumable: quitting mid-flow and relaunching picks up on the same step.
- Zero destructive defaults — no repo is cloned, modified, or committed to without explicit user action.
- Onboarding is skippable per-step where safe (e.g. mobile tooling can be deferred if the user only cares about web).

### Non-goals

- Teaching git, Claude Code, or Xcode from first principles.
- Gating advanced features (custom agent prompts, remote triggers, cron) behind onboarding — surface them later via contextual hints.
- Running a benchmark or collecting telemetry during onboarding.

---

## 2. Prerequisite checks

On first launch Argus verifies the environment and presents a **Preflight** screen that shows each check as `pass / warn / fail / skipped`. Each check has a one-line explanation, a "Fix" CTA that either runs an automated remediation or links to docs, and a "Skip" option where appropriate.

### Required (hard-block if missing)

| Check                    | How                                                                               | On failure                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| macOS version            | `process.platform === 'darwin'` + `os.release()` ≥ minimum                        | Block: Argus is macOS-only today.                                                                  |
| Node runtime bundled     | Electron's own Node is used; assert version at startup                            | Block with support link.                                                                           |
| Claude Code CLI on PATH  | `execFile('which', ['claude'])` via the fixed-up shell PATH                       | Surface install command, "Open Terminal" button, retry.                                            |
| Git on PATH              | `execFile('git', ['--version'])`                                                  | Link to `git` install; on macOS, recommend Xcode CLT.                                              |
| Git identity             | `git config --global user.name` and `user.email` both non-empty                   | Inline form to set them via `git config --global` (user confirms).                                 |
| Claude authenticated     | Run `claude --print --model=haiku --output-format=json "ping"` with short timeout | Prompt user to run `claude login` in an embedded terminal; poll for success.                       |
| Native sim bridge binary | Check `native/argus-sim-bridge/.build/...` artefact exists and runs `--version`   | Offer to build it (`pnpm --filter ... build:bridge` or scripted `swift build`); else link to docs. |

### Soft / conditional

| Check                      | When relevant                                        | Outcome                                                                   |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Xcode installed            | User wants iOS previews                              | `xcode-select -p` resolves a Developer dir; warn + "Skip mobile for now". |
| iOS Simulator runtimes     | Xcode present                                        | `xcrun simctl list runtimes --json`; warn if empty, link to install docs. |
| Android SDK + `adb`        | User wants Android previews                          | `adb version` via resolved PATH; warn if missing.                         |
| Android AVD present        | `adb` available                                      | `emulator -list-avds`; warn + link to AVD Manager.                        |
| Conductor CLI              | For E2E flows                                        | `conductor --version`; soft-warn, not required at onboarding time.        |
| Chromium (Playwright) deps | For embedded browser / web runtime                   | Playwright post-install status; offer to trigger install.                 |
| File-system permission     | macOS Full-Disk / Documents access for worktree root | Trigger the access prompt when we first write to `~/.argus/`.             |
| Notifications              | For background agent completion alerts               | `Notification.requestPermission`; clearly optional.                       |

### Graceful surfacing

- Checks run **in parallel** and stream results as they arrive — no blocking spinner on the whole preflight.
- Each failing check has a **"Why this matters"** disclosure (e.g. "Without Xcode, iOS previews won't render — you can still use Android/Web").
- A **"Run all fixable"** button triggers any automatable remediations (e.g. prompt for git identity, build the native bridge, install Playwright browsers).
- If the user dismisses the flow with outstanding warnings, a persistent indicator in the status bar summarises "3 checks pending" and links back to Preflight.

---

## 3. Step-by-step flow

The onboarding lives inside a full-window modal overlay rendered above the normal three-panel layout. The underlying panels mount only after the user reaches step 7 ("First project"). Each step has a back button except for irrevocable actions.

| #   | Step                | Purpose                                            | Exit condition                                            |
| --- | ------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| 1   | Welcome             | Orient the user                                    | "Continue" pressed                                        |
| 2   | Permissions         | Grant OS-level permissions                         | FS access granted; notifications answered (allow or deny) |
| 3   | Preflight           | Verify tooling                                     | All _required_ checks pass; soft warnings acknowledged    |
| 4   | Claude auth         | Ensure Claude CLI can talk to the API              | Ping succeeds                                             |
| 5   | Identity & defaults | Git identity + agent defaults (model, permissions) | Values saved to `~/.argus/config.json`                    |
| 6   | First project       | Pick or clone a repo                               | A project path is registered                              |
| 7   | `.argus.json` setup | Generate or confirm project config                 | `.argus.json` exists in the project                       |
| 8   | Layout tour         | Teach the three-panel model                        | User clicks through three coachmarks (or "Skip tour")     |
| 9   | First workspace     | Create a worktree from a suggested branch name     | Workspace appears in sidebar with setup pipeline done     |
| 10  | First agent         | Spawn a seeded agent on a small starter task       | Agent emits first stream-json event                       |
| 11  | Completion          | Celebrate + point to "What's next"                 | "Done" pressed; `onboarding.completed = true` persisted   |

### Per-step detail

#### 1. Welcome

- **User sees:** Argus logo, tagline ("Parallel agents for mobile & web"), three-bullet pitch, "Get started" primary button, "I've done this before — skip onboarding" secondary link (still runs Preflight silently).
- **Backend:** none.
- **Exit:** primary click advances; skip-link jumps to step 3 with auto-fix on.

#### 2. Permissions

- **User sees:** two cards — "File access for worktrees" (we'll create `~/.argus/`), "Notifications for agent completion (optional)".
- **User does:** click "Grant" on each. FS access triggers a `mkdir` + test write to `~/.argus/` (OS prompts if needed). Notifications use `Notification.requestPermission()` in the renderer.
- **Backend:** `onboarding_ensure_argus_dir` creates `~/.argus/{config.json,workspaces/,logs/}`.
- **Exit:** FS must succeed; notifications can be "Not now".

#### 3. Preflight

- **User sees:** checklist table of prerequisites (see §2). Each row shows an icon, name, status, inline action.
- **User does:** optionally click "Fix" or "Run all fixable". May expand "Why this matters".
- **Backend:** `onboarding_check_prereqs` streams events (`prereq:update`) as each check resolves.
- **Exit:** all Required pass; soft-fails acknowledged with a single confirm.

#### 4. Claude auth

- **User sees:** status card ("Checking Claude…"), on failure an embedded terminal pane with `claude login` pre-typed.
- **User does:** complete auth in the terminal; Argus polls `claude --print` every few seconds.
- **Backend:** `onboarding_claude_ping` uses the same PATH fixup used by the agent subprocess spawner.
- **Exit:** ping returns a JSON body.

#### 5. Identity & defaults

- **User sees:** a short form — Git name, Git email (prefilled if set), default Claude model (Opus 4.7 / Sonnet 4.6 / Haiku 4.5), default permission mode (plan / acceptEdits / auto), default worktree root (`~/.argus/worktrees`).
- **Backend:** `onboarding_save_defaults` writes `~/.argus/config.json`, and runs `git config --global` for identity (explicitly flagged — user must confirm).
- **Exit:** form submitted.

#### 6. First project

- **User sees:** three tabs: "Open existing", "Clone from Git", "Try an example".
  - _Open existing_: path picker.
  - _Clone_: repo URL + destination, runs `git clone` with progress.
  - _Example_: curated list (e.g. a tiny Expo app, a Next.js app) — cloned into `~/Projects/argus-examples/<name>`.
- **Backend:** `onboarding_register_project` adds the path to `~/.argus/config.json` recent-projects.
- **Exit:** project path resolved and readable.

#### 7. `.argus.json` setup

- **User sees:** detected state ("No `.argus.json` found — let's create one" or "Existing config detected — review below"). Editor-style summary of: name, install command, dev command, copy/symlink rules, related projects, runtime kind (ios/android/web), simulator preset, device name.
- **User does:** accept defaults or tweak. For new repos, Argus infers from package.json (`dev`, `start`, `ios`, `android`) and common mobile heuristics.
- **Backend:** `onboarding_suggest_argus_json` returns inferred config; `onboarding_write_argus_json` persists to the repo root. The file is **not** auto-committed — we only write it, and show a note suggesting the user commits it themselves.
- **Exit:** `.argus.json` exists.

#### 8. Layout tour

- **User sees:** main layout appears behind a dimmed overlay with three sequential coachmarks:
  1. _Sidebar_: "Each row is a worktree. Create one per parallel task."
  2. _Center_: "Agent chat and tool calls live here."
  3. _Right_: "Live preview for iOS, Android, Web — with a terminal tab."
- **Exit:** "Got it" or "Skip tour".

#### 9. First workspace

- **User sees:** suggested branch name (`argus/try-me` or similar), base branch dropdown (defaulting to `main`), note about where the worktree will live, "Create workspace" button.
- **Backend:** the standard worktree creation + setup pipeline (copy/symlink/install) from `electron/services/workspace/`.
- **Exit:** setup pipeline reports `done`; workspace appears in the sidebar and is auto-selected.

#### 10. First agent

- **User sees:** a starter prompt pre-filled ("Add a `Hello from Argus` comment at the top of README.md"), "Spawn agent" button, and a note that the agent runs in `plan` mode for safety.
- **Backend:** `agent/spawn` with the worktree + prompt; the UI transitions to showing the live stream-json feed.
- **Exit:** first `tool_use` or `text` delta received.

#### 11. Completion

- **User sees:** celebratory card, links to "Create another workspace", "Read the guide", "Set up mobile previews" (if skipped earlier).
- **Backend:** `onboarding_complete` sets `onboarding.completed = true` and `onboarding.version = <current>`.

---

## 4. UI composition

All visual primitives come from `@argus/peacock`. App-specific orchestrators live in `app/components/onboarding/` and compose Peacock pieces. **No inline `<svg>` anywhere in `app/`.**

### Reusable Peacock components (already available or obviously covered)

- `Button`, `IconButton`, `Badge`, `Card`, `Modal`/`Dialog` surface, `TextField`, `Select`, `Checkbox`, `Toggle`, `Tabs`, `ProgressBar`, `Spinner`, tool-call rows, terminal pane wrapper, sidebar item, chat input, `Icons.*`.
- Tokens: spacing, radii, `--accent`, `--bg-*`, `--glass-*`, type scale — reuse as-is.

### New Peacock primitives likely needed

Add these under `packages/peacock/src/components/` with colocated `.module.css` and `.stories.tsx`.

1. **`Stepper`** — horizontal step indicator (numbered + labelled) with `complete / current / upcoming` states. Used at the top of the onboarding modal.
2. **`ChecklistRow`** — icon slot + title + status pill + inline action button + collapsible "why". Used by Preflight.
3. **`Coachmark`** — anchored callout with arrow, for the layout tour. Accepts a ref or rect and a placement (`top`/`bottom`/`left`/`right`).
4. **`EmptyStateIllustration`** (data-driven SVG primitive — lives in Peacock, **not** `app/`) — a single component rendering the hero illustration by variant name (`welcome`, `success`, `offline`). Covers the "no inline SVG in app" rule for the welcome and completion steps.
5. **`SegmentedCard`** — a large clickable card with icon, title, one-line description; used on the "First project" step tabs and for the "example" picker.
6. **`StatusPill`** — if not already present; `pass / warn / fail / skipped / running` variants, aligned to tokens.
7. **`CodeBlock`** — monospaced block with copy-to-clipboard button, used to show install commands inline.
8. **`FormField` wrapper** — label + helper text + error slot around existing `TextField`/`Select`, for the Identity & defaults form.

Before adding any of these, `grep -r '<svg\|ComponentName' packages/peacock/src` to avoid duplicates.

### App-specific orchestrators

Under `app/components/onboarding/`:

- `OnboardingGate.tsx` — top-level guard that reads state from `onboardingStore`, renders the modal and routes between steps.
- `WelcomeStep.tsx`
- `PermissionsStep.tsx`
- `PreflightStep.tsx` — subscribes to `prereq:update` events via `useIpcEvent`.
- `ClaudeAuthStep.tsx` — hosts an embedded terminal via existing terminal IPC.
- `DefaultsFormStep.tsx`
- `ProjectPickerStep.tsx`
- `ArgusConfigStep.tsx`
- `LayoutTourStep.tsx` — positions `Coachmark` primitives over the real panels.
- `FirstWorkspaceStep.tsx`
- `FirstAgentStep.tsx`
- `CompletionStep.tsx`

Each orchestrator wires data/IPC and stays thin; composition uses Peacock primitives only.

### Styling

- CSS Modules colocated with each step component.
- Tokens only — no new `--` variables declared in `app/`. If a genuinely new token is needed (e.g. `--onboarding-overlay-bg`), add it to `packages/peacock/src/styles/tokens.css`.

---

## 5. State & persistence

### Persistence tiers

1. **`~/.argus/config.json`** (source of truth, long-lived):
   ```json
   {
     "onboarding": {
       "completed": false,
       "version": 1,
       "lastStep": "preflight",
       "skipped": ["notifications", "android"],
       "completedAt": null
     },
     "defaults": {
       "model": "claude-opus-4-7",
       "permissionMode": "plan",
       "worktreeRoot": "~/.argus/worktrees"
     },
     "recentProjects": ["/Users/x/Work/myapp"]
   }
   ```
2. **Zustand `onboardingStore`** (renderer, ephemeral): current step, transient form values, streaming preflight results, "is the modal open" flag.
3. **`~/.argus/logs/onboarding-<timestamp>.log`** — structured log of the run; useful for support.

No `electron-store` dependency is added — plain JSON via `fs/promises` keeps parity with the rest of the backend services.

### Resuming

- On every app start, the backend loads `config.json`. If `onboarding.completed !== true`, the frontend mounts `OnboardingGate` and seeks to `lastStep`.
- Each step persists `lastStep` on _successful_ exit, not on entry. If the user quits mid-step, they land on the beginning of that step next launch (safer than replaying a half-filled form).
- A hidden dev menu item "Reset onboarding" clears the flag — useful for QA.

### Skip / do later

- **Per-step skip:** records the step id in `onboarding.skipped` and moves on. The Status Bar shows a "Finish setup" affordance that re-opens the modal at the first skipped step.
- **Per-check skip** (inside Preflight): that specific check is ignored for the rest of this onboarding run but re-evaluated on next launch.
- **Dismiss entire onboarding:** offered after step 5 ("Identity & defaults") — sets `completed = true` and `skipped = [... remaining ...]`. We never auto-complete without explicit user action.

---

## 6. IPC surface

All new commands follow the conventions in `CLAUDE.md`: snake_case names, registered in `electron/ipc.ts`, backed by a module under `electron/services/onboarding/`, with typed wrappers in `app/lib/ipc.ts` and shared interfaces in `app/lib/types.ts`. Events go through `webContents.send` and are consumed via `useIpcEvent`.

### Commands

| Command                         | Input                                              | Output                                                | Notes                                               |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| `onboarding_get_state`          | —                                                  | `{ completed, version, lastStep, skipped, defaults }` | Read from `~/.argus/config.json`                    |
| `onboarding_set_last_step`      | `{ step: string }`                                 | `void`                                                | Persisted on successful step exit                   |
| `onboarding_ensure_argus_dir`   | —                                                  | `{ path: string }`                                    | Creates `~/.argus/` subtree; triggers FS permission |
| `onboarding_check_prereqs`      | `{ checks?: string[] }`                            | streams `prereq:update` events; returns summary       | Parallel, streamed                                  |
| `onboarding_run_fixer`          | `{ check: string }`                                | streams `prereq:fix:log`; returns `{ ok: boolean }`   | E.g. build native bridge, set git config            |
| `onboarding_claude_ping`        | —                                                  | `{ ok: boolean, error?: string }`                     | Short-timeout `claude --print`                      |
| `onboarding_save_defaults`      | `{ gitName, gitEmail, model, mode, worktreeRoot }` | `void`                                                | Also runs `git config --global` when asked          |
| `onboarding_clone_example`      | `{ slug: string }`                                 | streams `clone:progress`; returns `{ path }`          | Clones a curated example                            |
| `onboarding_register_project`   | `{ path: string }`                                 | `void`                                                | Adds to `recentProjects`                            |
| `onboarding_suggest_argus_json` | `{ path: string }`                                 | `{ config: ArgusConfig, inferredFrom: string[] }`     | Reads `package.json` and heuristics                 |
| `onboarding_write_argus_json`   | `{ path, config }`                                 | `void`                                                | Writes only — never commits                         |
| `onboarding_complete`           | —                                                  | `void`                                                | Sets `completed = true`                             |

### Events

- `prereq:update` — `{ id, status, message?, fixable?: boolean }`
- `prereq:fix:log` — `{ id, line }`
- `clone:progress` — `{ slug, received, total?, phase }`

### Wrappers & types

- Add typed wrappers in `app/lib/ipc.ts` for each command.
- Add `ArgusConfig`, `PrereqCheckId`, `PrereqStatus`, `OnboardingState` to `app/lib/types.ts` (manually mirrored with `electron/services/onboarding/types.ts`).
- Add `useOnboarding` hook in `app/hooks/` wrapping the store + IPC.

### Service module layout

```
electron/services/onboarding/
  index.ts          // register all handlers
  state.ts          // load/save config.json
  prereqs/
    index.ts        // orchestrator, emits prereq:update
    claude.ts
    git.ts
    xcode.ts
    simulators.ts
    android.ts
    bridge.ts
    playwright.ts
  argusJson.ts      // infer + write
  examples.ts       // curated clone list
```

Each file stays under the ~500 LOC guideline.

---

## 7. Edge cases

| Case                                       | Handling                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Offline first launch**                   | Preflight marks Claude auth and Playwright install as `warn` with explicit offline messaging; onboarding can still complete, Claude step is deferred.                                                                                         |
| **Missing Xcode**                          | Soft warn; offer "Skip mobile for now" — runtime panel shows a "Set up iOS" CTA later.                                                                                                                                                        |
| **Missing Android SDK / AVDs**             | Same pattern as Xcode; skip path preserved in `skipped`.                                                                                                                                                                                      |
| **Denied FS permission**                   | Hard block step 2 with a "Open System Settings → Privacy & Security" deep link and retry.                                                                                                                                                     |
| **Denied notifications**                   | Treated as "Not now" — no block.                                                                                                                                                                                                              |
| **Claude not logged in**                   | Embedded terminal with `claude login`; poll ping; "I'll do this later" downgrades Claude to soft-warn and disables the First Agent step with a badge explaining why.                                                                          |
| **Corporate-managed macOS**                | Detect common MDM signals (`/Library/Managed Preferences` exists, restricted `defaults write`). Show a banner on Preflight: "Your Mac may restrict some actions — admin approval might be needed for Xcode and network tools."                |
| **`.argus.json` already exists**           | Step 7 switches to "review & confirm" mode; never overwrites without explicit "Regenerate" action that first backs up to `.argus.json.bak`.                                                                                                   |
| **Invalid / malformed `.argus.json`**      | Show parse errors inline; offer "Fix in editor" (opens the file in the built-in editor) or "Regenerate".                                                                                                                                      |
| **User cancels clone or clone fails**      | Abort cleanly; leave no partial directories; show stderr in a collapsible block.                                                                                                                                                              |
| **Upgrade from pre-onboarding install**    | Migration: if `~/.argus/config.json` exists but has no `onboarding` block, seed `{ completed: true, version: 0, lastStep: "completion" }`. On version bumps, show a lightweight "What's new / new setup step" modal instead of the full flow. |
| **Running inside a worktree already**      | Detect and refuse to register a worktree dir as a project root; suggest the repo root.                                                                                                                                                        |
| **Permission mode conflict**               | If user picks `auto` but prereqs failed Claude ping, downgrade to `plan` and explain.                                                                                                                                                         |
| **Native bridge build failure**            | Fallback to instructions + "Retry" + "Skip (mobile previews disabled)".                                                                                                                                                                       |
| **Disk full / write error on `~/.argus/`** | Block with actionable error; no silent retry loops.                                                                                                                                                                                           |
| **Multiple monitors / tiny window**        | Modal is scrollable and respects a min width; Coachmarks reposition if anchor is off-screen.                                                                                                                                                  |

---

## 8. Open questions

1. **Platform scope at launch.** macOS-only for v1? When do we add Linux/Windows? (Affects whether Xcode checks are conditional or gating.)
2. **Telemetry.** Do we record onboarding funnel metrics (step drop-off, time-to-first-agent)? If yes, what stack (self-hosted? anonymous?) and how is consent collected?
3. **Example projects.** Which 2–3 examples do we ship? Candidates: an Expo app, a Next.js app, a vanilla React Native CLI app, a plain Node CLI. Who owns these repos?
4. **Default Claude model.** Do we default to Opus 4.7 or Sonnet 4.6 for cost reasons? Should we show rough price-per-task guidance during onboarding?
5. **`claude login` UX.** Embedded terminal vs. deep-linking into the user's default Terminal.app? Polling interval?
6. **Simulator bridge distribution.** Ship the prebuilt binary inside the `.app` (signed + notarised), or build on first launch? Likely ship prebuilt; confirm.
7. **Should `.argus.json` be auto-committed?** Current plan: no. Needs product sign-off — a banner nudge is friendlier than a silent commit.
8. **"Try a demo mode"** without any real project — a canned repo + mocked agent stream. Worth the engineering cost?
9. **Dismissing onboarding entirely.** How visible should the "Finish setup" affordance be after dismissal? A top-bar badge? A status-bar button?
10. **Keyboard support.** Full keyboard navigation through the flow is table-stakes for pro dev tools; confirm scope for v1.
11. **Multiple projects at once.** Should onboarding support picking more than one project in step 6, or strictly one then guide users to add more from the main UI?
12. **Localization.** English-only for v1? If not, add `@argus/peacock` or a new `app/lib/i18n.ts` story.

---

_This document is a plan. Implementation should land behind a feature flag and be driven by the IPC surface, component list, and edge-case handling above. Any deviation should be motivated by a concrete finding during build and reflected back here._
