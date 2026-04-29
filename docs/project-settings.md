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

1. **In-app — Project settings dialog.** Open from the sidebar's repo
   row context menu → _Project settings_. iPad-style screen with
   sections: Setup, Platforms, Workspace env, Run commands, Terminals,
   Browser, Branch protection, Agent. Reads and writes
   `.argus.json` directly. Includes a JSON-preview tab for the exact
   payload that will be saved.
2. **Hand-edit `.argus.json`** at the repo root. The dialog re-reads
   on next open, so the two stay in sync.

| Field                                         | Editable in dialog?              |
| --------------------------------------------- | -------------------------------- |
| `setup.copy` / `symlink` / `commands`         | yes (Setup)                      |
| `min_argus_version`                           | yes (Setup)                      |
| `terminals`                                   | yes (Terminals)                  |
| `run`                                         | yes (Run commands)               |
| `workspace_env`                               | yes (Workspace env)              |
| `platforms`                                   | yes (Platforms)                  |
| `browser_url`, `browser_presets`              | yes (Browser)                    |
| `single_runtime`                              | yes (Run commands)               |
| `agent_prompt`, `save_chat_history`           | yes (Agent)                      |
| `protected_branches`, `pull_request_template` | yes (Branch protection)          |
| `mcp_servers`                                 | yes (MCP servers)                |
| `related_projects`                            | **no** — hand-edit `.argus.json` |

---

## Top-level shape

```jsonc
{
  "setup":              { "copy": [...], "symlink": [...], "commands": [...] },
  "terminals":          [{ "name": "...", "dir": "..." }],
  "run":                [{ "title": "...", "command": "...", "restartOnRerun": true }],
  "workspace_env":      [{ "name": "...", "base_value": 0, "range": 100, "strategy": "sequential" }],
  "platforms":          ["ios", "android", "web"],
  "agent_prompt":       "Extra system prompt appended to every agent.",
  "related_projects":   [{ "path": "../other-repo", "description": "..." }],
  "browser_url":        "http://localhost:3000",
  "browser_presets":    [{ "id": "...", "label": "...", "width": 390, "height": 844, "user_agent": "..." }],
  "save_chat_history":  true,
  "protected_branches": ["main", "master"],
  "pull_request_template": "feature.md",
  "single_runtime":     false,
  "min_argus_version":  "0.10.0",
  "mcp_servers":        { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] } }
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

| Field            | Type        | Default       | Description                                                                                                                                                                                                                       |
| ---------------- | ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`          | `string`    | required      | Display label. Also the identifier — must be unique within the array.                                                                                                                                                             |
| `command`        | `string`    | required      | Shell command, passed to `sh -c`.                                                                                                                                                                                                 |
| `cwd`            | `string?`   | worktree root | Optional relative directory to run the command in.                                                                                                                                                                                |
| `restartOnRerun` | `boolean`   | required      | If `true`, pressing Run while the command is alive kills and restarts it. If `false`, the press is a no-op.                                                                                                                       |
| `requires`       | `string[]?` | `[]`          | Titles of other run commands that must already be running in the same session before this one can start. Useful when a frontend run command needs the backend up first. Starting while a prerequisite is missing throws an error. |

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
all three (iOS, Android, Web) are included.

```jsonc
"platforms": ["ios", "web"]
```

Valid values: `"ios"`, `"android"`, `"web"`.

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

---

## Adding a new project setting

When you build a feature whose behaviour the team should be able to
configure on a per-project basis:

1. Add the field to `ArgusConfig` in
   `electron/services/session/models.ts`. Default it in
   `defaultArgusConfig()`.
2. Parse + normalise it in
   `electron/services/session/setup.ts`. Throw a clear error string
   when the input is malformed.
3. If the field belongs in the auto-generated config, extend
   `electron/services/onboarding/argusJson.ts` so onboarding fills it
   in automatically.
4. Update the **Project settings** section of the in-app Settings
   screen if there's a UI for editing it (currently this section just
   links here for hand-editing).
5. Document it here. Add a row to the table for the relevant block, or
   a new top-level section if it deserves one.
