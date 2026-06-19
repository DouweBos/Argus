# App settings

App-level settings apply to your install of Argus, regardless of which
project is open. They live on your machine and are not shared with the
team.

Open them with **⌘,** or from the command palette → _Settings_.

For project settings _shared_ with the team (setup commands, run
targets, related projects, …) see
[Project settings](./project-settings.md).

---

## Appearance

| Setting          | Default   | Description                                                                                                                  |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Theme**        | `system`  | `system`, `light`, or `dark`. `system` follows the OS appearance.                                                            |
| **Display size** | `default` | One of `larger`, `large`, `default`, `small`, `smaller`. Scales the whole app — useful on very large or very small displays. |

---

## Claude account

Sign in to Claude, sign out, or switch the account Argus uses to run agents —
without leaving the app.

- **Signed in as** — shows the current account (email, organization, plan, and
  auth method), read from `claude auth status`.
- **Log out** — runs `claude auth logout`, clearing the stored credentials.
- **Log in / switch account** — pick **Claude subscription** or **Anthropic
  Console**, then click Log in. Argus opens your browser to authenticate; paste
  the authorization code back into the dialog to finish signing in.

This drives the same Claude CLI credentials used everywhere else, so changes
apply to every session and runner on this machine.

---

## Agents

| Setting                     | Default | Description                                                                                            |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| **Default permission mode** | `auto`  | The permission mode applied to every new agent — at spawn — unless overridden in the new-agent picker. |

Permission modes:

- **`auto`** — smart classifier auto-approves safe actions; risky ones still
  ask.
- **`ask`** — agent asks before each edit, command, or write that isn't
  already allow-listed.
- **`plan`** — plan-only mode; no edits or shell.
- **`review`** — auto-approves file edits; still asks for shell + network.
- **`trusted`** ("yolo") — runs every tool without prompting.

The mode is applied at spawn time, so it takes effect for the agent's very
first action. Agents restored to an earlier turn keep the mode they were
running with.

---

## LLM

App-level default for which LLM runner and model power new sessions. The
runner is fixed at session creation; the model can still be overridden by
[`.argus.json`](./project-settings.md), individual sessions, or the
new-agent picker.

| Setting           | Default       | Description                                                                                                                            |
| ----------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Runner**        | `claude-code` | The CLI/agent that drives sessions. Today only Claude Code is registered; additional runners (Codex, Gemini, …) will appear over time. |
| **Default model** | _(empty)_     | Optional model id passed to the runner — e.g. `claude-opus-4-7`. Leave blank to let the runner pick its own default.                   |

Resolution order for the runner (at session creation):

1. Project default — the `llm.runner` field in
   [`.argus.json`](./project-settings.md).
2. App default — this setting.

Resolution order for the model (at every agent spawn):

1. Agent override (set in the new-agent picker).
2. Session model (carried on the session, defaulted from project/app at
   create time).
3. Project default — `llm.model` in `.argus.json`.
4. App default — this setting.
5. Whatever the runner picks if none of the above specify a model.

---

## Open in apps

| Setting            | Default | Description                                                    |
| ------------------ | ------- | -------------------------------------------------------------- |
| **Custom editors** | `[]`    | Extra entries shown in the _Open in…_ menu on repos and files. |

Each entry has a **Name** and a **Command**. The command is either:

- a CLI on `PATH` — e.g. `zed`, `code`, `subl`, `idea`. Argus invokes
  `<command> <path>` with the worktree root.
- an absolute path to a `.app` bundle — e.g. `/Applications/Zed.app`.

---

## MCP servers

| Setting         | Default | Description                                                         |
| --------------- | ------- | ------------------------------------------------------------------- |
| **MCP servers** | `{}`    | Personal MCP servers merged into every Argus agent on this machine. |

Each entry has a **Name** and a JSON config matching the standard
`mcpServers` shape — for example:

```jsonc
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"],
}
```

Use this for servers _you_ want available. For servers the whole team
should get, use the project-level `mcp_servers` in
[`.argus.json`](./project-settings.md).

---

## Privacy

| Setting                      | Default | Description                                                                                                                                                                         |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Send anonymous telemetry** | `false` | Sends anonymous usage and crash events to PostHog so we can find bugs and prioritise features. Consent is collected once during onboarding (telemetry step); flip it any time here. |

---

## Tools

Argus's device tooling — recording, control, debug streams, the UI inspector — ships as togglable **tools**. Turn off the ones you don't use to keep the UI focused on what you actually reach for.

| Tool                    | What it does                                                               | Needs                                                         |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Device recording**    | Stream iOS Simulator and Android emulator screens into the runtime panel.  | Native sim bridge, Xcode + iOS runtimes, Android SDK + an AVD |
| **Device UI inspector** | Inspect view hierarchy, accessibility, and layout on a connected device.   | Device recording (auto)                                       |
| **Device control**      | Drive devices via `conductor` — taps, keyboard, deep links, navigation.    | Android SDK (for Android), Playwright (for web)               |
| **Device debug**        | Tail device logs, memory, and other conductor probes from the Debug panel. | Device control (auto)                                         |

Pick tools during onboarding (the **Tools** step before Preflight) or at any time from **Settings → Tools**. All tool assets ship bundled with the app — toggling a tool on or off only affects whether its UI surfaces and IPC handlers are active.

Each tool row in Settings runs its declared prereq checks live and surfaces **Install** buttons for the ones we know how to fix. Failed prereqs don't block the toggle, but the surfaces that depend on a missing prereq will error gracefully when used.

The preflight onboarding step is filtered to your enabled tools' prereqs plus the four core checks (`claude_cli`, `claude_auth`, `git_cli`, `git_identity`). A user who picks zero tools sees only the four core checks.

---

## Advanced — Update channel

| Setting     | Default  | Description                                                                                                                                                                                                               |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Channel** | `latest` | Auto-updater feed. **Production** (`latest`) tracks the public releases. **Beta** subscribes to in-development builds of upcoming features cut from `main` — should work, but may contain bugs that haven't surfaced yet. |

Production users never see beta builds — they're published under a separate `beta-mac.yml` feed file. Switching channels takes effect on next app restart.

> Alpha builds (one-off cuts from any branch) are not exposed in this dialog. Repo collaborators install them manually by downloading the `.dmg` from the corresponding GitHub release.

What we send (when the toggle is on):

- Anonymous install id (random UUID). Wiping it rotates the id. The id
  isn't linked to a person, account, or email.
- App version, OS, OS version, CPU architecture.
- Standard auto-properties added by PostHog's web SDK in the renderer:
  browser type/version/language, user agent, screen and viewport size,
  timezone, in-app URL (always local — never external sites), and a
  per-SDK-session id.
- Approximate location, derived **server-side at PostHog** from the
  request IP: country, region, city, postal code, and a city-level
  latitude/longitude. We have **Discard client IP data** enabled on the
  PostHog project, so the raw IP is not stored alongside the event —
  but PostHog still uses it at ingestion to derive these GeoIP fields
  before discarding. PostHog doesn't expose a switch to skip
  enrichment entirely. If even city-level geography is unacceptable,
  leave telemetry off.
- Argus-specific events documented in
  [telemetry-events.md](./telemetry-events.md) — feature usage signals
  with the small, named props listed there. Never raw arguments, file
  paths, or project content.
- Errors and crashes. Stack traces are scrubbed of user home directory
  paths.

What we do **not** send:

- Session replays / DOM recordings.
- DOM autocapture — element selectors, click targets, form inputs.
- Prompts, file contents, agent output, project names, branch names,
  repo paths, or any other content of your work.
- A person profile linking the install id to a name, email, or
  account.

Telemetry is hard-disabled in development builds, regardless of the
toggle.

For the full per-event catalogue and exhaustive property list, see
[telemetry-events.md](./telemetry-events.md).

---

## Git

Defaults for the git panel. Each setting also has an inline toggle in
the relevant toolbar — use the dialog when you want to set the
default for every project on this machine.

| Setting                                | Default   | Description                                                                                                   |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| **Working copy view**                  | `flat`    | `flat` shows changed files as a list; `tree` groups them by directory.                                        |
| **Diff layout**                        | `unified` | `unified` stacks removed/added lines; `split` shows them side-by-side.                                        |
| **Ignore whitespace in diffs**         | `false`   | Hide pure-whitespace changes when comparing files.                                                            |
| **Highlight word-level changes**       | `false`   | Inline word-diff inside changed lines.                                                                        |
| **Conventional Commits picker**        | `false`   | Show a commit-type prefix picker (`feat`, `fix`, `chore`, …) in the commit composer.                          |
| **Default pull strategy**              | `ff-only` | Used by the project-scope pull dialog when you don't pick a strategy. One of `ff-only`, `merge`, or `rebase`. |
| **Show ignored files**                 | `false`   | Include files matched by `.gitignore` in the working copy list.                                               |
| **Show assume-unchanged files**        | `false`   | Include files marked with `git update-index --assume-unchanged`.                                              |
| **Show unmodified files in tree view** | `false`   | Only applies when the working copy view is set to Tree — shows tracked files that aren't currently modified.  |

A few git-panel preferences are intentionally _not_ in this dialog
because they're pure layout state: the source-sidebar collapsed state
and width, which sub-sections are collapsed, and the
"don't-ask-again" map for confirm dialogs. Those persist
automatically as you use the panel.

---

## Git signing

Per-repo commit-signing toggles. Read and written to the local git config of
the currently selected session worktree, so each project keeps its own
preferences.

| Setting            | Git config key    | Description                                                            |
| ------------------ | ----------------- | ---------------------------------------------------------------------- |
| **Enable signing** | `commit.gpgsign`  | When on, every commit is signed (Argus relies on git's own machinery). |
| **Signing format** | `gpg.format`      | `gpg` or `ssh`.                                                        |
| **Signing key**    | `user.signingkey` | GPG key id, fingerprint, or path to an SSH key.                        |

Signing failures are surfaced via `<GitErrorBanner kind="signing-failed">`
with a "Configure signing" recovery action that re-opens this section.

---

## Per-project personal settings

These are machine-local settings _about_ a specific project. They live
in `~/.argus/user-project-settings.json` and never get committed to
your repo.

| Setting           | Default | Description                                                                                                                                                                         |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch prefix** | `""`    | Prepended to the branch name when creating a session in this project (e.g. `douwe/`, `team/feature-`). Leave empty to disable. Already-prefixed user-typed branches aren't doubled. |

---

## Where things are stored

Argus keeps everything under `~/.argus/`:

```
~/.argus/
  worktrees/                  ← Session worktrees (one dir per repo)
  sessions/                   ← Session metadata
  app-settings.json           ← MCP servers (and future global prefs)
  user-project-settings.json  ← Per-developer project prefs (branch prefix, …)
  telemetry-id                ← Anonymous install id (only present if telemetry is on)
```

UI preferences (theme, display size, default permission mode, default
LLM runner/model, custom editors) live in the app's `localStorage`.
Delete a file or wipe the
directory at any time — Argus recreates what it needs on next launch.
