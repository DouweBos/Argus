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

| Setting           | Default   | Description                                                                                                                                                                                                            |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Theme**         | `system`  | `system`, `light`, or `dark`. `system` follows the OS appearance.                                                                                                                                                      |
| **Colour theme**  | `muted`   | Accent colour and a matching background tint: Muted (black and white, no colour accent), Amber, Grove, Ocean, Ember, Iris or Rose. Each has a light and a dark variant, so it follows the theme above.                 |
| **Display size**  | `default` | One of `larger`, `large`, `default`, `small`, `smaller`. Scales the whole app — useful on very large or very small displays.                                                                                           |
| **Launch screen** | `home`    | Which screen Argus opens on: **Home** (the project picker) or **Inbox** (what your automations want from you). A restored window tab still wins — the preference only applies when a window opens with no saved route. |

---

## Claude account

Stay signed in to several Claude accounts at once and switch between them
instantly — no logging out, no terminal.

- **Accounts** — every account you've signed in, with its email, organization
  and plan. Click a row to make it active; agents, terminals and one-shot
  helpers started from then on use it. Rename a row to give an account a
  friendlier label, or remove it to sign out and forget it. A row marked
  **Signed out** has credentials that stopped working — **Sign in again** renews
  them in place, keeping the session pins and the label.
- **Add another account** — pick **Claude subscription** or **Anthropic
  Console**, then click Add account. Argus opens your browser to authenticate;
  approve access there and it signs in automatically — no code to copy. (If the
  browser can't open, it falls back to asking for a pasted code.) Accounts
  already signed in stay signed in.

Switching never interrupts a running agent — each agent keeps the account it
started with.

**Pinning a session to an account.** Once you have more than one account, the
model picker in the chat input grows an **Account** section. Pin a session there
to run it on a specific account regardless of which one is active — handy when
one account is rate-limited and you want work to continue on another in
parallel. Sessions default to _Follow app default_.

Your first account is adopted from whatever `claude` was already logged into, so
upgrading Argus never costs you a re-authentication.

Additional accounts store their credentials under
`~/.argus/claude-accounts/<id>/`, alongside their own copy of the Claude CLI's
`.claude.json` so each account carries its own identity and organization. The
location is part of how the credentials are keyed, so moving or renaming
`~/.argus` means signing those accounts in again — nothing else breaks.
Everything else the Claude CLI keeps in `~/.claude` (settings, `CLAUDE.md`,
plugins, transcripts) is linked back to the shared copy, so it stays one set of
files across accounts.

---

## Agents

| Setting                               | Default      | Description                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default permission mode**           | `auto`       | The permission mode applied to every new agent — at spawn — unless overridden in the new-agent picker.                                                                                                                                                                                                  |
| **Follow-up suggestions**             | On           | When an agent finishes a turn, a small model (Haiku) reads its last message and suggests up to three replies. They appear above the chat input on every client; click one, or press Tab, to fill the input. Nothing is sent until you send it.                                                          |
| **Import Claude Code chats**          | On           | Chats you ran with the `claude` CLI in a project's folder — in a terminal or another app — show up in that project's chat history, marked Imported, and can be resumed. Checked at launch, when a project is added and every 10 minutes; covers the last 30 days. **Import now** runs it straight away. |
| **Start new agents in**               | New worktree | Whether a prompt on a project's home runs in a fresh worktree or in the project's checkout. Each prompt can switch it.                                                                                                                                                                                  |
| **Automations**                       | On           | Whether automations start agents on their own schedule. Turning it off leaves the manual Run button working.                                                                                                                                                                                            |
| **Default autonomy**                  | No cap       | App-wide ceiling on how far any automation may go, and the level used by automations that set none.                                                                                                                                                                                                     |
| **Concurrent automation sessions**    | 3            | How many sessions automations may have open at once, across all of them.                                                                                                                                                                                                                                |
| **Daily automation budget**           | 0            | Spend automations may reach in a day, in USD. 0 means no budget.                                                                                                                                                                                                                                        |
| **Extra commands for read-only runs** | none         | Shell commands a read-only automation may run beyond the built-in reads.                                                                                                                                                                                                                                |
| **Extra tools for read-only runs**    | none         | Tools a read-only automation may call beyond the built-in reads.                                                                                                                                                                                                                                        |

A session counts against the concurrency limit from the moment an automation
creates it until it is merged or deleted — not until its agent stops. A branch
waiting for you to review it is still work in flight.

### What a read-only run may do

An automation at `propose` observes and reports; it does not act. Argus holds
it to that rather than trusting the playbook: the run is refused anything that
writes a file, installs a package, posts to GitHub, or sends data somewhere.
Its shell is limited to commands that only read.

That list cannot anticipate every tool your playbooks use. When a run is
refused, the attempt is recorded under **Refused while running** in Settings →
Automations, with the allowlist entry that would permit it. Allowing one is a
click; ignoring it leaves the gate closed.

Both lists are machine-local and yours alone. A project cannot add to them — a
repo that could widen its own allowlist would be authorising itself. A project
can still cap autonomy _lower_ via `.argus.json`, as before.

An entry is either a bare command (`conductor`) or a prefix (`conductor
screenshot`), matched on whole words: allowing `gh pr list` does not also allow
`gh pr merge`.

Once the day's automation spend reaches the daily budget, scheduled runs are
skipped with the reason recorded, and no automation may start another session
until tomorrow. Spend is counted per run, including the sessions a run started.
Each automation also has its own per-run ceiling in its guardrails: a run that
reaches it is stopped mid-flight.

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

**Automations** is a master switch for the scheduler, not for automations
themselves: with it off nothing fires on a clock, and every automation can
still be run by hand. It is a host setting, so when you drive another Mac the
switch belongs to that machine's automations. Automations shipped with Argus
start disabled, so nothing ever runs until you turn one on. See
[Automations](./automations.md) for what they are and what each rung permits.

### Autonomy

**Default autonomy** caps the ladder an automation climbs, and each rung
contains the one before it:

- **Propose** — writes a proposal into the inbox and touches nothing.
- **Draft** — opens a worktree, implements the change and commits, then stops.
- **Pull request** — also pushes the branch and opens a draft PR.
- **Auto-merge** — also merges once CI is green. Never a default; opt in per
  automation.

Leave it on **No cap** and every automation runs at the level it set for
itself. Pick a rung and it becomes an app-wide ceiling as well as the level for
automations that set none.

An automation can set its own level, and a project can set a ceiling in its
Project Settings. Argus takes the **lowest** of whichever of the three are set,
so a repository can always ask for less autonomy than this setting allows and
never for more. With none of them set the level is Propose.

A paired phone with control can change it too, under Settings → Automations →
Autonomy cap. The phone's own **Default permission mode** (Settings → Agents)
is local to the phone and only applies to agents started from it.

The limits are enforced by Argus, not by the instructions an automation is
given: a playbook that tells the agent to start a session anyway still produces
a proposal that waits for you.

**Concurrent automation sessions** caps how much work automations can have in
flight at once. Once the cap is reached, further proposals land in the inbox
instead of starting, and you can start them by hand.

---

## LLM

App-level default for which LLM runner and model power new sessions. The
runner is fixed at session creation; the model can still be overridden by
[`.argus.json`](./project-settings.md), individual sessions, or the
new-agent picker.

| Setting           | Default       | Description                                                                                                                            |
| ----------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Runner**        | `claude-code` | The CLI/agent that drives sessions. Claude Code is the built-in runner; any [custom runner](#custom-runners) you add appears here too. |
| **Default model** | _(empty)_     | Optional model id passed to the runner — e.g. `claude-opus-4-7`. Leave blank to let the runner pick its own default.                   |

Resolution order for the runner (at session creation):

1. Project default — the `llm.runner` field in
   [`.argus.json`](./project-settings.md).
2. App default — this setting.

An [automation](./automations.md) can pin its own runner, which wins over both
for its runs and for the sessions its proposals start.

Resolution order for the model (at every agent spawn):

1. Agent override (set in the new-agent picker).
2. Session model (carried on the session, defaulted from project/app at
   create time).
3. Project default — `llm.model` in `.argus.json`.
4. App default — this setting.
5. The runner's own default (custom runners declare one).
6. Whatever the runner picks if none of the above specify a model.

---

## Custom runners

A custom runner reuses an official runner's CLI but points it at a different
endpoint — a gateway like callstack.ai's Apex, a proxy, or a self-hosted
model. Everything else (permissions, MCP, restore-at-turn, the whole agent
experience) is unchanged, because it is still the same CLI underneath.

Pick a template to start from, fill in the fields, and hit **Save**. The
runner then shows up in the runner picker when you create a session, and in
the **LLM** section as an app-wide default.

| Field             | Description                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Name**          | Shown wherever runners are listed. The id (`custom:<slug>`) is derived from it and never changes afterwards.                     |
| **Based on**      | The official runner it delegates to. Claude Code today.                                                                          |
| **Default model** | Used when neither the agent, session, project, nor app default pins a model.                                                     |
| **Environment**   | Variables layered on top of the base runner's environment for every agent and one-shot call. An empty value _unsets_ a variable. |
| **Models**        | Models offered in the model picker. Leave empty to fall back to whatever the base runner advertises.                             |

Values whose name looks like a credential (`token`, `key`, `secret`,
`password`) are masked until you click **Show**. Custom runners are stored in
`~/.argus/custom-runners.json` (readable only by you, since it holds API
tokens) and are never written into the repository — `.argus.json` only
references a runner by id.

### Example: Apex (callstack.ai)

The **Apex (callstack.ai)** template pre-fills everything except your API key:

| Variable                         | Value                      |
| -------------------------------- | -------------------------- |
| `ANTHROPIC_BASE_URL`             | `https://api.callstack.ai` |
| `ANTHROPIC_AUTH_TOKEN`           | your `sk-…` key            |
| `CLAUDE_CODE_ATTRIBUTION_HEADER` | `0`                        |

with `callstack/Apex` as both the listed and the default model.

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

## Worktrees

| Setting                          | Default              | Description                                                 |
| -------------------------------- | -------------------- | ----------------------------------------------------------- |
| **Worktree location**            | `~/.argus/worktrees` | Base folder new session worktrees are created in.           |
| **Automation worktree location** | _(inherits above)_   | Base folder worktrees opened by automations are created in. |

Argus creates `<this folder>/<Repo>-argus-worktrees/<branch>/` underneath,
so one folder can hold several projects. Point it at an external drive to
keep large checkouts off your boot disk; a project can override it from its
own settings.

Automations open worktrees far faster than anyone merges them — nothing is
deleted when a run ends — so they get their own location. Leave it empty and
they follow the setting above. The full order is: this project's automation
location, the app-wide automation location, this project's worktree location,
the app-wide worktree location, then `~/.argus/worktrees`.

**When the drive isn't connected**, that project's sessions stay in the
sidebar showing their last known branch and name, greyed out and not
selectable, and come back untouched when you plug it in. Nothing is pruned
or deleted while a drive is away. If it's the automation drive that's
missing, scheduled runs skip that project with a "… isn't connected" reason
rather than quietly falling back to your boot disk.

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

| Setting       | Default    | Description                                                                                                                                                                                                                                                  |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Telemetry** | `presence` | `Just count me` sends one anonymous heartbeat per launch (random install id + app version) so we can count daily active users. `Full analytics` adds usage, error and crash events. Chosen once on first launch; switch any time here. There is no full off. |

---

## Tools

Argus's device tooling — recording, control, debug streams, the UI inspector — ships as togglable **tools**. Turn off the ones you don't use to keep the UI focused on what you actually reach for.

| Tool                    | What it does                                                               | Needs                                                         |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Device recording**    | Stream iOS Simulator and Android emulator screens into the runtime panel.  | Native sim bridge, Xcode + iOS runtimes, Android SDK + an AVD |
| **Device UI inspector** | Inspect view hierarchy, accessibility, and layout on a connected device.   | Device recording (auto)                                       |
| **Device control**      | Drive devices via `conductor` — taps, keyboard, deep links, navigation.    | Android SDK (for Android), Playwright (for web)               |
| **Device debug**        | Tail device logs, memory, and other conductor probes from the Debug panel. | Device control (auto)                                         |

Pick tools from **Settings → Tools**. All tool assets ship bundled with the app — toggling a tool on or off only affects whether its UI surfaces and IPC handlers are active.

Each tool row in Settings runs its declared prereq checks live and surfaces **Install** buttons for the ones we know how to fix. Failed prereqs don't block the toggle, but the surfaces that depend on a missing prereq will error gracefully when used.

The four core checks (`claude_cli`, `claude_auth`, `git_cli`, `git_identity`) run on the home screen instead, and only show a card when something needs fixing.

### Conductor version

Argus ships with a bundled version of the `conductor` CLI (the tool agents use to drive iOS/Android/web devices). The **Conductor version** dropdown under Settings → Tools lets you pin a different published version without waiting for an Argus release — useful for picking up a conductor fix or trying a newer build.

- The dropdown lists stable versions published to npm, newest first. Only versions **at or above the bundled one** are offered — older conductors predate APIs the app relies on.
- Pick a version and Argus installs `@houwert/conductor@<version>` on demand into `~/.argus/conductor/<version>/`, then points every agent's `conductor` invocation at it.
- Pick **Bundled** to revert to the version that shipped with the app.
- Installing requires **`npm` on your PATH** (Electron's Node has none) and registry access. If the install fails — npm missing, unknown version, offline — Argus keeps using the bundled version and shows the error.
- The pinned version persists at `~/.argus/conductor.json` and is re-provisioned on next launch if needed. Machine-local; not shared with your team.

### Device hosts

Stream and drive iOS simulators that run on **another Mac** — a Mac mini in the closet, a beefier desktop — as if they were local. Add the Mac under **Settings → Tools → Device hosts** (desktop and Argus for Mac). Its simulators then show up in every device picker, the Devices screen and the phone app, labelled with the host's name, and stream to every viewer with touch, keyboard and hardware buttons.

| Field             | Description                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| **SSH target**    | An alias from your `~/.ssh/config`, or `user@host`. Resolved with this Mac's SSH config, keys and `ssh-agent`. |
| **Port**          | Optional. Leave empty to use the SSH config's port (22 by default).                                            |
| **Identity file** | Optional private key, as an absolute path or `~/…`. Leave empty to use your SSH config and agent.              |
| **Label**         | Optional name shown next to the host's devices. Defaults to the host name.                                     |

- **No password prompts.** Argus runs `ssh` in batch mode, so the key has to work without one (load it into `ssh-agent`, or point at an unencrypted key). New host keys are accepted on first use; a host key that _changed_ is refused — fix it with `ssh` in a terminal.
- **Test connection** checks SSH and the prerequisites — macOS, Apple silicon, a working `xcrun simctl` — without installing anything.
- **First use installs** Argus's simulator bridge and input helper into `~/.argus/remote-bin/<version>/` on the remote Mac. Each Argus build pins its own copy, so updates never mix versions.
- **Nothing listens on the network.** The video comes back over the SSH connection itself (`ssh -W` to the remote's loopback), and Argus keeps one multiplexed SSH connection per host. A host that stops answering is retried with back-off.
- **Removing a host** stops its streams and SSH connection. Its simulators keep running.
- The remote Mac needs **Remote Login** turned on (System Settings → General → Sharing) and Xcode installed. Boot simulators from Argus or on that Mac; a user should be logged in there so simulators can render.
- The phone app lists your device hosts (read-only) under Settings. Adding, testing and removing hosts is only possible on this Mac: it makes Argus open SSH connections with your keys, which a paired phone shouldn't be able to trigger.

Not yet supported on device hosts: Android emulators, rotating and folding, the UI inspector, deep links and other `conductor`-driven tools, and agents — agents still reserve and drive simulators on this Mac only.

Saved in `~/.argus/device-hosts.json`. Machine-local; not shared with your team.

#### EAS Simulator hosts

An **EAS Simulator** host gives you iOS simulators in Expo's cloud instead of on a Mac. Pick **EAS Simulator** above the add form. Each EAS device you open starts an [EAS Simulator](https://docs.expo.dev/) session that is **billed to your Expo account** until it stops, so every host bounds them:

| Field                   | Description                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expo access token**   | Optional. Kept in this Mac's secure storage, never in a settings file, and never sent to the phone. Empty uses `EXPO_TOKEN` from Argus's environment, then your `eas login`. |
| **Label**               | Optional name shown next to the host's devices. Defaults to "EAS Simulator".                                                                                                 |
| **EAS project**         | The project sessions run under. Optional when the account has exactly one; **Check account** lists them to pick from.                                                        |
| **Session minutes**     | Longest a session may run, 1–115 (default 30). Free Expo accounts allow at most 40.                                                                                          |
| **Idle minutes**        | A session with no input for this long ends, 1–60 (default 10). Must be smaller than session minutes.                                                                         |
| **Concurrent sessions** | Most sessions this host runs at once, 1–20 (default 2). Opening one more is refused with a message.                                                                          |

- **Check account** shows who the credential signs in as, where it came from (saved token, `EXPO_TOKEN` or `eas login`) and the account's EAS projects.
- **Devices are sessions.** The host lists its running sessions plus one more to open while under its limit. Opening that device starts a session; it can take a few minutes before it streams. Closing (shutting down) the device stops the session.
- **Billing safety.** Every session is created with the run and idle limits above. Removing the host, or quitting Argus, stops its sessions. Argus records each session it starts in `~/.argus/eas-sessions/` before asking Expo for it, so if Argus dies the next launch finds and stops it. Sessions other tools started on the same account are never touched.
- **On the phone**, EAS hosts are listed read-only under Settings with their running sessions. With control access you can start a session there (it says it costs money) and stop it; the token stays on this Mac.
- Rotating, erasing, device settings, the UI inspector and other `conductor`-driven tools aren't available on EAS devices: EAS gives Argus no shell on the simulator's machine. The video and input go through the host, so EAS devices stream to every viewer like any other.

EAS hosts are saved next to SSH hosts in `~/.argus/device-hosts.json` (under `easHosts`); tokens in `~/.argus/eas-tokens.json`, sealed.

---

## Advanced — Update channel

| Setting     | Default  | Description                                                                                                                                                                                                               |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Channel** | `latest` | Auto-updater feed. **Production** (`latest`) tracks the public releases. **Beta** subscribes to in-development builds of upcoming features cut from `main` — should work, but may contain bugs that haven't surfaced yet. |

Production users never see beta builds — they're published under a separate `beta-mac.yml` feed file. Switching channels takes effect on next app restart.

> Alpha builds (one-off cuts from any branch) are not exposed in this dialog. Repo collaborators install them manually by downloading the `.dmg` from the corresponding GitHub release.

`Argus Server.app` has no Settings dialog, so it carries one extra update
preference of its own, toggled from its tray menu and stored in the same
`app-settings.json`:

| Setting                             | Default | Description                                                                                                               |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Install Automatically When Idle** | off     | Server only. Installs a downloaded update and restarts as soon as no agent is running. Never interrupts an agent mid-run. |

See [server-app.md](./server-app.md#updating-the-server) for the full flow.

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
  enrichment entirely. `Just count me` keeps that exposure to one
  request per launch.
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
mode.

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

| Setting                          | Default | Description                                                                                                                                                                         |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch prefix**                | `""`    | Prepended to the branch name when creating a session in this project (e.g. `douwe/`, `team/feature-`). Leave empty to disable. Already-prefixed user-typed branches aren't doubled. |
| **Worktree location**            | `""`    | Base folder this project's worktrees are created in, overriding the app-wide setting. Empty follows the app-wide value. Changing it offers to move the worktrees you already have.  |
| **Automation worktree location** | `""`    | Base folder this project's automation worktrees are created in. Empty follows the worktree location above. Changing it offers to move the automation worktrees you already have.    |

---

## Remote Access

Pair a phone to monitor your projects and agents from anywhere. With remote
access on, Argus runs a gateway that devices on your network reach directly by
IP; tunnels add a way in from outside your network. All traffic is end-to-end encrypted (Noise IK); the
tunnel only ever sees ciphertext. Paired devices are **monitor + approve only** —
they can view projects/sessions/agents and approve or deny permission prompts,
but cannot spawn agents, send messages, or run commands.

| Setting                                     | Default | Description                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enable remote access**                    | Off     | Master kill-switch. On ⇒ the gateway listens on your local network. Off ⇒ the gateway + every tunnel stay down and pairing is refused.                                                                                                          |
| **Tunnels**                                 | All off | **Tailscale** (`tailscale funnel`) and **Cloudflare** (`cloudflared`) toggle independently and run side by side, for access from outside your network. A tunnel needs that provider's CLI on your `PATH`.                                       |
| **Addresses**                               | —       | Read-only list of every address that's live right now, in the order phones try them. Synced to paired devices on connect.                                                                                                                       |
| **Tunnel** (Cloudflare)                     | `quick` | **Quick** = ephemeral `*.trycloudflare.com` URL, no account. **Named** = stable hostname via a connector token + a domain.                                                                                                                      |
| **Connector token**                         | `""`    | Cloudflare tunnel token (named mode). From `cloudflared tunnel token <name>` or the dashboard. Stored encrypted.                                                                                                                                |
| **Public URL**                              | `""`    | The hostname mapped to this machine in Cloudflare (named mode). For quick tunnels it's discovered automatically and shown read-only.                                                                                                            |
| **Paired devices**                          | —       | Each shows its label, last-seen time and grants. **Control** lets it drive agents and land their work; **Admin** hands another Mac of yours the keyboard (see below). **Revoke** deletes its pinned key and drops any live session immediately. |
| **Background push**                         | Off     | Wake paired phones and browsers with a real notification when they aren't connected. Nothing to configure.                                                                                                                                      |
| **Notify my devices while I'm using Argus** | Off     | Mirror notifications to phones and browsers even when the Argus window is focused. Off ⇒ they stay quiet while you're at the desktop.                                                                                                           |
| **Your name on a huddle invite**            | `""`    | The name in "… wants you to join". Empty falls back to the git `user.name` of the session you're sharing — set this if you commit under a name you don't go by.                                                                                 |

### Choosing tunnels

Devices on your network always connect directly by IP — no tunnel and no
external process. Tunnels are only for access from _off_ your network, and they
are not mutually exclusive: enable as many as you like and they run at the same
time, each in its own process. The phone then picks between every address (see
[Picking a route](#picking-a-route)), so the usual setup is **Tailscale**: fast
at home over Wi-Fi, reachable everywhere else.

- **Cloudflare — Quick**: zero setup, just the
  [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  binary. The URL rotates each run, so you re-pair after a restart. Good for a
  first try.
- **Cloudflare — Named**: stable hostname, survives restarts, but needs a
  (free) Cloudflare account **and a domain on Cloudflare**.
- **Tailscale**: stable `*.ts.net` address with **no domain and no Cloudflare
  account** — just the `tailscale` CLI, signed into a tailnet with
  [Funnel](https://tailscale.com/kb/1223/funnel) enabled. Often the sweet spot
  for a stable URL without owning a domain. Argus checks each prerequisite (CLI,
  service, sign-in, Funnel) in Settings and offers a one-click fix for each.

### Picking a route

A desktop usually has several addresses at once, so the phone doesn't make you
choose. On connect it dials **every** known address in parallel and keeps the
simplest one that completes the pinned-key handshake:

1. Local network
2. Tailscale
3. Cloudflare

The full handshake — not just a socket open — is what counts as success, so a
stale LAN IP that now belongs to another machine, or a captive portal that
accepts any connection, can never win: only the real desktop holds the pinned
key. If a worse-ranked address answers first, the phone waits briefly for a
better one before settling.

The address list is re-synced on every connect and whenever a tunnel comes up or
dies, so **turning on a new way in doesn't require re-pairing** — an existing
phone learns the new address the next time it connects over any route that still
works.

### One phone, several computers

A phone can pair with as many computers as you like — a laptop and a desktop,
say. Each pairing keeps its own key, URL and grant, and the phone's home screen
lists them all with their connection state; tapping one connects to it and shows
its projects. The app talks to a single computer at a time, so switching clears
what the previous one had loaded. Tapping a notification switches to whichever
computer the agent belongs to before opening the chat.

The computer's name (from macOS **Computer Name**) travels in the pairing grant
so the list reads "Douwe's MacBook Pro" rather than a tunnel URL; you can rename
it on the phone. Unpairing there removes the phone's copy of that computer's
key — to cut a lost phone off for good, **Revoke** it under **Paired devices**
on the computer as well.

### Phone settings

The phone app's own **Settings** screen holds preferences that stay on that
phone. Under **Transcript**, **Expand image reads** (off by default) opens every
Read tool call that returned an image, so screenshots an agent looks at show in
the chat without a tap. You can still collapse any of them.

### Granting admin to another Mac

**Control** is the phone's grant: watch agents, answer prompts, send messages,
land a session's work (commit, push, merge), open and merge pull requests, and
author automations.
**Admin** is a different thing — it lets another Mac running Argus drive this
one as if you were sitting at its keyboard, which is what the **Hosts** setting
below attaches to. Tick it while confirming the pairing code, or on the device
row afterwards. Admin implies control.

The confirm screen names what is asking to pair — "Argus Remote on iPhone 17
Pro", "Argus Web on iPad", "Argus for Mac" — and offers admin only to a desktop,
because nothing else can act on it. What the client says about itself is its own
claim rather than a verified fact, so it decides what is _offered_, never what
is allowed: the grants are still yours to tick and the host still enforces them.
A client too old to say anything is described as unknown and offered the full
set, as before.

Give it only to a Mac you own. A few things never cross the wire whatever the
grant: opening Finder or an editor, the updater, the popout windows, and
pairing or revoking devices — those stay on the machine they belong to.

### Background push notifications

While a client is connected it gets notifications in-band over the gateway
socket. Once the app is backgrounded, killed, or the last browser tab is closed
that socket is gone, so Argus sends a real push instead.

**Browsers** are reached directly. Web Push keys (VAPID) are self-asserted, so
Argus generates its own on first use, encrypts each notification for that
subscription (RFC 8291), and posts it to whatever push service the browser
picked. No third party is involved and there is nothing to configure. It does
need a **secure context**, so it works over a Cloudflare/Tailscale tunnel but
_not_ over a plain `http://<lan-ip>` address — browsers refuse to register a
service worker there. Safari only offers it to a PWA you've added to the Home
Screen / Dock.

**Phones** can't work that way: only the Apple team that owns the app's bundle
id may push to it, so that credential can't live in your copy of Argus. It sits
in the **Argus push relay** instead (a Cloudflare Function at
`houwert.dev/argus/push`), which forwards to APNs and FCM on your behalf.

The relay is deliberately given as little as possible:

- **It can't read your notifications.** Argus encrypts the whole thing — title,
  body, which agent, which project — with AES-256-GCM under a key your _phone_
  minted and shared over the paired, Noise-encrypted gateway. The relay
  forwards a blob; the alert Apple carries is a fixed "Argus — New activity"
  placeholder, and the phone's notification extension swaps in the real text
  before anything is shown. Even the collapse header is a keyed digest, so your
  agent ids never leave your machine.
- **It won't push to you on a stranger's say-so.** Your phone registers a
  second key with the relay, and every send must be signed with it. The
  signature covers the device, the payload, and a timestamp, so it can't be
  replayed elsewhere. A leaked device token on its own buys nothing, and the
  first registration for a token wins — replacing one requires signing with the
  key already on file.

Nothing here needs configuring. The one editable field is the **push service
contact** — a `mailto:` or `https:` address Mozilla, Google, and Apple use to
reach you if a browser notification misbehaves.

### Quick actions

A notification asking for approval carries **Approve** and **Deny** buttons, and
they are the same buttons everywhere: on the macOS banner, on the phone, and in
the browser. The desktop decides the action set once, so no surface can drift
out of step. Answering from the button never opens the app — the decision goes
straight to the agent, and every other surface clears the prompt.

`AskUserQuestion` prompts deliberately get no buttons: picking an option isn't a
yes/no, so those open the app to be answered properly.

Actions survive being offline. Approve a prompt on a locked phone with the app
killed and the answer is queued, then replayed the moment the gateway comes
back (dropped after 30 minutes, on the grounds that a stale answer is worse than
none). The same holds for a browser actioned with every tab closed.

Android buttons now survive a stopped app too: because the payload is
encrypted, Android can't have the system draw it, so a background task decrypts
and posts the notification itself — and gets to attach the buttons while it
does.

**Browsers** need nothing from you. Argus generates its own VAPID signing key
the first time a browser subscribes, encrypts each notification for that
subscription (RFC 8291), and posts it to whatever push service the browser
picked. The only thing worth setting is the **contact** — a `mailto:` or
`https:` address push services use to reach you if your messages misbehave.

Web Push needs a **secure context**, so it works over a Cloudflare/Tailscale
tunnel but _not_ over a plain `http://<lan-ip>` address — browsers refuse to
register a service worker there. Safari only offers it to a PWA you've added to
the Home Screen / Dock.

Phones, on the other hand, need the credentials for the app you installed,
because your desktop is impersonating that app's own server:

**Apple (iOS)** — from Apple Developer → **Keys**, create a key with the _Apple
Push Notifications service (APNs)_ capability and download the `.p8`. Paste the
key contents plus its **Key ID**, your **Team ID**, and the app's **bundle
identifier** (`dev.houwert.argus.remote` unless you rebuilt it). Argus figures
out sandbox vs. production on its own — if the first send is rejected as the
wrong environment it retries the other one and remembers which worked.

**Firebase (Android)** — from Firebase → Project settings → **Service
accounts**, generate a private key and paste the whole JSON blob. There is no
Android client to register right now (the Expo one is gone and the native app
is iOS), so this is only worth setting once one ships.

Credentials are stored in the same `safeStorage`-encrypted file as the device
keys (`~/.argus/remote-devices.json`), never in plaintext `app-settings.json`,
and are never read back into the UI — the settings screen only shows whether a
key is present. **Test push** next to a paired device sends a real notification
and shows the provider's rejection reason if it fails.

On the phone, **Settings → Background push** turns registration on or off. A
device that has registered shows _push registered_ in the desktop's paired list.

### Notify my devices while I'm using Argus

By default a notification only leaves this machine when the Argus window isn't
focused — otherwise your phone buzzes for an agent you're already watching on
screen. Turn this on to mirror every notification to your devices regardless.
The local banner is unaffected: it is always suppressed while the window has
focus.

### Web client on this network

With remote access on, open `http://<your-ip>:47615` on any device on the same
network — no app install, no tunnel. It still pairs and Noise-authenticates
exactly like the phone, so being on the LAN grants no access on its own.

The browser client itself is served over **every** way in, not just the LAN: a
Tailscale or Cloudflare URL opens the same app in a browser. You can also reach
it from the Home screen's **Remote access** button. (Build the bundle once with `pnpm --filter argus-web build`.)

**Pairing** shows a QR code (and a copy-paste code) plus a 6-digit confirmation
number. Scan it on the device, confirm the number matches on both screens, and
the device is enrolled. The pairing secret travels only in the QR/code — never
over the wire — so nothing in the middle (Cloudflare or Tailscale included) can
impersonate your desktop.

The desktop identity key lives in `~/.argus/remote-devices.json` (encrypted via
`safeStorage`); the tunnel settings live in `app-settings.json`.

---

## Hosts

The other side of remote access: machines **this** Mac can run agents on. A
paired host can be a headless Mac mini working overnight or a workstation
running the ordinary app — from here they look identical.

| Setting          | Default    | Description                                                                                                                                    |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pair a host**  | —          | Paste the pairing code from the other Mac's **Remote access** screen, compare the 6-digit code, and approve it there with **Admin** ticked.    |
| **Paired hosts** | —          | Rename, **Attach** / **Detach**, **Show**, or **Forget**. Forgetting deletes this Mac's key for that host; revoke it there too to be thorough. |
| **Machines**     | `This Mac` | The connection menu in the title bar: every machine this window drives, with its link state.                                                   |

Several hosts can be attached at once — this Mac, a mini for iOS, a Linux box
for Android — and their projects sit alongside each other in the sidebar.
Attaching and showing are separate: **Attach** brings a host's projects in and
keeps its agents streaming in the background, while **Show** points the current
view at one. Attachments are remembered and restored on launch; a host that
can't be reached is skipped with a banner, and the others carry on without it.

Which host a view reads from _is_ part of the URL, so back/forward moves
between machines. A link to a host you aren't attached to falls back to this
Mac rather than stranding you.

While reading from a host:

- **Projects** come from the host's registered projects, not this Mac's recent
  list. **Browse…** walks the _host's_ folders instead of opening a native
  dialog, since the repos are on its disk.
- **Sign-in links** open in the browser in front of you, not on the host.
- **Reveal in Finder** and **Open in editor** are unavailable and say so —
  those files live on the other machine. Use VS Code / Cursor over SSH.
- **Terminals and device screens** come through on the same encrypted
  connection as everything else — the simulator streams live video from the
  host, and taps and keystrokes go back to it. Nothing arbitrates who is
  driving a device yet, so avoid pointing two Macs at the same simulator.
  iOS simulator video adapts to the connection: on a slow link it lowers its
  bitrate, then resolution and frame rate, instead of stuttering, and climbs
  back as the link recovers — without touching the full-quality picture on the
  host itself. Android video keeps the fixed quality it starts with.
- If the connection drops, agents keep running on the host. The window shows a
  disconnected banner, reconnects on its own, and re-pulls a fresh snapshot
  when it does. Only that host is affected; the rest keep working.

Host keys are stored in this Mac's `localStorage` alongside the other UI
preferences. Argus for Mac keeps them in a file only your user can read, in its
state folder, and has the same Hosts tab in its Settings window.

---

## Editor (Mac app)

The Mac app's code view (⌘3 in a session). These live on this Mac only.

| Setting                | Default   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Font**               | SF Mono   | Any installed monospaced font.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Font size**          | `13`      | In points, 8–32.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Tab width**          | `4`       | Columns per indent. A project's `.editorconfig` (`indent_size`, `tab_width`) wins for the files it covers.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Insert spaces**      | `true`    | Tab inserts spaces. `.editorconfig`'s `indent_style` wins; its `trim_trailing_whitespace` and `insert_final_newline` apply on save.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Wrap lines**         | `false`   | Soft-wrap long lines. ⌥Z in the code view toggles it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Show invisibles**    | `false`   | Draw tabs, spaces and line endings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Format on save**     | Automatic | `Automatic` formats on save only files the project has a formatter for (Prettier, SwiftFormat, swift-format, gofmt, Ruff, Black — see [Language servers](language-servers.md#formatting)). `Always` also uses the file's language server where the project has none. `Never` turns it off. Format Document (⇧⌥F) works in every mode. A formatter that fails (a syntax error, not installed, over five seconds) never blocks the save: the file is saved as typed and the status bar says why. The old on/off switch carries over as `Always`/`Automatic`. |
| **Open file links in** | Argus     | `Argus` opens a file an agent mentions in chat in the session's code view, at the line; `Default App` hands it to macOS. Files outside the worktree always use the default app.                                                                                                                                                                                                                                                                                                                                                                            |
| **Language servers**   | on        | Diagnostics, hover, go to definition and completion. Each language can also be turned off on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Where things are stored

Argus keeps everything under `~/.argus/`:

```
~/.argus/
  worktrees/                  ← Session worktrees (one dir per repo)
  sessions/                   ← Session metadata
  app-settings.json           ← Your preferences (theme, display size, agent defaults, editors, git views, telemetry), MCP servers, remote-access tunnel + kill-switch, automations switch
  automations.json            ← Your automations
  automation-runs.json        ← Automation run history (last 50 per automation)
  automation-runs/            ← One working directory per run
  claude-accounts.json        ← Signed-in Claude accounts + the active one
  claude-accounts/            ← Per-account Claude credentials
  remote-devices.json         ← Remote-access identity key, paired devices, push credentials (encrypted)
  mcp-tokens.json             ← MCP sign-ins (encrypted)
  ui-state.json               ← Recent projects, the device each session last used, favourite branches, the Devices view
  user-project-settings.json  ← Per-developer project prefs (branch prefix, worktree locations, …)
  device-hosts.json           ← Other Macs whose simulators Argus streams over SSH
  telemetry-id                ← Anonymous install id
```

Preferences and these picks live in the host's files rather than in one
app, so the Electron app and Argus for Mac share them: change the theme in
one and the other opens in it. The first time the Electron app starts with
this, it copies the preferences it had onto them. Window layout (tabs,
panel widths, collapsed sections) and a few Electron-only git view toggles
stay with the app that set them.

Encrypted files are sealed with a key in your login keychain ("Argus Host
Secret Storage", one per Argus home), which every Argus app on this Mac
reads the same way.

Delete a file or wipe the
directory at any time — Argus recreates what it needs on next launch.
