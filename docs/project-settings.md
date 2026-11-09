# Project settings — `.argus.json`

Per-project settings live in `.argus.json` at the repo root. This file
is checked into the repository, so the whole team shares the same
configuration.

A second file, `.argus.local.json` (gitignored), is merged on top of
`.argus.json` for personal overrides — handy when you want to add a run
target locally without dirtying the team config.

|                     | Lives at  | Shared?             | Use for                                                        |
| ------------------- | --------- | ------------------- | -------------------------------------------------------------- |
| `.argus.json`       | repo root | yes (commit it)     | setup, run commands, related projects, anything the team needs |
| `.argus.local.json` | repo root | **no** (gitignored) | personal run targets, local-only env, experiments              |

For app-level (machine-local) preferences, see
[app-settings.md](./app-settings.md).

---

## Where to edit

Two ways to change project settings:

1. **In-app — Project Settings.** Open it from a project's menu in the
   sidebar → _Project Settings…_. Sections cover Setup, Workspace env,
   Run commands, Terminals, Browser, Deep links, Branch protection,
   Release notes, Agent, LLM, Related projects, Automations and Tools,
   plus the personal Branch prefix and Worktree location (stored outside
   the repo, see
   [per-project personal settings](./app-settings.md#per-project-personal-settings)) and a JSON-preview
   tab for the exact payload that will be saved. Reads and writes `.argus.json` directly;
   saving changes only the fields the dialog edits, so other keys and
   `.argus.local.json` overrides stay where they are.
2. **Hand-edit `.argus.json`** at the repo root. The dialog re-reads
   on next open, so the two stay in sync.

| Field                                       | Editable in dialog?     |
| ------------------------------------------- | ----------------------- |
| `setup.copy` / `symlink` / `commands`       | yes (Setup)             |
| `terminals`                                 | yes (Terminals)         |
| `run`                                       | yes (Run commands)      |
| `workspace_env`                             | yes (Workspace env)     |
| `browser_url`, `browser_presets`            | yes (Browser)           |
| `single_runtime`                            | yes (Run commands)      |
| `auto_continue_on_limit`                    | yes (Agent)             |
| `protected_branches`, `default_base_branch` | yes (Branch protection) |
| `release_note_patterns`                     | yes (Release notes)     |
| `simulator_deeplinks`                       | yes (Deep links)        |
| `auto_fetch_minutes`                        | yes (Branch protection) |
| `llm`                                       | yes (LLM)               |
| `related_projects`                          | yes (Related projects)  |
| `automations`                               | yes (Automations)       |
| `tools.disabled`                            | yes (Tools)             |

---

## Top-level shape

```jsonc
{
  "setup":              { "copy": [...], "symlink": [...], "commands": [...] },
  "terminals":          [{ "name": "...", "dir": "..." }],
  "run":                [{ "title": "...", "command": "...", "restartOnRerun": true }],
  "workspace_env":      [{ "name": "...", "base_value": 0, "range": 100, "strategy": "sequential" }],
  "related_projects":   [{ "path": "../other-repo", "description": "..." }],
  "browser_url":        "http://localhost:3000",
  "browser_presets":    [{ "id": "...", "label": "...", "width": 390, "height": 844, "user_agent": "..." }],
  "simulator_deeplinks": [{ "label": "Profile", "url": "myapp://profile/123" }],
  "auto_continue_on_limit": false,
  "protected_branches": ["main", "master"],
  "default_base_branch": "staging",
  "single_runtime":     false,
  "auto_fetch_minutes": 15,
  "llm":                { "runner": "claude-code", "model": "claude-opus-4-7" },
  "tools":              { "disabled": ["device-debug"] },
  "automations":        { "autonomy_ceiling": "draft", "disabled": [...], "path_denylist": [...] }
}
```

All fields are optional. Defaults below.

---

## `setup` — what happens when a worktree is created

Runs once per session, after `git worktree add`, in the new worktree.
Order: copy → symlink → commands.

```jsonc
"setup": {
  "copy": [
    "node_modules",
    "ios/Pods",
    // Object form: copy `.claude` but skip Claude Code's own per-session
    // worktrees so they don't leak from the source branch into new ones.
    { "path": ".claude", "exclude": ["projects/**/worktrees/**"] }
  ],
  "symlink":  [".env.local", "**/.env.local"],
  "commands": ["pnpm install", "cd ios && pod install"]
}
```

| Field      | Type                               | Default | Description                                                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `copy`     | `(string \| { path, exclude? })[]` | `[]`    | Files/dirs to copy from the main repo into the worktree. Each entry is either a path/glob string or `{ path, exclude }` — `exclude` patterns are forwarded to `rsync --exclude`, so they prune mid-tree (e.g. excluding Claude Code's per-session worktrees nested deep inside `.claude`). |
| `symlink`  | `(string \| { path, exclude? })[]` | `[]`    | Files to symlink into the worktree (changes flow both ways). Glob patterns supported. The object form is accepted for symmetry, but `exclude` only filters glob expansions — symlinking a literal directory is a single link with no subtree to prune.                                     |
| `commands` | `string[]`                         | `[]`    | Shell commands run in the worktree after copy/symlink. Each entry is passed to `sh -c`.                                                                                                                                                                                                    |

---

## `terminals` — auto-opened terminal tabs

Tabs spawned in the bottom panel when a session is selected.

```jsonc
"terminals": [
  { "name": "Shell", "dir": "." },
  { "name": "Logs",  "dir": "apps/api" }
]
```

| Field  | Type     | Default  | Description                                |
| ------ | -------- | -------- | ------------------------------------------ |
| `name` | `string` | required | Tab label.                                 |
| `dir`  | `string` | required | Relative directory from the worktree root. |

---

## `run` — entries shown in the Run menu

Each entry becomes a button in the runtime panel. Argus tracks the
process per-session and shows a stop button while it's alive.

```jsonc
"run": [
  { "title": "Dev",      "command": "pnpm dev",       "restartOnRerun": true },
  { "title": "Storybook","command": "pnpm storybook", "restartOnRerun": true }
]
```

| Field            | Type        | Default       | Description                                                                                                                                                                              |
| ---------------- | ----------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`          | `string`    | required      | Display label. Also the identifier — must be unique within the array.                                                                                                                    |
| `command`        | `string`    | required      | Shell command, passed to `sh -c`.                                                                                                                                                        |
| `cwd`            | `string?`   | worktree root | Optional relative directory to run the command in.                                                                                                                                       |
| `restartOnRerun` | `boolean`   | required      | If `true`, pressing Run while the command is alive kills and restarts it. If `false`, the press is a no-op.                                                                              |
| `requires`       | `string[]?` | `[]`          | Titles of other run commands this one depends on. Argus starts any that aren't already running before launching this command (recursively). Cycles in the dependency chain are rejected. |

---

## `workspace_env` — per-session env vars

Sets one or more env vars in every terminal/run command of the
session, with a value unique to that session. Used for port allocation
in particular.

```jsonc
"workspace_env": [
  { "name": "ARGUS_PORT", "base_value": 1420, "range": 100, "strategy": "sequential" }
]
```

| Field        | Type                     | Default  | Description                                                                                                                         |
| ------------ | ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | `string`                 | required | Env var name (e.g. `ARGUS_PORT`, `RCT_METRO_PORT`, `PORT`).                                                                         |
| `base_value` | `number`                 | required | Starting integer; final value is `base_value + offset`.                                                                             |
| `range`      | `number`                 | required | Modulus for the `hash` strategy.                                                                                                    |
| `strategy`   | `"sequential" \| "hash"` | required | `sequential` — assigned at session creation from a counter. `hash` — derived deterministically from the branch name modulo `range`. |

---

## `related_projects` — cross-repo agent work

Other repos that agents in this project may spawn worktrees in.
Surfaced via the `list_projects` MCP tool.

```jsonc
"related_projects": [
  { "path": "../conductor",   "description": "CLI used for runtime browser and device testing" },
  { "path": "../houwert.dev", "description": "Marketing site" }
]
```

| Field         | Type     | Default  | Description                                                     |
| ------------- | -------- | -------- | --------------------------------------------------------------- |
| `path`        | `string` | required | Relative path from this repo's root to the related repo's root. |
| `description` | `string` | required | One-line description shown to spawned agents.                   |

---

## `browser_url` — default URL for the embedded browser

The web runtime panel loads this on first open.

```jsonc
"browser_url": "http://localhost:5173"
```

---

## `browser_presets` — custom device presets for the web browser

Add device presets (label, viewport, optional UA) on top of Argus's
built-in list.

```jsonc
"browser_presets": [
  { "id": "kiosk", "label": "Kiosk 1080p", "width": 1920, "height": 1080 },
  { "id": "ipad-air", "width": 820, "height": 1180,
    "user_agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)..." }
]
```

| Field        | Type      | Default        | Description                    |
| ------------ | --------- | -------------- | ------------------------------ |
| `id`         | `string`  | required       | Unique key for this preset.    |
| `label`      | `string?` | `id`           | Display name in the picker.    |
| `width`      | `number`  | required       | Viewport width in CSS pixels.  |
| `height`     | `number`  | required       | Viewport height in CSS pixels. |
| `user_agent` | `string?` | desktop Chrome | Custom UA string.              |

---

## `simulator_deeplinks` — runtime toolbar deep links

Surfaces a **Link** button in the runtime toolbar (next to Home / Disconnect)
when a simulator or emulator is connected. Clicking it opens a dropdown of
URLs the team has configured, and the chosen entry is fired into the device
via `conductor open-link <url>`.

Entries are either **leaf links** (`{ label, url }`) or **folders**
(`{ label, children: [...] }`). Folders may contain folders, so long lists
can be organised hierarchically.

```jsonc
"simulator_deeplinks": [
  { "label": "Profile",  "url": "myapp://profile/123" },
  { "label": "Checkout", "url": "myapp://checkout?cart=demo" },
  {
    "label": "Onboarding",
    "children": [
      { "label": "Welcome",  "url": "myapp://onboarding/welcome" },
      { "label": "Sign up",  "url": "myapp://onboarding/signup" },
      {
        "label": "Verify",
        "children": [
          { "label": "Email", "url": "myapp://onboarding/verify/email" },
          { "label": "Phone", "url": "myapp://onboarding/verify/phone" }
        ]
      }
    ]
  }
]
```

| Field      | Type                        | Default                     | Description                                                              |
| ---------- | --------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `label`    | `string`                    | required                    | Display name shown in the dropdown.                                      |
| `url`      | `string`                    | required for leaf entries   | URL or custom-scheme deep link. Mutually exclusive with `children`.      |
| `children` | `SimulatorDeeplinkConfig[]` | required for folder entries | Nested entries grouped under this folder. Mutually exclusive with `url`. |

Works for iOS simulators and Android emulators alike — any device
`conductor open-link` recognises.

---

## `protected_branches` — require PR for these branches

Sessions whose **base branch** is in this list cannot be merged
directly — instead they surface a _Push & open PR_ flow.

```jsonc
"protected_branches": ["main", "master", "release/*"]
```

The default `.argus.json` Argus generates includes `["main", "master"]`.

---

## `default_base_branch` — preselected source branch for new sessions

The branch preselected as the base when a prompt starts in a new worktree.
Useful when your team's default integration
branch is something other than `main` (for example, `staging` or
`develop`).

```jsonc
"default_base_branch": "staging"
```

The branch must exist locally to be picked. When unset (or missing
locally), Argus walks a built-in fallback chain — `staging` → `develop`
→ `dev` → `main` → `master` — and finally falls back to the first local
branch.

---

## `single_runtime` — only one runtime active per project

When `true`, the project may only have one `run` command alive across
**all** its sessions at once. Pressing Run while another session is
already running prompts you to stop the other runtime or cancel.
Useful when your run command claims a fixed port that can't be
remapped via `workspace_env`.

---

## `auto_continue_on_limit` — resume agents after a usage limit

When `true`, an agent whose turn stops because the Claude plan's usage
limit is spent is sent `continue` automatically once the limit resets
(a minute after the reset time Claude Code reports, or an hour later if
it reports none). While a continue is pending, the agent's chat shows
when it will fire, with a **Cancel** button that keeps Argus from
continuing that agent until one of its turns gets through. A message you
send that goes through replaces the pending continue. Argus gives up
after five continues in a row that hit the limit again.

```jsonc
"auto_continue_on_limit": true
```

Separately from this setting, when you have more than one Claude account
signed in, a chat stopped by the limit lists your other accounts that still
have usage left, with **Continue here** next to each. Picking one moves the
chat onto that account and continues it. Argus never switches accounts on its
own, so a personal project never lands on a work plan by accident.

---

## `release_note_patterns` — surface text-file release notes

Glob patterns (repo-root relative) describing release-note files that
Argus surfaces on the session home screen. Drives the single
**Ready-to-merge** release-notes list — every release-note style is
expressed as a pattern with a `format` (including `@changesets/cli`).

When set, every file matching one of the patterns that was added or
modified on the session's branch versus its base is listed with its
content rendered inline and any configured labels shown as Badges next
to the filename.

```jsonc
"release_note_patterns": [
  // @changesets/cli — labels come from YAML frontmatter automatically
  { "glob": ".changeset/*.md", "format": "changesets" },

  // bare glob — file content shown, no extracted labels
  "apps/foo/release-notes/next/*.md",

  // structured form — extract labels via regex
  {
    "glob":   "apps/mobile/app/release-notes/next/*.txt",
    "format": "regex",
    "labels": [
      { "name": "type",     "selector": "^Type:\\s*(.+)$",     "tone": "accent" },
      { "name": "platform", "selector": "^Platform:\\s*(.+)$", "tone": "neutral" },
      { "name": "issue",    "selector": "^Issue:\\s*(.+)$",    "tone": "success" }
    ]
  },

  // structured form — extract labels via JSON path
  {
    "glob":   "release-notes/pending/*.json",
    "format": "json",
    "labels": [
      { "name": "type",      "selector": "type",     "tone": "accent" },
      { "name": "platforms", "selector": "platforms"                  }
    ]
  }
]
```

| Field    | Type                                                   | Default   | Description                                                                                                                    |
| -------- | ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `glob`   | `string`                                               | required  | Glob pattern, repo-root relative. `**` crosses directories, `*` does not cross `/` — matches git's `:(glob)` pathspec rules.   |
| `format` | `"regex" \| "json" \| "yaml" \| "xml" \| "changesets"` | `"regex"` | How to parse the file. `changesets` reads YAML frontmatter; the others are described below.                                    |
| `labels` | `{ name, selector, tone? }[]`                          | `[]`      | Fields to extract and render as Badges in the card header. Ignored when `format: "changesets"` (labels derived automatically). |

### Label selectors

- **`format: "regex"`** — `selector` is a regex applied with `m` and `i`
  flags. The first capture group is the badge value; if no group is
  present, the whole match is used. Example: `^Type:\\s*(.+)$`.
- **`format: "json" | "yaml" | "xml"`** — `selector` is a dotted path
  into the parsed object. Use numeric segments to index arrays (e.g.
  `meta.tags.0`). Array values at the leaf are rendered comma-joined.
- **`format: "changesets"`** — no `labels` config needed. Each
  `"<package>": <bump>` entry in the YAML frontmatter becomes a Badge
  (major → warning tone, minor → accent, patch → success), and the body
  after the closing `---` is the entry's content. The
  **Validate with agent** button appears when at least one entry is in
  this format.

`tone` controls the Badge colour and is one of `"accent"`, `"neutral"`
(default), `"success"`, or `"warning"`.

| Behaviour                         | Effect                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty / unset, no `.changeset/`   | No release-notes section is shown.                                                                                                                    |
| Empty / unset, `.changeset/` repo | Argus auto-injects a `{ glob: ".changeset/*.md", format: "changesets" }` entry so existing `@changesets/cli` projects keep working with no migration. |
| Configured                        | Only the configured patterns drive the list — the changesets auto-fallback is skipped, so projects can opt out of changesets entirely.                |

---

## `auto_fetch_minutes` — background auto-fetch interval

When set, Argus runs `git fetch --prune` in the background at this
interval (in minutes) for every active session in the project. The
status strip's "Last fetched" timestamp updates automatically after
each fetch.

```jsonc
"auto_fetch_minutes": 15
```

Valid values: any positive integer. Omit or set to `0` to disable
auto-fetch entirely (the default).

The field can also be changed from **Git Settings** in the project's
git panel — the change takes effect immediately for all open sessions
and is written back to `.argus.json`.

> Note: `suppress_lfs_warning` is the personal counterpart that lives
> in `~/.argus/user-project-settings.json`. It hides the git-lfs
> banners without touching the repo.

---

## `llm` — default LLM runner and model

Project-level default for the LLM runner (e.g. Claude Code) and the
model agents in this project should use. Sits between agent/session
overrides and your app-level default in the resolver cascade:

> agent override → session → **project (`llm`)** → app default

The **runner** is bound at session creation and immutable for the
session's lifetime. The **model** is re-resolved every time an agent
spawns, so changing it in `.argus.json` takes effect on the next agent.

```jsonc
"llm": {
  "runner": "claude-code",
  "model": "claude-opus-4-7"
}
```

Both fields are optional. Omit either to let the cascade fall through
to the next level. An unknown `runner` id is logged as a warning and
the resolver falls back to the app default — handy if a runner is
removed or renamed across releases.

Built-in runners are `claude-code`, `codex` (see
[Codex](./app-settings.md#codex)) and the ACP agents `gemini`, `antigravity`,
`kiro`, `opencode` and `cursor` (see [ACP agents](./app-settings.md#acp-agents)); custom runners use their `custom:<slug>`
id. With nothing set at any level, sessions run on `claude-code`.

---

## `tools` — mask tools off for this project

Tools (Device recording, Device control, Device debug, UI inspector) are an opt-in app-level setting. A project can additionally **mask tools off** for everyone working on it — useful for repos that don't use device tooling at all (server-only projects, CLI tools).

```jsonc
"tools": {
  "disabled": ["device-recording", "device-debug"]
}
```

Effective enable = the user has the tool on **and** this list doesn't contain it. The mask is one-way: a project cannot force-enable a tool a developer has turned off in their personal settings.

Edit via **Project Settings → Tools** — the dialog lists every tool and toggles them straight into this field. The list is checked into `.argus.json` so the mask travels with the repo.

Valid ids: `device-recording`, `device-inspector`, `device-control`, `device-debug`. Unknown ids are ignored (no error, no warning) so the field tolerates renames across releases.

---

## `automations` — how far automations may go here

Argus automations run on a clock and can start work on their own — see
[Automations](./automations.md). This block is how a repository caps that, and
it is shared with the team.

```jsonc
"automations": {
  "autonomy_ceiling": "draft",          // this repo never goes past draft
  "disabled": ["regression-sweep"],     // automation ids or template ids
  "path_denylist": ["infra/**", "**/migrations/**"]
}
```

- **`autonomy_ceiling`** — the highest rung any automation reaches in this
  repo: `propose` (inbox only), `draft` (implement and commit), `pr` (also push
  and open a draft PR) or `auto_merge` (also merge on green CI). Argus takes the
  lowest of the app default, the automation's own level and this ceiling, so the
  field can only ever tighten. Omit it for no repo-level cap.
- **`disabled`** — automations that must not act on this repo at all. Match
  either the automation's id or the built-in template id (e.g.
  `morning-triage`, `take-the-easy-ones`).
- **`path_denylist`** — globs no automation-started branch may touch. Checked
  against the branch's actual changes immediately before it is pushed, and
  added to whatever the automation already forbids.

Edit via **Project Settings → Automations**. The limits are enforced by Argus
itself, not by the instructions an automation is handed — a playbook telling the
agent to push anyway is refused at the tool call, and so is the agent running
`git push` or `gh pr create` from a terminal in a session the automation
started.

---

## A complete example

```jsonc
{
  "setup": {
    "copy": [".claude", "node_modules"],
    "symlink": [".env.local"],
    "commands": ["pnpm install"],
  },
  "terminals": [{ "name": "Shell", "dir": "." }],
  "run": [
    { "title": "Dev", "command": "pnpm dev", "restartOnRerun": true },
    {
      "title": "Storybook",
      "command": "pnpm storybook",
      "restartOnRerun": true,
    },
  ],
  "workspace_env": [
    {
      "name": "ARGUS_PORT",
      "base_value": 1420,
      "range": 100,
      "strategy": "sequential",
    },
  ],
  "browser_url": "http://localhost:1420",
  "protected_branches": ["main"],
  "llm": { "runner": "claude-code", "model": "claude-opus-4-7" },
}
```
