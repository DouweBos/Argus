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

1. **In-app — Project settings dialog.** Open it from the workspace's
   repo row context menu → _Project settings_. Sections cover Setup,
   Platforms, Workspace env, Run commands, Terminals, Browser, Branch
   protection, and Agent, plus a JSON-preview tab for the exact
   payload that will be saved. Reads and writes `.argus.json` directly.
2. **Hand-edit `.argus.json`** at the repo root. The dialog re-reads
   on next open, so the two stay in sync.

| Field                                                                | Editable in dialog?      |
| -------------------------------------------------------------------- | ------------------------ |
| `setup.copy` / `symlink` / `commands`                                | yes (Setup)              |
| `min_argus_version`                                                  | yes (Setup)              |
| `terminals`                                                          | yes (Terminals)          |
| `run`                                                                | yes (Run commands)       |
| `workspace_env`                                                      | yes (Workspace env)      |
| `platforms`                                                          | yes (Platforms)          |
| `browser_url`, `browser_presets`                                     | yes (Browser)            |
| `single_runtime`                                                     | yes (Run commands)       |
| `agent_prompt`, `save_chat_history`                                  | yes (Agent)              |
| `protected_branches`, `pull_request_template`, `default_base_branch` | yes (Branch protection)  |
| `mcp_servers`                                                        | yes (MCP servers)        |
| `release_note_patterns`                                              | yes (Release notes)      |
| `simulator_deeplinks`                                                | yes (Deep links)         |
| `auto_fetch_minutes`                                                 | yes (Git settings panel) |
| `related_projects`                                                   | yes (Related projects)   |

---

## Top-level shape

```jsonc
{
  "setup":              { "copy": [...], "symlink": [...], "commands": [...] },
  "terminals":          [{ "name": "...", "dir": "..." }],
  "run":                [{ "title": "...", "command": "...", "restartOnRerun": true }],
  "workspace_env":      [{ "name": "...", "base_value": 0, "range": 100, "strategy": "sequential" }],
  "platforms":          ["ios", "android", "tvos", "web"],
  "agent_prompt":       "Extra system prompt appended to every agent.",
  "related_projects":   [{ "path": "../other-repo", "description": "..." }],
  "browser_url":        "http://localhost:3000",
  "browser_presets":    [{ "id": "...", "label": "...", "width": 390, "height": 844, "user_agent": "..." }],
  "simulator_deeplinks": [{ "label": "Profile", "url": "myapp://profile/123" }],
  "save_chat_history":  true,
  "protected_branches": ["main", "master"],
  "pull_request_template": "feature.md",
  "default_base_branch": "staging",
  "single_runtime":     false,
  "min_argus_version":  "0.10.0",
  "mcp_servers":        { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] } },
  "auto_fetch_minutes": 15
}
```

All fields are optional. Defaults below.

---

## `setup` — what happens when a worktree is created

Runs once per session, after `git worktree add`, in the new worktree.
Order: copy → symlink → commands.

```jsonc
"setup": {
  "copy":     [".claude", "node_modules", "ios/Pods"],
  "symlink":  [".env.local", "**/.env.local"],
  "commands": ["pnpm install", "cd ios && pod install"]
}
```

| Field      | Type       | Default | Description                                                                                                                                                                                       |
| ---------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copy`     | `string[]` | `[]`    | Files/dirs to copy from the main repo into the worktree. Glob patterns supported. Useful for `node_modules`, `.claude/`, native build artefacts, anything you don't want to rebuild from scratch. |
| `symlink`  | `string[]` | `[]`    | Files to symlink into the worktree (changes flow both ways). Glob patterns supported. Use for shared secrets like `.env.local`.                                                                   |
| `commands` | `string[]` | `[]`    | Shell commands run in the worktree after copy/symlink. Each entry is passed to `sh -c`.                                                                                                           |

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

## `platforms` — runtime targets

Tells the agent system prompt which runtimes to describe. If omitted,
iOS, Android, and Web are included; declare `platforms` to opt into
tvOS or to narrow the set to only what your project ships.

```jsonc
"platforms": ["ios", "tvos"]
```

Valid values: `"ios"`, `"android"`, `"tvos"`, `"web"`.

---

## `agent_prompt` — extra agent system prompt

Free-form string appended to the Claude system prompt every agent in
the project receives. Use it for project-specific conventions ("Use
React Query for all server state", "Never edit `dist/`", ...).

```jsonc
"agent_prompt": "All new screens must register a route in app/lib/router.tsx."
```

---

## `related_projects` — cross-repo agent work

Other repos that agents in this project may spawn worktrees in.
Surfaced via the `list_projects` MCP tool.

```jsonc
"related_projects": [
  { "path": "../conductor",   "description": "CLI used for runtime mobile testing" },
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

## `save_chat_history` — persist chat after agent stops

When `true` (default), the chat history of stopped agents is preserved
and visible in the agent tab. When `false`, stopped agents start fresh
on next interaction.

```jsonc
"save_chat_history": true
```

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

The branch preselected as the source when creating a new session in the
Create-Session dialog. Useful when your team's default integration
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

## `pull_request_template` — preferred PR template filename

If the repo has multiple PR templates under
`.github/PULL_REQUEST_TEMPLATE/`, GitHub requires an explicit
`?template=` query parameter. Set this to the filename Argus should
prefer (e.g. `"feature.md"`).

---

## `min_argus_version` — warn teammates on older Argus builds

Semver string (e.g. `"0.10.0"`). When set, the project home screen
shows a warning banner if the running Argus version is lower. Useful
when your `.argus.json` relies on a config key, MCP server, or run
command behaviour added in a specific Argus release. Pre-release and
build suffixes are not supported.

```jsonc
"min_argus_version": "0.10.0"
```

---

## `single_runtime` — only one runtime active per project

When `true`, the project may only have one `run` command alive across
**all** its sessions at once. Pressing Run while another session is
already running prompts you to stop the other runtime or cancel.
Useful when your run command claims a fixed port that can't be
remapped via `workspace_env`.

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
    "glob":   "apps/plex/app/release-notes/next/*.txt",
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

## `mcp_servers` — extra MCP servers for every agent

Map of server name → `.mcp.json`-style config, merged into every agent
spawned for this project. Use this when your team needs a shared MCP
server but you'd rather keep the entry next to the rest of your project
config than maintain a separate `.mcp.json`.

```jsonc
"mcp_servers": {
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  },
  "remote": {
    "url": "https://example.com/mcp",
    "headers": { "Authorization": "Bearer ..." }
  }
}
```

Merge order (later wins): enabled Claude plugins, `~/.claude.json`, the
worktree's `.mcp.json`, your personal `~/.argus/app-settings.json`,
`mcp_servers` from this file, and finally Argus's built-in MCP server.
Use the project-level entry for things the team should share; use the
**app-level** field (Settings → MCP servers) for personal servers.

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
  "platforms": ["web"],
  "browser_url": "http://localhost:1420",
  "protected_branches": ["main"],
}
```
