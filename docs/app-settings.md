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

## Agents

| Setting                     | Default   | Description                                                                          |
| --------------------------- | --------- | ------------------------------------------------------------------------------------ |
| **Default permission mode** | `default` | The permission mode applied to new agents unless overridden in the new-agent picker. |

Permission modes are passed through to Claude Code:

- **`default`** — agent asks before each tool call that isn't already
  allow-listed.
- **`acceptEdits`** — auto-approves file edits.
- **`plan`** — plan-only mode; no edits or shell.
- **`bypassPermissions`** ("yolo") — runs every tool without prompting.

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

UI preferences (theme, display size, default permission mode, custom
editors) live in the app's `localStorage`. Delete a file or wipe the
directory at any time — Argus recreates what it needs on next launch.
