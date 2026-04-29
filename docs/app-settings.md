# App settings

App-level settings apply to your install of Argus, regardless of which
project is open. They live on your machine and are not shared with the
team.

Open them with **⌘,** or from the command palette → _Settings_.

Two storage layers back these:

- **`localStorage`** — UI preferences (theme, default permission mode,
  custom "Open in" apps). Wiped if you clear browser data for the app.
- **`~/.argus/user-project-settings.json`** — per-project personal
  preferences keyed by repo root path. Each developer keeps their own
  values; the file is never written into any repo.

---

## Appearance

| Setting          | Storage                           | Default   | Description                                                                                                                                                     |
| ---------------- | --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Theme**        | `localStorage` (`argus:theme`)    | `system`  | `system`, `light`, or `dark`. `system` follows the OS `prefers-color-scheme` query.                                                                             |
| **Display size** | `localStorage` (`argus:ui-scale`) | `default` | One of `larger`, `large`, `default`, `small`, `smaller` — applied via Electron's `webFrame.setZoomFactor` so viewport units (and dialog sizes) stay consistent. |

Set the resolved theme on `<html data-theme="…">`, which Peacock tokens
key off of. Hardcoded colours bypass this — see CLAUDE.md.

---

## Agents

| Setting                     | Storage                           | Default   | Description                                                                          |
| --------------------------- | --------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| **Default permission mode** | `localStorage` (`argus:settings`) | `default` | The permission mode applied to new agents unless overridden in the new-agent picker. |

Permission modes are passed through to Claude Code:

- **`default`** — agent asks before each tool call that isn't already
  allow-listed.
- **`acceptEdits`** — auto-approves file edits.
- **`plan`** — plan-only mode; no edits or shell.
- **`bypassPermissions`** ("yolo") — runs every tool without prompting.

---

## Open in apps

| Setting            | Storage                           | Default | Description                                                                              |
| ------------------ | --------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| **Custom editors** | `localStorage` (`argus:settings`) | `[]`    | Extra entries shown in the _Open in…_ menu (sidebar repo row, file context menus, etc.). |

Each entry has a **Name** and a **Command**. The command is either:

- a CLI on `PATH` — e.g. `zed`, `code`, `subl`, `idea`. Argus invokes
  `<command> <path>` with the worktree root.
- an absolute path to a `.app` bundle — e.g. `/Applications/Zed.app`.
  Argus uses `open -a <bundle> <path>`.

---

## MCP servers

| Setting         | Storage                      | Default | Description                                                         |
| --------------- | ---------------------------- | ------- | ------------------------------------------------------------------- |
| **MCP servers** | `~/.argus/app-settings.json` | `{}`    | Personal MCP servers merged into every Argus agent on this machine. |

Each entry has a **Name** and a JSON config matching the
`.mcp.json` `mcpServers` shape — for example:

```jsonc
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"],
}
```

These are merged on top of the standard Claude Code discovery
sources (plugins, `~/.claude.json`, the worktree's `.mcp.json`) and
underneath project-level `mcp_servers` from `.argus.json`. Use this for
servers _you_ want available; use the project setting for servers the
whole team should get.

---

## Privacy

| Setting                      | Storage                           | Default | Description                                                                                                                                                                         |
| ---------------------------- | --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Send anonymous telemetry** | `localStorage` (`argus:settings`) | `false` | Sends anonymous usage and crash events to PostHog so we can find bugs and prioritize features. Consent is collected once during onboarding (telemetry step); flip it any time here. |

What we send (when the toggle is on):

- Anonymous install id (random UUID stored at `~/.argus/telemetry-id`
  for the main process, `localStorage` for the renderer). Wiping it
  rotates the id. We never call `posthog.identify(...)`, so the id
  isn't linked to a person, account, or email.
- App version, OS, OS version, Electron/Node version, CPU arch.
- Standard auto-properties added by PostHog's web SDK in the renderer:
  browser type/version/language, raw user agent, screen and viewport
  size, timezone, in-app URL/path (always `localhost` or the bundled
  file URL — never external sites), and a per-SDK-session id.
- Approximate location, derived **server-side at PostHog** from the
  request IP: country, region, city, postal code, and a city-level
  latitude/longitude. We don't log or persist your IP ourselves, but
  PostHog's ingestion pipeline sees it. If this is unacceptable, leave
  telemetry off.
- Argus-specific events documented in
  [telemetry-events.md](./telemetry-events.md) — feature usage signals
  with the small, named props listed there. Never raw arguments, file
  paths, or project content.
- Errors and crashes from both the main and renderer processes. Stack
  traces are scrubbed of user home directory paths
  (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`).

What we do **not** send:

- Session replays / DOM recordings. Disabled in code (`$has_recording`
  is `false` on every event we emit).
- DOM autocapture — element selectors, click targets, form inputs.
  Disabled in code.
- Prompts, file contents, agent output, project names, branch names,
  repo paths, or any other content of your work.
- A person profile linking the install id to a name, email, or
  account. We don't `identify(...)` and PostHog reports
  `$process_person_profile: false` on every event.

Telemetry is hard-disabled in any non-packaged build (`pnpm dev`,
`vite build` previews, anything where `app.isPackaged` is false /
`import.meta.env.PROD` is false), regardless of the toggle. So our own
development sessions never appear in PostHog. The integration is also
dormant in production builds unless `VITE_POSTHOG_KEY` was configured
at build time.

For the full per-event catalogue and exhaustive property list, see
[telemetry-events.md](./telemetry-events.md).

---

## Per-project personal settings

These are app-level (machine-local) settings _about_ a specific project.
Stored in `~/.argus/user-project-settings.json` keyed by repo root path.

| Setting           | Default | Description                                                                                                                                                                                             |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch prefix** | `""`    | Prepended to the branch name when creating a session in this project (e.g. `douwe/`, `team/feature-`). Leave empty to disable. If a user-typed branch already starts with the prefix, it isn't doubled. |

---

## Storage at a glance

```
localStorage:
  argus:theme              ← Appearance.Theme
  argus:settings           ← Default permission mode + custom editors
  argus:simulator          ← Last-used simulator preferences (UI cache)
  argus:recent-projects    ← Recently opened projects (UI cache)

~/.argus/
  app-settings.json           ← App-level MCP servers (and future global prefs)
  user-project-settings.json  ← Per-developer project prefs (branch_prefix, …)
  worktrees/                  ← Session worktrees (one dir per repo)
  sessions/                   ← Session metadata
```

For project settings _shared_ with the team (setup commands, run
targets, related projects, …) see [project-settings.md](./project-settings.md).

---

## Adding a new app setting

When you build a feature that the user might reasonably want to
customise:

1. Add the field to `app/stores/settingsStore.ts` (or a dedicated store
   if it has its own concerns) with a sensible default.
2. Surface it in the **Settings** dialog under the relevant section
   (`app/components/shared/SettingsDialog/SettingsDialog.tsx`). Reuse
   `SettingsScreenField` from Peacock so labels and captions look
   consistent.
3. Document it here. Keep the table format — most additions are a
   single row.
4. If the new field requires UI primitives Peacock doesn't have yet,
   add the component to Peacock first (see CLAUDE.md design-system
   rules).
