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

| Setting           | Default   | Description                                                                                                                                                                                            |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Theme**         | `system`  | `system`, `light`, or `dark`. `system` follows the OS appearance.                                                                                                                                      |
| **Colour theme**  | `muted`   | Accent colour and a matching background tint: Muted (black and white, no colour accent), Amber, Grove, Ocean, Ember, Iris or Rose. Each has a light and a dark variant, so it follows the theme above. |
| **Display size**  | `default` | One of `larger`, `large`, `default`, `small`, `smaller`. Scales the whole app — useful on very large or very small displays.                                                                           |
| **Launch screen** | `home`    | Which screen Argus opens on: **Home** (the project picker) or **Inbox** (what your automations want from you). Argus always opens on it. \|                                                            |

---

## Accounts

**Settings → Accounts** shows every runner's sign-in: your Claude accounts
first, then each other runner.

### Claude

Stay signed in to several Claude accounts at once and switch between them
instantly — no logging out, no terminal.

- **Claude** — every account you've signed in, with its email, organization
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
parallel. Sessions default to _Follow app default_. Picking an account moves the
chat's agent onto it and carries the conversation over; an agent in the middle
of a turn moves as soon as that turn ends.

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

### Other runners

One row per other runner — Codex, Cursor, Gemini CLI, Antigravity, Kiro,
OpenCode, Grok Build, fx and your own ACP agents — installed ones first. Once
four or more aren't installed, those fold under **Not installed**.

Each row says whether the runner is **Not installed**, **Not signed in**,
**Signed in** (with the account or plan when its CLI reports one) or unknown,
and offers what fits: **Install** and **Sign In** open the same terminal the
runner picker does, **Sign Out** runs the CLI's own sign-out, and **Check
Again** asks it afresh.

| Runner                                       | Status from                                          | Sign out               |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------- |
| Codex                                        | `codex login status` (ChatGPT / API key)             | `codex logout`         |
| Cursor                                       | `cursor-agent status` (email)                        | `cursor-agent logout`  |
| Kiro                                         | `kiro-cli whoami` (Builder ID / IAM Identity Center) | `kiro-cli logout`      |
| OpenCode                                     | `opencode auth list` (provider count)                | `opencode auth logout` |
| Grok Build                                   | —                                                    | `grok logout`          |
| Gemini CLI, Antigravity, fx, your own agents | —                                                    | —                      |

A runner whose CLI has no way to ask shows its status as unknown once it's
installed; Sign In stays available. The phone shows the same list, read-only.

---

## Agents

| Setting                               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Default permission mode**           | `auto`  | The permission mode applied to every new agent — at spawn — unless overridden in the new-agent picker.                                                                                                                                                                                                                                                                                                       |
| **Follow-up suggestions**             | On      | When an agent finishes a turn, a small model (Haiku) reads its last message and suggests up to three replies. They appear above the chat input on every client; click one, or press Tab, to fill the input. Nothing is sent until you send it.                                                                                                                                                               |
| **Warm agents**                       | 1       | How many agents Argus keeps started for the sessions you are looking at — on the Mac or your phone — so starting one there is instant. Off starts every agent from scratch; 2 keeps one ready in each of the two sessions you looked at last. Each warm agent is a running Claude Code process with its MCP servers, so it uses memory while it waits; one nobody has looked at for five minutes is stopped. |
| **Chat history**                      | On      | Keeps each agent's chat in its project's **Chat history** once it has messages, so you can search, read and resume it after the agent is gone. Off stops saving new chats there and stops importing Claude Code chats (manual **Import now** included); chats already saved stay.                                                                                                                            |
| **Import Claude Code chats**          | On      | Chats you ran with the `claude` CLI in a project's folder or one of its Conductor workspaces — in a terminal or another app — show up in that project's chat history, marked Imported, and can be resumed. Checked at launch, when a project is added and every 10 minutes; covers the last 30 days. **Import now** runs it straight away.                                                                   |
| **Automations**                       | On      | Whether automations start agents on their own schedule. Turning it off leaves the manual Run button working.                                                                                                                                                                                                                                                                                                 |
| **Default autonomy**                  | No cap  | App-wide ceiling on how far any automation may go, and the level used by automations that set none.                                                                                                                                                                                                                                                                                                          |
| **Concurrent automation sessions**    | 3       | How many sessions automations may have open at once, across all of them.                                                                                                                                                                                                                                                                                                                                     |
| **Daily automation budget**           | 0       | Spend automations may reach in a day, in USD. 0 means no budget.                                                                                                                                                                                                                                                                                                                                             |
| **Extra commands for read-only runs** | none    | Shell commands a read-only automation may run beyond the built-in reads.                                                                                                                                                                                                                                                                                                                                     |
| **Extra tools for read-only runs**    | none    | Tools a read-only automation may call beyond the built-in reads.                                                                                                                                                                                                                                                                                                                                             |

The default model for new agents is set under [LLM](#llm), next to the runner
it belongs to.

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

| Setting           | Default       | Description                                                                                                                                                                             |
| ----------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runner**        | `claude-code` | The CLI/agent that drives sessions: Claude Code, [Codex](#codex) or an [ACP agent](#acp-agents), plus any [custom runner](#custom-runners) you add.                                     |
| **Default model** | _(empty)_     | Optional model id passed to the runner — e.g. `claude-opus-4-7`. Leave blank to let the runner pick its own default. The new-agent picker starts on it when the agent uses this runner. |

To run one agent on another runner without changing this default, pick it in
the start composer's **Runner** pill (Mac, iPhone and web); the model and
effort pickers then offer that runner's own.

A runner whose CLI isn't installed on the computer stays in every runner
picker, greyed out, with a line saying how to install it; agents can't start
on it until it is. On the Mac, pick it anyway (or use **Set Up a Runner…**
beside the picker) to install it without leaving Argus: **Install** runs its
install command from the table below in a terminal you can watch and answer,
then **Sign In** runs its sign-in command the same way. A CLI that only has
an install page (Antigravity) opens that page instead; **Check Again** once
it's installed. The picker enables the runner as soon as Argus finds it.
When your default runner isn't installed, Home shows a card to install it.

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

### Codex

Pick **Codex** as a session's runner to drive it with OpenAI's Codex CLI
instead of Claude Code. Install it with `npm install -g @openai/codex` and sign
in with `codex login` first; Argus uses your Codex login and
`~/.codex/config.toml` as they are.

The chat works the same: tool cards, permission prompts, interrupts, the Argus
MCP tools, model and effort pickers (the models are the ones your Codex
account offers), and token usage. Permission modes map onto Codex's sandbox
and approval policy:

| Mode        | Codex sandbox   | Asks before                              |
| ----------- | --------------- | ---------------------------------------- |
| **Ask**     | read-only       | any edit or command that isn't read-only |
| **Auto**    | workspace-write | whatever Codex decides needs escalating  |
| **Review**  | workspace-write | commands; edits go through               |
| **Plan**    | read-only       | nothing — it can't change anything       |
| **Trusted** | full access     | nothing                                  |

Editing or forking from an earlier message uses Codex's own thread fork, so
the new chat picks up exactly where that turn left off; when Codex can't fork
there (a message sent into the middle of a running turn), the new chat starts
with the conversation up to that point instead. Side questions run as a
read-only Codex call that sees the chat so far. Codex reports tokens but not
spend, so a Codex chat's cost reads $0.

### ACP agents

Agents that speak the [Agent Client Protocol](https://agentclientprotocol.com)
run through one shared runner. Install the agent's CLI and sign in with it
once (from its picker entry, or yourself with the commands below); Argus starts
it in ACP mode and uses its login and settings as they are.

| Runner          | Id            | CLI                      | Install                                           | Sign in                               |
| --------------- | ------------- | ------------------------ | ------------------------------------------------- | ------------------------------------- |
| **Gemini CLI**  | `gemini`      | `gemini --acp`           | `npm install -g @google/gemini-cli`               | run `gemini` once                     |
| **Antigravity** | `antigravity` | `agy acp` (1.5 or newer) | the Antigravity CLI from antigravity.google       | `agy acp --login`                     |
| **Kiro**        | `kiro`        | `kiro-cli acp`           | `curl -fsSL https://cli.kiro.dev/install \| bash` | `kiro-cli login`                      |
| **OpenCode**    | `opencode`    | `opencode acp`           | `npm install -g opencode-ai`                      | `opencode auth login`                 |
| **Cursor**      | `cursor`      | `cursor-agent acp`       | `curl https://cursor.com/install -fsS \| bash`    | `cursor-agent login`                  |
| **Grok Build**  | `grok`        | `grok agent stdio`       | `npm install -g @xai-official/grok`               | run `grok` once, or set `XAI_API_KEY` |
| **fx**          | `fx`          | `fx acp`                 | `curl -fsSL https://fx.sh/setup.sh \| bash`       | run `fx` once                         |

The chat works the same as on Claude Code: streamed replies and thinking, tool
cards, the agent's plan as the todo list, permission prompts, interrupts, the
model picker (the models the agent offers) and token usage where the agent
reports it. ACP agents ask before acting, and Argus answers by mode:

| Mode        | Goes through without asking                         | Asks before                       |
| ----------- | --------------------------------------------------- | --------------------------------- |
| **Ask**     | nothing                                             | everything the agent asks about   |
| **Review**  | reads, searches and edits inside the worktree       | commands and anything else        |
| **Auto**    | everything except file changes outside the worktree | file changes outside the worktree |
| **Plan**    | reads and searches; changes are refused             | nothing                           |
| **Trusted** | everything                                          | nothing                           |

Plan mode switches the agent into its own plan mode when it has one. Picking
**Always allow** on a prompt keeps the approval for the rest of the session
(Kiro, OpenCode and Grok Build save those project-wide, so there it only allows once).

Editing or forking from an earlier message, and side questions, work too. ACP
can't fork a conversation at an earlier turn, so the new chat starts a fresh
session that gets the conversation up to that point with its first message,
and a side question is a read-only session that sees the chat so far. The
effort picker shows when the agent offers a reasoning level, with the levels
it offers. **Send now** on a queued message stops the agent's current turn
and sends the message straight away, since ACP agents can't take a message
mid-turn. The Argus MCP
tools reach every agent: ones that only take stdio MCP servers (Cursor, so far)
get them through a small bridge Argus ships, along with any other HTTP MCP
servers you've configured. Resuming a chat needs the agent to support it; one that can't
starts fresh and says so.

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
| **Based on**      | The official runner it delegates to (Claude Code, Codex or a built-in ACP agent), or **ACP agent (own command)**.                |
| **Default model** | Used when neither the agent, session, project, nor app default pins a model.                                                     |
| **Environment**   | Variables layered on top of the base runner's environment for every agent and one-shot call. An empty value _unsets_ a variable. |
| **Models**        | Models offered in the model picker. Leave empty to fall back to whatever the base runner advertises.                             |

Values whose name looks like a credential (`token`, `key`, `secret`,
`password`) are masked until you click **Show**. Custom runners are stored in
`~/.argus/custom-runners.json` (readable only by you, since it holds API
tokens) and are never written into the repository — `.argus.json` only
references a runner by id.

### Custom ACP agents

The **Custom ACP agent** template adds any agent that speaks the
[Agent Client Protocol](#acp-agents) — Goose, Qwen Code, an in-house agent —
without waiting for Argus to ship a preset for it. It then shows up in every
runner picker and chats like the built-in ACP agents: same permission modes,
model picker, interrupts and Argus MCP tools (when the agent takes HTTP MCP
servers, which Argus reads from the agent itself).

| Field            | Description                                                                           |
| ---------------- | ------------------------------------------------------------------------------------- |
| **Command**      | The agent's binary, on `PATH` or as an absolute path — e.g. `goose`.                  |
| **Arguments**    | What starts its ACP server, separated by spaces — e.g. `acp`.                         |
| **Install hint** | Shown in the runner pickers when the command isn't found.                             |
| **Sign-in hint** | Shown when the agent says it isn't signed in — e.g. ``Run `goose configure`.``.       |
| **Environment**  | Variables for the agent, e.g. its API key. An empty value _unsets_ a variable.        |
| **Models**       | Optional; leave empty and the model picker offers the agent's own once a chat starts. |

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

## Integrations

Linear and Figma connections for this machine, in Settings → Integrations. See [Integrations](./integrations.md).

| Setting                 | Default | Description                                                                                                                                           |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Move to In Progress** | on      | Moves an issue to its team's first started state when an agent starts from it.                                                                        |
| **Report back**         | `pr`    | When to comment on the session's issue with its changes and simulator screenshots: `off`, `pr` (when a pull request is opened from Argus) or `merge`. |

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
should get, check a `.mcp.json` into the repo.

Merge order (later wins): enabled Claude plugins, `~/.claude.json`, the
worktree's `.mcp.json`, these app-level servers, and finally Argus's
built-in MCP server.

---

## Usage

**Models to count** (`usage_model_filter` in `app-settings.json`) decides which
models the [Usage](./features.md#usage) cost and token figures include. It
holds two lists of rules, each a model id and optionally the runner it applies
to (`claude-code`, `codex`, an ACP agent's id; leave it out to match the model
on any runner):

```json
"usage_model_filter": {
  "include": [{ "runner": "codex", "model": "gpt-5.4" }],
  "exclude": [{ "runner": null, "model": "claude-haiku-4-5" }]
}
```

- **Include** — when it has any rules, only those models count.
- **Exclude** — these models never count.

Rules match the model id the runner recorded, before any **Map to** price
mapping, so a model you leave out isn't counted under the model it maps to
either. Unset, every model counts. Argus for Mac edits both lists in Settings →
Agents (**Usage: count only these models** and **Usage: leave out these
models**).

Model prices set by hand on the Usage screen aren't an app setting: they live
in `~/.argus/usage-prices.json`, shared by every app and device connected to
this computer.

---

## Privacy

| Setting       | Default    | Description                                                                                                                                                                                                                                                  |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Telemetry** | `presence` | `Just count me` sends one anonymous heartbeat per launch (random install id + app version) so we can count daily active users. `Full analytics` adds usage, error and crash events. Chosen once on first launch; switch any time here. There is no full off. |

---

## Tools

Argus's device tooling — recording, control, debug streams, the UI inspector — ships as togglable **tools**. Turn off the ones you don't use to keep the UI focused on what you actually reach for.

| Tool                    | What it does                                                                                                              | Needs                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Device recording**    | Stream iOS Simulator and Android emulator screens into the runtime panel.                                                 | Native sim bridge, Xcode + iOS runtimes, Android SDK + an AVD |
| **Device UI inspector** | Inspect view hierarchy, accessibility, and layout on a connected device.                                                  | Device recording (auto)                                       |
| **Device control**      | Drive devices via `conductor` — taps, keyboard, deep links, navigation. Off also stops telling agents to use `conductor`. | Android SDK (for Android), Playwright (for web)               |
| **Device debug**        | Tail device logs, memory, and other conductor probes from the Debug panel.                                                | Device control (auto)                                         |

Pick tools from **Settings → Tools**. All tool assets ship bundled with the app — toggling a tool on or off only affects whether its UI surfaces and host handlers are active.

Each tool row in Settings runs its declared prereq checks live and surfaces **Install** buttons for the ones we know how to fix. Failed prereqs don't block the toggle, but the surfaces that depend on a missing prereq will error gracefully when used.

The four core checks (`claude_cli`, `claude_auth`, `git_cli`, `git_identity`) run on the home screen instead, and only show a card when something needs fixing.

### Conductor version

Argus ships with a bundled version of the `conductor` CLI (the tool agents use to drive iOS/Android/web devices). The **Conductor version** dropdown under Settings → Tools lets you pin a different published version without waiting for an Argus release — useful for picking up a conductor fix or trying a newer build.

- The dropdown lists stable versions published to npm, newest first. Only versions **at or above the bundled one** are offered — older conductors predate APIs the app relies on.
- Pick a version and Argus installs `@houwert/conductor@<version>` on demand into `~/.argus/conductor/<version>/`, then points every agent's `conductor` invocation at it.
- Pick **Bundled** to revert to the version that shipped with the app.
- Installing requires **`npm` on your PATH** (the Node bundled with Argus has none) and registry access. If the install fails — npm missing, unknown version, offline — Argus keeps using the bundled version and shows the error.
- The pinned version persists at `~/.argus/conductor.json` and is re-provisioned on next launch if needed. Machine-local; not shared with your team.

### Device hosts

Stream and drive iOS simulators that run on **another Mac** — a Mac mini in the closet, a beefier desktop — as if they were local. Add the Mac under **Settings → Tools → Device hosts**. Its simulators then show up in every device picker, the Devices screen and the phone app, labelled with the host's name, and stream to every viewer with touch, keyboard and hardware buttons.

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

> Alpha builds (one-off cuts from any branch) are not offered in Settings. Repo collaborators install them manually by downloading the `.dmg` from the corresponding GitHub release.

Argus Server carries one extra update preference of its own, toggled from its
menu bar item or its Settings and stored in the same `app-settings.json`:

| Setting                             | Default | Description                                                                                                              |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Install Automatically When Idle** | off     | Server only. Downloads an update and restarts into it as soon as no agent is running. Never interrupts an agent mid-run. |

See [server-app.md](./server-app.md#updating-the-server) for the full flow.

What we send (when the toggle is on):

- Anonymous install id (random UUID). Wiping it rotates the id. The id
  isn't linked to a person, account, or email.
- App version, OS, OS version, CPU architecture.
- The bookkeeping properties PostHog's SDK adds itself, listed in
  [telemetry-events.md](./telemetry-events.md). There is no browser SDK in
  the app, so no user agent or screen size.
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

Settings → Git shows **Git identity**: the name and email every commit Argus
makes is authored with.

It also keeps defaults for the git panel. The panel's own toggles
change only the repository on screen.

| Setting                        | Default | Description                                                                                               |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| **Changes list**               | List    | `List` shows changed files flat; `Tree` groups them by directory; `All files` also lists unchanged files. |
| **Diff layout**                | Unified | Unified in one column, or split side by side.                                                             |
| **Ignore whitespace in diffs** | Off     | Hide pure-whitespace changes when comparing files.                                                        |

Pulling follows the repository's own `pull.rebase` / `pull.ff` git config,
which the git panel's settings edit.

### Drafted messages

The sparkles button in the commit composer (⌥⌘G on the Mac; Draft on the phone) drafts a commit
message from the staged changes and the session's chat; on the phone it drafts
from everything uncommitted, since the phone commits it all. **Fill in with
Claude** in the pull request sheet drafts the title and description the same
way. Both run Claude Code on this computer, and you can edit the draft before
committing.

| Setting           | Default                | Description                                                                                                                                                                             |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Message style** | Repository conventions | `Repository conventions` matches the repository's recent commit subjects and its `CLAUDE.md` / `AGENTS.md`. `Custom instructions` follows your own rules.                               |
| **Instructions**  | —                      | Your rules for drafted commits and pull requests, e.g. "Conventional Commits, imperative mood, no body". Used with Custom instructions; left empty, the repository's conventions apply. |

A few git-panel preferences are intentionally _not_ in Settings because
they're pure layout state: the source-sidebar collapsed state
and width, which sub-sections are collapsed, and the
"don't-ask-again" map for confirm dialogs. Those persist
automatically as you use the panel.

---

## Git signing

Per-repo commit signing, under **Commit signing** in the git panel's settings.
Read and written to the local git config of the session on screen, so each
project keeps its own preferences.

| Setting               | Git config key    | Description                                                            |
| --------------------- | ----------------- | ---------------------------------------------------------------------- |
| **Sign every commit** | `commit.gpgsign`  | When on, every commit is signed (Argus relies on git's own machinery). |
| **Format**            | `gpg.format`      | GPG (git's default), SSH or X.509.                                     |
| **Signing key**       | `user.signingkey` | GPG key id, fingerprint, or path to an SSH public key.                 |

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

## Account

Sign in to your [Argus account](accounts.md) under **Settings → Account**, with
Apple, GitHub or an email code. Signing in also puts this Mac's host on the
account, so your phone and your other computers find it on its current address
without a pairing code. When this Mac can't join the account itself, **Link
this Mac with a code** shows a code to type into the Argus app on your phone
(Settings → Account → **Add a computer**); a six-digit number then shows on
both screens: confirm only if they match. On an empty account this Mac becomes the
first member.

Once signed in, the tab lists the devices and computers on the account, online
or offline, and the computers fold into **Hosts**, where you attach to them
like a paired host. Devices waiting to join appear under **Waiting to join**
with Approve and Deny. This Mac's name is under **Settings → General → This
Mac**.

The host keeps a few more account settings. Argus for Mac shows only the
managed tunnel (under Settings → Remote); Argus Server has them all under
Settings → Account & Remote.

| Setting                        | Default                                            | Description                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use the account**            | On                                                 | Off stops publishing this computer's address and refuses account devices, while staying linked.                                                                                              |
| **Publish addresses**          | All on                                             | Which of the LAN address, the tailnet address and the managed tunnel go into the account directory. The account service can see what you publish.                                            |
| **Managed tunnel**             | On                                                 | Run this computer's own tunnel (see [Reaching your computers from anywhere](accounts.md#reaching-your-computers-from-anywhere)) while remote access is on. Off leaves the LAN and Tailscale. |
| **Access for account devices** | iPhone: run agents · Mac and desktop: full control | What devices on the account may do here: the same grants as a pairing (`monitor`, `control`, `admin`).                                                                                       |
| **Approve from this computer** | On                                                 | Whether this computer may approve other computers joining.                                                                                                                                   |
| **Account service**            | empty (built-in)                                   | Another account service, for self-hosting or testing.                                                                                                                                        |

These live with the remote-access keys in the encrypted
`~/.argus/remote-devices.json`, per machine. `argus-host` has them as
`account set …` (see [the server docs](server-app.md)); set its
name with `account set name <name>` (`default` returns to the system name).

## Remote Access

Pair a phone to monitor your projects and agents from anywhere — or skip the
pairing and link this computer to your [account](#account) instead; pairing
is the way in without one. With remote access on, Argus runs a gateway that
devices on your network, and on your tailnet, reach directly by IP. A computer
linked to an account also gets its own **managed tunnel**, the way in from
anywhere else, with nothing to set up. All traffic is end-to-end encrypted
(Noise IK); the tunnel only ever sees ciphertext. Paired devices are
**monitor + approve only** — they can view projects/sessions/agents and approve
or deny permission prompts, but cannot spawn agents, send messages, or run
commands.

| Setting                                     | Default | Description                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enable remote access**                    | Off     | Master kill-switch. On ⇒ the gateway listens on your local network and the managed tunnel runs. Off ⇒ everything stays down and pairing is refused.                                                                                             |
| **Routes**                                  | —       | Read-only: the local network address, this computer's tailnet address when Tailscale is connected, and the managed tunnel's state and address. Synced to paired devices on connect.                                                             |
| **Earlier tunnels**                         | —       | Only shown while a tunnel set up in an earlier version still runs. **Stop using it** stops it and forgets its settings; it also stops by itself once the managed tunnel is up.                                                                  |
| **Paired devices**                          | —       | Each shows its label, last-seen time and grants. **Control** lets it drive agents and land their work; **Admin** hands another Mac of yours the keyboard (see below). **Revoke** deletes its pinned key and drops any live session immediately. |
| **Background push**                         | Off     | Wake paired phones and browsers with a real notification when they aren't connected. Nothing to configure.                                                                                                                                      |
| **Notify my devices while I'm using Argus** | Off     | Mirror notifications to phones and browsers even when the Argus window is focused. Off ⇒ they stay quiet while you're at the desktop.                                                                                                           |
| **Serve the web client on this network**    | Off     | Lets a browser on the same network load the web client at `http://<your-ip>:47615`. Plain http, so only on networks you trust; the tunnel and tailnet always serve it.                                                                          |
| **Your name on a huddle invite**            | `""`    | The name in "… wants you to join". Empty falls back to the git `user.name` of the session you're sharing — set this if you commit under a name you don't go by.                                                                                 |

### Routes

Devices on your network connect directly by IP. Off your network there are two
ways in, and neither needs setting up:

- **Tailscale**: if this computer and the phone are both on your tailnet, the
  phone connects to the computer's tailnet address directly. Just have
  Tailscale running on both.
- **Managed tunnel**: a computer linked to your [account](accounts.md) gets a
  stable `argus-….houwert.dev` address. Argus downloads a pinned, checksum-
  verified `cloudflared` the first time and runs it for you; it only forwards
  to the remote gateway. Set `ARGUS_CLOUDFLARED_PATH` to use a `cloudflared` of
  your own instead.

Cloudflare quick tunnels, named Cloudflare tunnels and Tailscale Funnel are no
longer options. One you had set up keeps running until the managed tunnel
replaces it (see [Tunnels from earlier versions](accounts.md#tunnels-from-earlier-versions)).

### Picking a route

A desktop usually has several addresses at once, so the phone doesn't make you
choose. On connect it dials **every** known address in parallel and keeps the
simplest one that completes the pinned-key handshake:

1. Local network
2. Tailscale
3. Managed tunnel

The full handshake — not just a socket open — is what counts as success, so a
stale LAN IP that now belongs to another machine, or a captive portal that
accepts any connection, can never win: only the real desktop holds the pinned
key. If a worse-ranked address answers first, the phone waits briefly for a
better one before settling.

While it's connected over a slower route, the phone (and the Mac app) check the better ones again whenever the network changes and every few
minutes, and move over as soon as one completes the handshake. A route that
just failed is left alone for a while, so a flaky network can't bounce the
connection.

The address list is re-synced on every connect and whenever a route comes up or
goes away, so **a new way in doesn't require re-pairing** — an existing phone
learns the new address the next time it connects over any route that still
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

The confirm screen names what is asking to pair — "Argus on iPhone 17
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
need a **secure context**, so it works over the managed tunnel but _not_ over
a plain `http://<lan-ip>` or tailnet address — browsers refuse to register a
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

**Through your Argus account.** A phone signed in to an [Argus account](accounts.md)
gets notifications from every computer on the account, including ones it has
never opened. It registers its token with the account once and hands each
computer its sealing key, encrypted so only that computer can open it. The
computer signs every send, and the account service only delivers it while that
computer and that phone are both still on the same account — a removed
computer's sends are refused. The notification itself is sealed exactly as
above, so the service can't read it either. A computer you QR-paired without an
account keeps using the relay as before, and a phone reached both ways gets
each notification once.

Nothing here needs configuring. The one editable field is the **push service
contact** — a `mailto:` or `https:` address Mozilla, Google, and Apple use to
reach you if a browser notification misbehaves.

### Live Activity

On the iPhone, agents working on the connected computer show up as a Live
Activity on the Lock Screen and in the Dynamic Island: each agent's state
(working, needs you, done, failed), how long it has been running, and the tool
it is on. A permission prompt gets **Approve** and **Deny** buttons there too;
they ask for Face ID first, since approving runs code on your computer, and an
answer given while the computer is unreachable waits for it like a
notification's does. Tap an agent to open its chat. Finished agents stay on the
card for 15 minutes after the last one stops.

The phone starts the activity while the app is open and an agent is working,
and hands its push token to the computer. From then on the computer pushes
every update through the same relay, sealed the same way: the relay and Apple
see a coarse phase (working, needs you, done, failed) and an encrypted blob,
which the phone's widget extension opens with the key the notification
extension uses. One card per computer. A computer that restarts forgets the
card until the phone reconnects; the card dims as stale if it goes quiet for an
hour.

Turn it off on the phone in **Settings → Alerts → Live Activity**, or for Argus
in iOS Settings.

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

Web Push needs a **secure context**, so it works over the managed tunnel but
_not_ over a plain `http://<lan-ip>` or tailnet address — browsers refuse to
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
device that has registered shows _push registered_ in the computer's paired list.

### Notify my devices while I'm using Argus

By default a notification only leaves this machine when the Argus window isn't
focused — otherwise your phone buzzes for an agent you're already watching on
screen. Turn this on to mirror every notification to your devices regardless.
The local banner is unaffected: it is always suppressed while the window has
focus.

### Web client on this network

Off by default. Turn on **Serve the web client on this network** (Settings →
Remote Access), and a browser on the same network can open
`http://<your-ip>:47615` — no app install, no tunnel. It still pairs and
Noise-authenticates exactly like the phone, so being on the network grants no
access on its own.

Only turn it on for networks you trust. The page itself travels as plain http,
so someone else on the network could swap in their own version of the web
client and use the access your browser has been granted. The iPhone and Mac
apps aren't affected: they never load code from the gateway. While it's off, a
browser on the network gets a short page pointing it to the tunnel instead.

Over the tunnel or the tailnet the browser client is always served, since
those routes are encrypted: the tailnet address or the managed tunnel's URL
opens the same app in a browser. You can also reach
it from the Home screen's **Remote access** button. (Build the bundle once with `pnpm --filter argus-web build`.)

### MCP clients

Off by default (`remote_mcp_enabled`). Turn on **Let MCP clients sign in**
(Settings → Remote Access → MCP clients) and agents outside Argus can add its
MCP server and sign in over OAuth. Each sign-in waits for you to approve it
there, with read only, supervised or full access; signed-in clients are listed
with Revoke. See [Command line and MCP](cli.md#mcp-for-agents-outside-argus).

**Pairing** shows a QR code (and a copy-paste code) plus a 6-digit confirmation
number. Scan it on the device, confirm the number matches on both screens, and
the device is enrolled. The pairing secret travels only in the QR/code — never
over the wire — so nothing in the middle (Cloudflare or Tailscale included) can
impersonate your desktop.

The computer's identity key lives in `~/.argus/remote-devices.json`
(encrypted), next to the managed tunnel's credentials.

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

Host keys are stored in a file only your user can read, in Argus for Mac's
state folder. Pair and manage hosts under Settings → Hosts.

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

## Menu bar and login (Mac app)

Settings → General → Startup in Argus for Mac. These live on this Mac only.

| Setting              | Default | Description                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open at Login**    | off     | Opens Argus when you log in. If macOS wants your OK first, **Open Login Items…** takes you to System Settings → General → Login Items.                                                                                                                                                                                                          |
| **Show in menu bar** | on      | An Argus item in the menu bar: agents that need you and what's running, pairing a device, approving a join and your Argus account. Off by default when Argus Server is installed on this Mac, since it has its own menu bar item. Dragging the icon off the menu bar with ⌘ held turns it off too. See [the menu bar](mac-app.md#the-menu-bar). |

---

## Agent details (Mac app)

Settings → Appearance → Interface in Argus for Mac. This lives on this Mac only.

| Setting                                | Default | Description                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Show usage limits in agent details** | on      | The session details card lists what's left of each plan window the agent in front draws on: every Claude account for Claude Code, else its runner's own limits. Hover a meter for its reset time and pace; **Usage Limits** opens Usage. The iPhone's session details always show them. |

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
  viewed-files.json           ← Files ticked as viewed in session diffs (pull requests keep theirs on GitHub)
  device-hosts.json           ← Other Macs whose simulators Argus streams over SSH
  usage-prices.json           ← Model prices and mappings set by hand on the Usage screen
  telemetry-id                ← Anonymous install id
```

Preferences and these picks live in the host's files rather than in one
app, so every Argus window on the same home shares them: change the theme in
one and the other opens in it. Window layout (tabs, panel widths, collapsed
sections) stays with the app that set it.

Encrypted files are sealed with a key in your login keychain ("Argus Host
Secret Storage", one per Argus home), which every Argus app on this Mac
reads the same way.

Delete a file or wipe the
directory at any time — Argus recreates what it needs on next launch.
