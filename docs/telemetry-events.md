# Telemetry events

Catalog of every event Argus sends to PostHog. Telemetry has **two
levels**, picked during the one-time consent step on first launch and
changeable any time under Settings → Privacy:

| Mode       | What gets sent                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presence` | Exactly one event per app launch: a [heartbeat `$pageview`](#presence) with a fixed `argus:///` path. No baseProps, no errors, no feedback, no other `$pageview`s. |
| `full`     | The whole catalogue below — lifecycle, sessions, merges, agents, org tasks, errors, feedback.                                                                      |

`presence` is the floor and the default — there is no mode in which the
anonymous DAU heartbeat is suppressed. It carries nothing but a random
install id and the app version.

Events come from three channels: **main** (the Argus app process,
covering lifecycle, sessions, merges, agents, org tasks), **renderer**
(the UI, covering renderer lifecycle and feedback), **ios** (the
iOS client — see [iOS client](#ios-client)) and **web** (the browser client —
see [Web client](#web-client)). Desktop has one PostHog
client, in the main process: the renderer sends its events over IPC and
main does the talking, so there is no browser SDK in the app. The iOS
and web clients talk to PostHog directly, because they have to work unpaired
and offline. In `presence` mode the renderer emits nothing — the heartbeat
is sent from main only.

## What's attached to every event

The "every event" rules below describe what `full` mode sends. **Presence
mode is different** — see the dedicated [Presence](#presence) section: it
attaches only `app_version` and the unavoidable GeoIP / SDK bookkeeping,
nothing else.

When you opt in to full mode, every event PostHog receives carries the catalogue below.
Some of these come from our explicit `baseProps()`; some are added
automatically by PostHog's SDKs; some are enriched server-side at PostHog
from the request IP. We list all three so the picture is complete.

**Identifiers** — anonymous, but stable across launches:

- `distinct_id` / `$device_id` — random UUID generated locally and stored
  at `~/.argus/telemetry-id`. Renderer events go out under the same id,
  because the renderer has no PostHog client of its own. Delete the file
  to rotate it. We never call
  `posthog.identify(...)` — there is no person profile, no email, and no
  account linked to it (`$is_identified: false`,
  `$process_person_profile: false`).

**Argus props (from our `baseProps()`):**

- Main: `app_version`, `is_packaged`, `platform`, `arch`, `os_release`,
  `electron_version`, `node_version`.
- Renderer: `app_version`, `platform`, `process: "renderer"`.

**PostHog SDK bookkeeping:**

- `$insert_id`, `$sent_at`, `$time`, `$lib`, `$lib_version`.

There is no browser SDK, so none of the `posthog-js` auto-properties —
browser, user agent, screen size, referrer, session id — exist on any
desktop event.

**GeoIP:**

Disabled. Desktop sets `disableGeoip: true` on the PostHog client, so no
`$geoip_*` properties are derived and the request IP is neither enriched
nor stored.

**What is _not_ sent, even when telemetry is on:**

- Session replay / DOM recordings — disabled in code
  (`$has_recording: false`, `$recording_status: "disabled"` confirm this
  on every event).
- DOM autocapture — disabled in code, so we never send element selectors
  or click targets.
- Person profiles — we never call `posthog.identify(...)`, so PostHog
  doesn't link the distinct id to a person record
  (`$process_person_profile: false`).
- Prompts, file contents, agent output, file paths, project names, repo
  names, branch names — anything from your work. The
  [event catalogue below](#lifecycle) lists exactly which props each
  event carries; nothing else is sent.
- File-system paths inside error messages and stack traces — these are
  scrubbed of `/Users/<name>`, `/home/<name>`, and `C:\Users\<name>`
  before sending.

**When telemetry is hard-disabled, regardless of the mode:**

- Builds with no PostHog key configured. On iOS and the Mac app that is every
  checkout without a local `Config/Argus.local.xcconfig` (or `POSTHOG_KEY` in
  the environment `xcodebuild` runs in), which is the default.

## Presence

Sent in every mode. This is the single source of
DAU truth — PostHog defines a Daily Active User as a `distinct_id` with
at least one `$pageview` event in the day, so the heartbeat **has to be
a `$pageview`** (not a custom event) for presence-only users to count.

| Event       | Source | When                                                                 | Extra props                                                                         |
| ----------- | ------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `$pageview` | main   | Once per process lifetime, as soon as the PostHog client initialises | `$current_url: "argus:///"`, `$pathname: "/"`, `app_version`, `source: "heartbeat"` |

The heartbeat deliberately **bypasses `baseProps()`** — no platform,
arch, OS release, Electron or Node version is attached. The only
property beyond the `$pageview` magic keys is `app_version`, kept so we
can answer "are old builds still in the wild?" without learning
anything else about the device. The `source: "heartbeat"` property lets
analytics distinguish the main-process heartbeat from the
renderer-route `$pageview` events that `full` users also emit.

## Lifecycle

Sent only in `full` mode.

| Event                      | Source   | When                                                                                                                                                                                                                                            | Extra props                                                                                                                                                                                                                                |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app_launched`             | main     | Telemetry transitions presence → full (opt-in, or replayed at each launch)                                                                                                                                                                      | —                                                                                                                                                                                                                                          |
| `app_quit`                 | main     | App is quitting                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                          |
| `renderer_started`         | renderer | Each renderer (main window or popout) finishes booting                                                                                                                                                                                          | `popout: "main" \| string`                                                                                                                                                                                                                 |
| `prefs_imported`           | renderer | The Electron app's first launch with shared preferences copied the ones it kept to the host                                                                                                                                                     | `keys` — how many preferences and picks were copied                                                                                                                                                                                        |
| `$pageview`                | renderer | The renderer URL changes (initial mount + every navigation)                                                                                                                                                                                     | `$pathname`, `$current_url` — both sanitised, see ↓                                                                                                                                                                                        |
| `telemetry_enabled`        | main     | User opts up to full                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                          |
| `telemetry_disabled`       | main     | User drops back to presence (sent before the flip + flush)                                                                                                                                                                                      | —                                                                                                                                                                                                                                          |
| `host_lock_handover`       | main     | Another host held this Argus home and the user had Argus quit it to start                                                                                                                                                                       | `holder: "cli" \| "electron" \| "mac" \| "mac-server"`                                                                                                                                                                                     |
| `electron_desktop_cutover` | main     | The Electron desktop app found Argus for Mac published as its update, once per launch: it follows that feed, or is held back because paired devices or MCP sign-ins are still in its old keychain format                                        | `stage: "offered" \| "held_back"`                                                                                                                                                                                                          |
| `electron_server_handoff`  | main     | The old (Electron) Argus Server moved toward the native Argus Server from its menu bar: a native build was first offered, an install started, it failed (the old app stays as it was), or it was held back because agents were running          | `stage: "offered" \| "installing" \| "failed" \| "blocked_by_agents"` — `offered` and `blocked_by_agents` fire once per native version per launch                                                                                          |
| `secret_store_migrated`    | main     | The Electron app tried to move an encrypted store (paired devices or MCP sign-ins) off its old keychain format at launch; sent once the user's consent is known, and only when something happened — never for a store with nothing left to move | `store: "remote_devices" \| "mcp_tokens"`, `outcome: "migrated" \| "failed"` — moved now, or left exactly as it was (still read with the old format and retried next launch, so a `failed` store reports again each launch until it moves) |

### `$pageview` sanitisation

PostHog magic event used by Web Analytics, DAU, paths and funnels. Argus
sends the **route template**, never the raw URL — every dynamic segment
that could carry a project / session / organisation / PR / device
identifier is replaced with its placeholder name before the event leaves
the renderer:

| Real path                                | Sent as                               |
| ---------------------------------------- | ------------------------------------- |
| `/sessions/abc-123/editor`               | `/sessions/:sessionId/editor`         |
| `/pull-requests/foo/bar/42`              | `/pull-requests/:owner/:repo/:number` |
| `/agents`, `/devices`, `/runtimes`, etc. | unchanged (no dynamic segments)       |

Both `$pathname` and `$current_url` carry the template. `$current_url` is
prefixed with `argus://` so PostHog recognises it as a URL but the host
is a fixed literal, not the user's machine or any external origin.

## Appearance

| Event                 | Source | When                                                                       | Extra props                                                                      |
| --------------------- | ------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `color_theme_changed` | main   | A desktop app (Electron or Argus for Mac) switches to another colour theme | `theme: "amber" \| "ember" \| "grove" \| "iris" \| "muted" \| "ocean" \| "rose"` |

## Sessions

| Event                       | Source | When                                                                                                                                                                       | Extra props                                                                                                         |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `session_created`           | main   | A new session is created                                                                                                                                                   | `has_explicit_branch`, `has_description`, `use_existing_branch`, `has_explicit_base_branch`                         |
| `session_adopted`           | main   | A worktree made outside Argus shows up in a project's session list for the first time                                                                                      | `setup_pending` (the project has setup it never ran)                                                                |
| `session_prompt_dispatched` | main   | The host starts the agent for a session created with a prompt (e.g. a plan handed off from the phone)                                                                      | `success`                                                                                                           |
| `session_deleted`           | main   | A session is deleted                                                                                                                                                       | `kind` (`worktree` \| `project_root` \| `scratch_pad`), `delete_branch`                                             |
| `session_setup_recovered`   | main   | A session whose setup failed, or a worktree made outside Argus whose setup never ran, is set up (fires when setup finishes) or marked ready, from the desktop or the phone | `action` (`retry` \| `mark_ready`), `pending` (a worktree made outside Argus rather than a failed setup), `success` |
| `scratch_pad_created`       | main   | A scratch pad is created                                                                                                                                                   | `has_name` — whether a name was given rather than the default                                                       |
| `worktrees_moved`           | main   | A project's worktrees were moved to a new location                                                                                                                         | `moved`, `failed` (counts), `copied` (crossed drives), `duration_bucket`, `purpose`                                 |

## Merges

`session_merge_*` covers the merge flow. `phase` distinguishes the
initial attempt from a `continue` after the user resolved conflicts.

| Event                    | Source | When                             | Extra props                                                      |
| ------------------------ | ------ | -------------------------------- | ---------------------------------------------------------------- |
| `session_merged`         | main   | Merge completed cleanly          | `phase: "attempt" \| "continue"`, `strategy: "keep" \| "squash"` |
| `session_merge_conflict` | main   | Merge stopped on conflicts       | `phase`, `conflicting_files` (count, not paths)                  |
| `session_merge_aborted`  | main   | An in-progress merge was aborted | `kind: "rebase" \| "merge"`                                      |

## Agents

| Event                       | Source   | When                                                                                                                                   | Extra props                                                                                                                                                                                                                                                       |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_started`             | main     | A new agent is started                                                                                                                 | `has_model`, `has_resume_id`, `has_parent`, `permission_mode`, `session_kind`, `warm` — it took the session's warm agent instead of spawning one, `conductor_guide` — its prompt, and its subagents', carry the conductor guide                                   |
| `spare_discarded`           | main     | A warm agent was stopped before anyone started it                                                                                      | `reason` (`idle` nobody looked at its session for five minutes, `evicted` another session needed the slot, `runner`, `account`, `config` what it was spawned with changed, `session` its session went away or isn't ready, `exited` its process ended on its own) |
| `spare_failed`              | main     | A warm agent failed to start                                                                                                           | —                                                                                                                                                                                                                                                                 |
| `agent_restored`            | main     | Conversation restored at a prior turn                                                                                                  | `keep_turn_number`, `is_fresh_start`                                                                                                                                                                                                                              |
| `agent_exited`              | main     | The agent process exited                                                                                                               | `exit_code`, `success`, `turns_completed`, `tool_uses`, `duration_ms`                                                                                                                                                                                             |
| `agent_stopped`             | main     | The agent was stopped                                                                                                                  | —                                                                                                                                                                                                                                                                 |
| `agent_nudged`              | main     | An agent sent a `push_notification`                                                                                                    | `critical` (urgency), `tagged` (tied to a session)                                                                                                                                                                                                                |
| `agent_interrupted`         | main     | The agent was interrupted                                                                                                              | —                                                                                                                                                                                                                                                                 |
| `agent_pinned`              | main     | A chat was pinned (the host resumes it on its next start) or unpinned, from any client                                                 | `action` (`pin`, `unpin`), `target` (`agent` — a live agent, `saved_chat` — a saved chat whose agent is gone), `via` (`ipc` — the desktop, `remote` — a gateway client: phone, Mac app, web)                                                                      |
| `agents_auto_resumed`       | main     | The host started and brought its pinned chats back (only sent when something was pinned)                                               | `pinned_count`, `resumed_count`, `missing_count` — unpinned because their session or worktree was gone, `failed_count` — the spawn failed and the pin was kept                                                                                                    |
| `queued_message_sent_now`   | main     | A queued message was sent ahead of the rest, from any client                                                                           | `mid_turn` — the agent was busy, so the message joined its running turn                                                                                                                                                                                           |
| `agent_limit_auto_continue` | main     | An agent stalled on a usage limit got a continue scheduled, sent, cancelled by a send, dismissed, or given up on                       | `action` (`scheduled`, `sent`, `cancelled`, `dismissed`, `gave_up`), `has_reset_time`                                                                                                                                                                             |
| `agent_account_switched`    | main     | The chat's account picker or the usage-limit card moved an agent onto another Claude account                                           | `had_history` — it resumed an existing conversation, `queued` — it was busy and moved when its turn ended, `after_limit` — the old account had hit its usage limit, `source` (`picker`, `limit_card`), `success`                                                  |
| `limit_handoff_offered`     | main     | A turn ended on a spent usage limit and the chat offered other signed-in Claude accounts to continue on (once per stall)               | `eligible_count_bucket` (`1`, `2`, `3+`)                                                                                                                                                                                                                          |
| `agent_start_submitted`     | renderer | A prompt was sent from the desktop's start composer                                                                                    | `workspace` (`current`, `worktree`), `changed_workspace` — picked something other than what the composer opened with                                                                                                                                              |
| `cli_chats_imported`        | main     | Chats run with the plain Claude Code CLI were added to project history (only sent when something was imported, or for a manual import) | `trigger` (`boot`, `interval`, `project_added`, `manual`), `imported_bucket` (`0`, `1-5`, `6-20`, `21-100`, `100+`), `skipped_bucket` (automated one-shot CLI calls passed over, same buckets), `project_count`                                                   |
| `cli_projects_scanned`      | main     | The import dialog or first-run onboarding looked for projects in the Claude Code CLI's chat history                                    | `source` (`dialog`, `onboarding`), `candidate_bucket` (`0`, `1-5`, `6-20`, `21-100`, `100+`), `truncated` — only the newest transcripts were read                                                                                                                 |
| `cli_projects_imported`     | main     | Projects picked from that list were added                                                                                              | `source` (`dialog`, `onboarding`), `count`                                                                                                                                                                                                                        |
| `agent_transcript_paged`    | renderer | The desktop loaded an older page of a chat as the reader scrolled up                                                                   | `success` — whether the page arrived and lined up with what was shown                                                                                                                                                                                             |
| `agent_transcript_resynced` | renderer | A desktop window had to reload a chat's newest page because a live update didn't follow the one before (lost, or the host restarted)   | `new_epoch` — the host started the conversation over (restart, fork seed) rather than an update going missing                                                                                                                                                     |
| `follow_ups_suggested`      | main     | A small model was asked for suggested replies after a turn ended                                                                       | `count` (suggestions returned, 0–3), `success` — whether the call answered at all                                                                                                                                                                                 |
| `follow_up_used`            | renderer | A suggested reply was put in the desktop chat input                                                                                    | `method` (`click`, `tab`)                                                                                                                                                                                                                                         |

## Automations

| Event                                   | Source | When                                                     | Extra props                                                   |
| --------------------------------------- | ------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| `automation_extra_instructions_changed` | main   | An automation's extra instructions were added or cleared | `has_instructions`                                            |
| `automation_github_read`                | main   | An automation run read GitHub through an Argus tool      | `tool: "get" \| "artifact_search"`, `success`                 |
| `proposal_start_failed`                 | main   | Starting a proposal failed before its agent ran          | `stage` (`creating_worktree`, `setting_up`, `starting_agent`) |

## Simulators

| Event                           | Source | When                                                                               | Extra props                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulator_boot_failed`         | main   | Booting an iOS simulator failed                                                    | `reason` (`missing_data`, `runtime_missing`, `not_found`, `disk_full`, `timeout`, `unknown`)                                                                                                                                                                                                                                      |
| `simulator_repaired`            | main   | A simulator was erased or deleted from Argus (fires after)                         | `action` (`erase` \| `delete`), `success`                                                                                                                                                                                                                                                                                         |
| `simulator_inspection_launched` | main   | An app was (re)launched with the inspection library injected, or refused           | `platform` (`ios` \| `tvos`), `outcome` (`ok`, `unavailable`, `failed`)                                                                                                                                                                                                                                                           |
| `simulator_remote_stream_ended` | main   | The last remote viewer (phone, remote Mac, web) stopped watching a device's screen | `platform` (`ios` \| `android`), `adaptive` — whether the stream adapted its bitrate to the connection, `duration_bucket` (`<10s`, `<1m`, `<10m`, `>=10m`), `downshifts_bucket` — how often it stepped down in resolution (`0`, `1-2`, `3-10`, `10+`), `lowest_level` (`full`, `high`, `medium`, `low`; `full` when not adaptive) |

## Device hosts

| Event                        | Source   | When                                                                                           | Extra props                                                                                                                                                                                               |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device_host_added`          | main     | A device host (another Mac reached over SSH) was saved                                         | `has_identity_file`, `has_port`                                                                                                                                                                           |
| `device_host_removed`        | main     | A device host was removed                                                                      | —                                                                                                                                                                                                         |
| `device_host_tested`         | main     | "Test connection" finished for a device host                                                   | `success`, `failure` (`none`, `auth`, `host_key`, `unreachable`, `timeout`, `not_macos`, `unsupported_arch`, `no_xcode`, `invalid_config`, `unknown`)                                                     |
| `remote_device_watched`      | main     | Streaming started (or failed to start) for a simulator on a device host, from any client       | `success`                                                                                                                                                                                                 |
| `eas_device_host_added`      | main     | An EAS Simulator host was saved                                                                | `has_token`, `has_app_id`                                                                                                                                                                                 |
| `eas_device_host_removed`    | main     | An EAS Simulator host was removed (its sessions are stopped first)                             | `running_sessions` — count when removed, `left_outstanding` — a stop failed and is left to the next sweep                                                                                                 |
| `eas_account_checked`        | main     | "Check account" finished for an EAS Simulator host                                             | `success`, `credential_source` (`settings`, `env`, `eas-login`, `none`), `failure` (`none` or a start-failure reason)                                                                                     |
| `eas_session_started`        | main     | An EAS Simulator session became ready to stream                                                | `wait_bucket` (`<1m`, `<3m`, `<10m`, `>=10m`) — time from asking to ready                                                                                                                                 |
| `eas_session_start_failed`   | main     | Starting an EAS Simulator session failed or was refused                                        | `reason` (`api`, `auth_rejected`, `cancelled`, `invalid_credential`, `ledger`, `limit`, `network`, `no_app`, `no_credential`, `not_enabled`, `session_ended`, `stream`, `timeout`)                        |
| `eas_session_start_prompted` | renderer | The desktop asked before booting a stopped EAS Simulator device, which starts a billed session | `outcome` (`confirmed`, `cancelled`)                                                                                                                                                                      |
| `eas_session_ended`          | main     | Argus saw an EAS Simulator session end                                                         | `reason` (`closed`, `expired` — Expo ended it at its limit, `host_removed`, `shutdown`, `leftover` — stopped after an earlier Argus died), `duration_bucket` (`<10m`, `<30m`, `<60m`, `>=60m`, `unknown`) |

## Browser

| Event                        | Source | When                                                            | Extra props                                         |
| ---------------------------- | ------ | --------------------------------------------------------------- | --------------------------------------------------- |
| `browser_devtools_requested` | main   | A client on this machine asked for a session browser's DevTools | `available` — whether that session had a browser up |

## Claude accounts

| Event                      | Source   | When                                                                                           | Extra props                                                                                                           |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `claude_account_rechecked` | main     | An account badged Limit reached or Signed out re-probed                                        | `outcome: "ok" \| "rate_limited" \| "reauth" \| "unknown"`, `badge_cleared`                                           |
| `usage_limits_fetched`     | main     | The host asked the Claude CLI for an account's plan limits (at most once a minute per account) | `outcome: "ok" \| "failed" \| "unsupported"`, `window_count`                                                          |
| `usage_summary_loaded`     | main     | The Usage screen loaded token and cost totals for a range                                      | `range: "24h" \| "7d" \| "30d" \| "90d"`, `prices_available` — false until the model price list has been fetched once |
| `home_usage_opened`        | renderer | The plan-limits strip on the Home screen was clicked to open the Usage screen                  | `level: "normal" \| "warning" \| "critical"` — the most severe limit shown                                            |

## Integrations

Linear and Figma connections. No account names, emails, workspaces or keys.

| Event                        | Source   | When                                                                                      | Extra props                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration_connected`      | main     | A Linear or Figma connection attempt finished                                             | `service: "linear" \| "figma"`, `method: "key" \| "oauth"`, `success`                                                                                                                                                                                                                                                                          |
| `integration_reauth_needed`  | main     | The service rejected a saved credential and it needs reconnecting                         | `service: "linear" \| "figma"`                                                                                                                                                                                                                                                                                                                 |
| `session_started_from_issue` | main     | A session was created from a tracker issue (one per issue when several start at once)     | `source: "linear"`                                                                                                                                                                                                                                                                                                                             |
| `issue_report_posted`        | main     | Argus commented on a session's Linear issue after a pull request or merge                 | `trigger: "pr" \| "merge"`, `has_screenshots`                                                                                                                                                                                                                                                                                                  |
| `issue_filed_from_device`    | main     | A Linear issue was filed from the runtime panel                                           | `has_screenshot`                                                                                                                                                                                                                                                                                                                               |
| `issue_filter_changed`       | renderer | A filter on the Issues board was added, flipped between is and is not, removed or cleared | `action: "add" \| "flip" \| "remove" \| "clear"`, `field` — the filter field (`priority`, `cycle`, …; `all` on clear)                                                                                                                                                                                                                          |
| `issue_searched`             | renderer | A search on the Issues screen returned (once per settled search, not per keystroke)       | `results_bucket: "0" \| "1-5" \| "6-20" \| "21+"` — how many issues it found                                                                                                                                                                                                                                                                   |
| `linear_issue_updated`       | main     | An issue's status or priority was changed, or a comment posted, from Argus                | `field: "status" \| "priority" \| "comment"`                                                                                                                                                                                                                                                                                                   |
| `design_ref_added`           | renderer | A Figma frame was attached in the start composer                                          | `from: "issue" \| "paste"` — linked from an attached Linear issue, or pasted                                                                                                                                                                                                                                                                   |
| `design_compare_opened`      | renderer | The runtime panel switched to Design mode                                                 | —                                                                                                                                                                                                                                                                                                                                              |
| `design_viewer_opened`       | renderer | A Figma frame was opened in the design viewer                                             | `source: "issue" \| "session" \| "composer" \| "runtime"` — an issue's link, a session's design chip, a start-composer chip, or the runtime Design mode                                                                                                                                                                                        |
| `design_compared`            | main     | A Figma frame was diffed against a device screenshot                                      | `source: "agent" \| "app"` — an agent's `design_compare` tool or the Design view; `diff_bucket: "<2%" \| "<10%" \| "<30%" \| ">=30%"` — share of differing pixels; `mode: "screen" \| "component"` — a whole screen diffed from the top, or a component located on the screen first; `matched` — false when a component wasn't found on screen |

## Accounts

Linking computers to an Argus account. These carry enums, booleans and
outcomes only — never the account, member or request ids, names, emails,
link codes, keys or addresses.

| Event                      | Source | When                                                                                                                                                                          | Extra props                                                                                                                                                                                                                                                              |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account_link_started`     | main   | A computer started linking itself to an account with a code                                                                                                                   | `surface: "electron" \| "mac" \| "cli" \| "menubar" \| "server_tray" \| "paired"` — where it was started (`server_tray`: Argus Server's menu bar item; `paired`: a QR-paired phone asked for it)                                                                         |
| `account_linked`           | main   | The computer verified the account's log and pinned it                                                                                                                         | `via: "browser" \| "app" \| "host" \| "local" \| "paired"` — who approved it (`local`: the Mac app linked its own host), `first_member` — it became the account's first member, `kind: "host" \| "computer"` — `computer` when an Electron window joined as a device too |
| `account_link_failed`      | main   | A link stopped short                                                                                                                                                          | `stage: "start" \| "claim_timeout" \| "denied" \| "sas_rejected" \| "verify" \| "network"`                                                                                                                                                                               |
| `account_join_resolved`    | main   | This computer's console approved or declined another computer's link or a device's join                                                                                       | `action: "approved" \| "denied"`, `approver: "host"`, `subject: "device" \| "host"`, `surface: "app" \| "terminal" \| "server_tray"` — the app's account settings, `argus-host`'s console, or Argus Server's menu bar                                                    |
| `account_member_renamed`   | main   | The computer's console renamed a device or computer on the account                                                                                                            | `role: "device" \| "host"`                                                                                                                                                                                                                                               |
| `device_name_changed`      | main   | This computer's name setting changed (desktop Settings → Account, renaming this computer in the account list, `account set name` in `argus-host`, or Argus Server's menu bar) | `source: "settings" \| "account_list" \| "terminal" \| "server_tray"`, `linked` — whether it was put on the account too                                                                                                                                                  |
| `account_member_revoked`   | main   | The computer applied a revocation                                                                                                                                             | `role: "device" \| "host"`, `source: "local" \| "log" \| "sync"` — removed here, read from the account log, or handed over by a connected device                                                                                                                         |
| `account_push_sent`        | main   | The computer pushed a notification to an account device through the account                                                                                                   | `outcome: "delivered" \| "failed" \| "refused" \| "unregistered"` — sent, a transient failure, the service refused it (the device or this computer is off the account), or the device has no registration left                                                           |
| `account_tunnel_switched`  | main   | The managed tunnel was switched on or off from `argus-host`'s console (`account set tunnel`) or Argus Server's menu bar                                                       | `on`, `surface: "terminal" \| "server_tray"`                                                                                                                                                                                                                             |
| `account_log_rejected`     | main   | The computer refused entries the account service served                                                                                                                       | `reason: "fork" \| "bad_signature" \| "unknown_signer" \| "malformed" \| "sas_mismatch"`                                                                                                                                                                                 |
| `remote_connection_opened` | main   | A device completed the gateway handshake (at most once per device per day)                                                                                                    | `trust: "paired" \| "account"` — a QR pairing or the account let it in; `hosted_web: boolean` — an account browser on houwert.dev/argus/app                                                                                                                              |

### Managed tunnels

A linked computer's own tunnel, and the tunnels from earlier versions it
replaces. No hostnames, addresses, tunnel ids or tokens.

| Event                    | Source | When                                                                                   | Extra props                                                                                                                                                                                                                      |
| ------------------------ | ------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `managed_tunnel_started` | main   | The managed tunnel's connector registered with Cloudflare (once per credentials fetch) | `created` — the service made the tunnel for this request, `install: "downloaded" \| "managed" \| "override" \| "path"` — how `cloudflared` was found: just downloaded, already installed, `ARGUS_CLOUDFLARED_PATH`, or on `PATH` |
| `managed_tunnel_failed`  | main   | The managed tunnel couldn't come up (at most once per stage per launch)                | `stage: "unavailable" \| "credentials" \| "install" \| "connect"` — the service has no tunnels, couldn't get credentials, couldn't install `cloudflared`, or the connector keeps failing                                         |
| `legacy_tunnel_retired`  | main   | A tunnel set up in an earlier version was stopped and its settings forgotten           | `kind: "cloudflare_quick" \| "cloudflare_token" \| "tailscale_funnel"`, `reason: "managed" \| "user"` — the managed tunnel replaced it, or the user stopped it                                                                   |

## Language servers

The host runs language servers for the code editor. These events carry the
language family and outcomes only — never paths, file contents, symbol names
or server messages. `language` is one of `typescript`, `json`, `css`, `html`,
`yaml`, `swift`, `c` (C, C++ and Objective-C), `kotlin`, `python`, `go`,
`rust` or `ruby`.

| Event                | Source | When                                                                                                  | Extra props                                                                                                                                                                                                                                                                                  |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lsp_server_started` | main   | A language server was started for a session, or couldn't be                                           | `language`, `source` (`bundled`, `toolchain`, `path`, or `none` when no server is installed), `success` — whether it finished its handshake, `duration_bucket` (`<1s`, `<5s`, `<30s`, `>=30s`), `project` — Swift only: `swiftpm`, `xcode` (through a build server) or `files` (a lone file) |
| `lsp_server_crashed` | main   | A language server exited on its own                                                                   | `language`, `gave_up` — it crashed more than three times in five minutes and won't restart until the user retries                                                                                                                                                                            |
| `lsp_setup_needed`   | main   | Argus held back a language server because its answers would be wrong until the user sets something up | `language`, `reason` (`no_build_server` — an Xcode project without xcode-build-server, `not_built` — not built yet in this session, `loose_files` — Swift files outside any package or project)                                                                                              |
| `lsp_feature_used`   | main   | The editor asked a language server something (completion is left out: it fires per keystroke)         | `feature` (`hover`, `definition`, `references`, `rename`, `format`, `code_action`, `signature_help`, `workspace_symbols`, `document_symbols`), `language`, `success`                                                                                                                         |

## Onboarding

| Event                  | Source | When                             | Extra props |
| ---------------------- | ------ | -------------------------------- | ----------- |
| `onboarding_completed` | main   | First-launch onboarding finished | —           |

## Feedback

| Event           | Source   | When                                                  | Extra props                                         |
| --------------- | -------- | ----------------------------------------------------- | --------------------------------------------------- |
| `user_feedback` | renderer | Feedback message delivered (carries the message body) | `message`, `$set_once.has_submitted_feedback: true` |

## Errors

Two channels:

- **`$exception`** — fires on truly unhandled crashes (process gone,
  uncaught exception or rejection). Includes the error name, scrubbed
  error message, scrubbed stack trace, and a `source` indicating which
  channel triggered it. Crash-process events additionally include the
  exit reason and exit code.
- **`app_error`** — caught-and-logged errors. Props: `scope` (e.g.
  `agent`, `session:merge`) and a scrubbed, truncated `message`.

Error messages and stack traces are scrubbed of user home directory
paths before sending.

## iOS client

`clients/apple` talks to PostHog directly with the `posthog-ios`
SDK, rather than relaying through a paired computer — the interesting
crashes are exactly the ones that happen unpaired or offline. Same two
modes, same consent wording, asked once on first launch and changeable
under Settings → Privacy.

The phone has its **own install id**, so one person using both clients
counts as two users in PostHog. That is accepted: the alternative means
shipping an identifier between the two, which is more identifying than
the number it would fix.

Every event here is something the computer cannot already see. When the
phone sends a message, creates a session or merges one, the **host**
captures `agent_started` / `session_created` / `session_merged` itself —
so those names are deliberately absent below, and the desktop funnels
stay honest.

| Event                                      | When                                                                                                                                                              | Extra props                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$pageview`                                | Once per launch, in every mode                                                                                                                                    | `$current_url: "argus-ios:///"`, `$pathname: "/"`, `app_version`, `source: "heartbeat"`                                                                     |
| `$screen`                                  | A screen is pushed, or a tab or iPad sidebar section opened at its root (`/more` for More)                                                                        | `$screen_name` — the route pattern only, as the Mac app's (`/sessions/:sessionId/agents`); never a project, branch or id                                    |
| `ios_launched`                             | Telemetry is in full mode at launch, or opts up                                                                                                                   | —                                                                                                                                                           |
| `ios_paired`                               | A computer was paired                                                                                                                                             | `endpoint_kind`, `has_control`                                                                                                                              |
| `ios_pair_failed`                          | Pairing failed                                                                                                                                                    | `reason` (the failure case name, no detail)                                                                                                                 |
| `ios_host_switched`                        | A different paired computer was selected                                                                                                                          | `host_count`                                                                                                                                                |
| `ios_route_upgraded`                       | A live connection moved to a faster route after a network change or a periodic check                                                                              | `from`, `to` (`lan`, `tailscale`, `cloudflare`)                                                                                                             |
| `ios_link_opened`                          | An `argus://` link or a desktop Handoff opened a screen                                                                                                           | `screen` (route pattern), `via` (`link`, `handoff`), `fallback` — the phone lacks that screen and opened its parent                                         |
| `ios_message_sent`                         | A message reached the computer, or its queue                                                                                                                      | `queued`, `has_images`, `length_bucket`                                                                                                                     |
| `ios_message_send_failed`                  | A message never left the phone                                                                                                                                    | `retried`                                                                                                                                                   |
| `ios_permission_answered`                  | A permission prompt was answered                                                                                                                                  | `approved`, `always_allow`, `from_notification`                                                                                                             |
| `ios_agent_controlled`                     | An agent was steered from the phone                                                                                                                               | `action` (`interrupt`, `stop`, `model`, `effort`, `permission_mode`)                                                                                        |
| `ios_work_landed`                          | Work was committed, pushed or merged                                                                                                                              | `action`, `success`, `strategy` (`keep`, `squash`, or `none` outside a merge)                                                                               |
| `ios_commit_composed`                      | A commit from the phone's composer went through                                                                                                                   | `has_description`, `sign_off`, `signed`                                                                                                                     |
| `ios_device_watched`                       | A mirrored device screen was closed                                                                                                                               | `duration_ms`, `interacted`                                                                                                                                 |
| `ios_image_viewer_used`                    | The image on screen in the viewer was copied, or its share sheet (which also saves to Photos) was opened                                                          | `action` (`copy`, `share`)                                                                                                                                  |
| `ios_claude_account_changed`               | A Claude account was picked, added, signed in again, removed, renamed or pinned to a session                                                                      | `action` (`select`, `add`, `reauth`, `remove`, `rename`, `pin`)                                                                                             |
| `ios_memory_edited`                        | An automation's memory was saved or deleted                                                                                                                       | `action` (`save`, `delete`)                                                                                                                                 |
| `ios_proposal_opened`                      | The inbox opened the run behind a proposal                                                                                                                        | —                                                                                                                                                           |
| `ios_follow_up_used`                       | A suggested reply was tapped into the message field                                                                                                               | —                                                                                                                                                           |
| `ios_input_used`                           | A message-field feature was used (a follow-up sends `ios_follow_up_used` instead)                                                                                 | `affordance` (`slash_command`, `mention`, `image_paste`, `image_attach`)                                                                                    |
| `ios_setting_changed`                      | A phone-local setting was toggled                                                                                                                                 | `setting` (`auto_expand_image_reads`), `enabled`                                                                                                            |
| `ios_color_theme_changed`                  | The phone switched to another colour theme                                                                                                                        | `theme` (`muted`, `amber`, `grove`, `ocean`, `ember`, `iris`, `rose`)                                                                                       |
| `ios_appearance_changed`                   | The phone switched between following the system, light and dark                                                                                                   | `appearance` (`system`, `light`, `dark`)                                                                                                                    |
| `ios_default_changed`                      | A default new work starts from was changed                                                                                                                        | `setting` (`permission_mode`, `autonomy`), `value`                                                                                                          |
| `ios_agent_start_submitted`                | The start composer started an agent                                                                                                                               | `workspace` (`current`, `worktree`, `existing`), `changed_workspace` / `changed_project` — not the one it opened on, `has_images`, `effort_set`             |
| `ios_warnings_opened`                      | The Notifications list (warnings and errors) was opened                                                                                                           | `count`                                                                                                                                                     |
| `ios_notifications_cleared`                | One notification was swiped away, or the whole Notifications list cleared                                                                                         | `scope` (`one`, `all`)                                                                                                                                      |
| `ios_mcp_servers_opened`                   | An agent's MCP servers list was opened from its session's details                                                                                                 | —                                                                                                                                                           |
| `ios_session_used`                         | A session screen's details sheet was opened, another agent's tab picked, or a stopped agent's tab closed                                                          | `action` (`open_details`, `switch_agent`, `close_agent_tab`)                                                                                                |
| `ios_session_panel_used`                   | The iPad session side panel was opened, closed, or switched to another tab                                                                                        | `action` (`open`, `close`, `switch_tab`), `tab` (`details`, `changes`, `files`, `terminals`, `device`; the one in front after)                              |
| `ios_home_used`                            | A section link on Home was followed: View usage, See all agents, View all runs, or the needs-you "more in the inbox"                                              | `action` (`usage`, `agents`, `automations`, `inbox`)                                                                                                        |
| `ios_transcript_work_log_opened`           | A turn's folded work ("Worked for 5m 29s") was opened in a chat                                                                                                   | `working` (the agent was still on that turn)                                                                                                                |
| `ios_message_action`                       | A message's long-press menu was used                                                                                                                              | `action` (`copy`, `edit`, `fork_session`, `fork_agent`), `role` (`user`, `assistant`), `success` (the computer took the edit or fork; always true for copy) |
| `ios_chat_history_used`                    | A session's saved chats were searched (first keystroke) or one was deleted                                                                                        | `action` (`search`, `delete`)                                                                                                                               |
| `ios_file_viewed`                          | A session file opened in the read-only viewer                                                                                                                     | `source` (`chat_link`, `changes`, `quick_open`, `search`, `link`), `language` (a bundled grammar or `other`)                                                |
| `ios_design_opened`                        | A Figma frame opened in the design viewer                                                                                                                         | `source` (`issue` — a Figma link in an issue, `session` — one of a session's design frames)                                                                 |
| `ios_design_layer_selected`                | The first layer picked in a design viewer frame                                                                                                                   | `source` (`canvas` — tapped on the render, `tree` — picked in the layer list)                                                                               |
| `ios_file_search_run`                      | A worktree search finished                                                                                                                                        | `regex`, `result_bucket` (`0`, `1-10`, `11-100`, `101-1000`, `1000+`), `truncated`                                                                          |
| `ios_issue_searched`                       | A workspace issue search settled on the Issues screen, once per term (never the term)                                                                             | `result_bucket` (`0`, `1-10`, `11-100`, `101-1000`, `1000+`)                                                                                                |
| `ios_automation_edited`                    | An automation was created, saved, deleted, paused or resumed, or its playbook rewritten                                                                           | `action` (`create`, `save`, `delete`, `enable`, `disable`, `revise_playbook`)                                                                               |
| `ios_run_acted`                            | A run was started, cancelled, argued with, or kept as an automation                                                                                               | `action` (`start`, `start_scratch`, `cancel`, `feedback`, `save_scratch`)                                                                                   |
| `ios_proposal_handled`                     | An inbox proposal was answered                                                                                                                                    | `action` (`accept`, `dismiss`, `resolve`, `cleanup`)                                                                                                        |
| `ios_pull_request_acted`                   | A pull request was opened, merged or commented on, or Claude filled in a new one's description                                                                    | `action` (`open`, `merge`, `comment`, `fill`)                                                                                                               |
| `ios_branch_acted`                         | A branch was checked out, created or deleted                                                                                                                      | `action` (`checkout`, `create`, `delete`)                                                                                                                   |
| `ios_session_renamed`                      | A session's name, branch or base branch was changed                                                                                                               | `target` (`session`, `branch`, `base`)                                                                                                                      |
| `ios_app_error`                            | A failure the user was shown                                                                                                                                      | `scope`, scrubbed `message` (≤2000 chars)                                                                                                                   |
| `ios_host_feature_unsupported`             | The computer runs an older Argus without a method the phone used; once per method                                                                                 | `method` — the protocol method name (e.g. `usage.limits`)                                                                                                   |
| `ios_account_signed_in`                    | Signed in to an Argus account and the account is ready                                                                                                            | `provider` (`apple`, `github`, `email`), `first_device` — this phone set up the account                                                                     |
| `ios_account_signed_out`                   | Signed out of the Argus account                                                                                                                                   | —                                                                                                                                                           |
| `ios_computer_added`                       | The phone approved a computer joining the account (the computer counts completion itself)                                                                         | `via` (`code`, `existing_pairing`)                                                                                                                          |
| `ios_member_removed`                       | The phone removed a device or computer from the account                                                                                                           | `role` (`device`, `host`)                                                                                                                                   |
| `ios_member_renamed`                       | The phone renamed a device or computer on the account                                                                                                             | `role` (`device`, `host`)                                                                                                                                   |
| `ios_device_name_changed`                  | The phone's name setting changed, in Settings or by renaming this phone in the account list (a rename from another device that the setting follows sends nothing) | `source` (`settings`, `account_list`), `linked` — renamed on the account too                                                                                |
| `ios_join_acted`                           | The phone asked to join the account, or approved or denied a device joining it (the host counts nothing here)                                                     | `action` (`requested`, `approved`, `denied`, `expired`), `role` (`subject` — this phone joining, `approver`)                                                |
| `ios_account_push_registered`              | The phone registered its push token with the account so every computer on it can wake it (on sign-in, when computers join or leave, and when push is switched on) | `success`                                                                                                                                                   |
| `ios_account_woken`                        | A content-free wake-up from the account service was handled in the background                                                                                     | `reason` (`join` — someone asked to join, `changed` — someone was added or removed), `outcome` (`prompted`, `refreshed`, `removed`, `unreachable`)          |
| `web_eas_session_start_prompted`           | The billing confirm before starting an EAS Simulator session was answered                                                                                         | `outcome` (`confirmed`, `cancelled`); the computer captures the start itself                                                                                |
| `web_browser_viewed`                       | A session's browser screen opened, once: on the first frame or after 8s without one                                                                               | `streaming` — a frame arrived                                                                                                                               |
| `telemetry_enabled` / `telemetry_disabled` | The privacy toggle moved                                                                                                                                          | — (shared with desktop on purpose: same signal)                                                                                                             |

The phone also sends `describe` and `regenerate` (a shown draft drafted again) on `ios_automation_edited`, `delete` and
`mark_read` on `ios_run_acted`, and `request_revision` on
`ios_proposal_handled`, `amend` on `ios_work_landed`, and `stash_apply`,
`stash_pop` and `stash_drop` on `ios_branch_acted`. `ios_default_changed`'s `value` is the mode or rung
picked, or `computer` / `none` when cleared.

`baseProps` in full mode: `app_version`, `build_number`,
`platform: "ios"`, `os_version`, `device_model` (the hardware
identifier, e.g. `iPhone16,1` — never the name the user gave their
phone), `is_testflight`, `client: "ios"`. The heartbeat skips all of it
and carries `app_version` alone, exactly as on desktop.

**Crashes.** `posthog-ios` has no crash reporter wired up here, so
crashes come from **MetricKit**: `MXCrashDiagnostic` and
`MXHangDiagnostic` are forwarded as `$exception` with
`source: "metrickit"`, a scrubbed call-stack tree, and
`crashed_app_version`. MetricKit delivers on the **next** launch, so a
crash is always reported by the build after the one that crashed —
hence the separate version prop. ObjC exceptions are caught
synchronously via `NSSetUncaughtExceptionHandler`
(`source: "uncaughtException"`); Swift runtime traps and signals are
MetricKit's job. Nothing is delivered in the simulator.

All of it is gated on `full` mode. In `presence` the heartbeat is the
only thing that leaves the phone.

## Web client

The browser client (`clients/argus-web`: the bundle the computer serves on
its own address, and the hosted app at `/argus/app/`) talks to PostHog
directly over its capture API, like the iOS client, with **its own install
id**: a random UUID in the browser's `localStorage`. There is no SDK, so
nothing is autocaptured, recorded or profiled; every request is one the
client builds. Events carry `$process_person_profile: false` and
`$geoip_disable: true`. Same two modes and the same wording as iOS, asked
once (only in builds with a PostHog key) and changeable under Settings →
Privacy. Builds without a key send nothing at all.

The computer already captures `agent_started`, `session_created`,
`session_merged` and the rest when the browser asks for them, so those are
absent here on purpose.

| Event                                      | When                                                                                                                                          | Extra props                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `$pageview`                                | Once per page load, in every mode                                                                                                             | `$current_url: "argus-web:///"`, `$pathname: "/"`, `app_version`, `source: "heartbeat"`                                                        |
| `$screen`                                  | A screen comes up                                                                                                                             | `$screen_name` — the route pattern only (`/sessions/:sessionId/agents`, `/projects/:projectKey`), the phone's for the same screen; never an id |
| `web_launched`                             | Telemetry is in full mode at page load, or opts up                                                                                            | `build` (`network`, `hosted`), `paired` — the network bundle was already paired at load (always false in the hosted app)                       |
| `web_paired`                               | This browser paired with a computer                                                                                                           | `has_control`                                                                                                                                  |
| `web_pair_failed`                          | Pairing failed                                                                                                                                | `reason` (`invalid_code` — the pasted code didn't parse, `failed` — the handshake or confirmation failed)                                      |
| `web_link_opened`                          | The page opened on a screen other than Home from a link, or a notification opened an agent                                                    | `screen` (route pattern), `via` (`link`, `notification`), `fallback` — the client lacks that screen and opened its parent                      |
| `web_connection_lost`                      | A connection that was up dropped (closing a computer or signing out doesn't count)                                                            | `connected_bucket` — how long it had been up (`<10s`, `10s-1m`, `1m-10m`, `10m-1h`, `1h+`)                                                     |
| `web_reconnected`                          | The connection came back after a drop                                                                                                         | `offline_bucket` — how long it was down, same buckets                                                                                          |
| `web_host_switched`                        | The hosted app opened a computer from the account                                                                                             | `computer_count` — how many computers the account has                                                                                          |
| `web_file_viewed`                          | A session file opened in the read-only viewer                                                                                                 | `source` (`changes`, `quick_open`, `search`, `link` — a URL straight to it), `language` (a bundled grammar or `other`)                         |
| `web_quick_open_used`                      | Quick open was used: the palette (Cmd/Ctrl+P) closed, or the Files screen opened a file                                                       | `via` (`shortcut`, `screen`), `picked` — something was opened rather than the palette dismissed                                                |
| `web_file_search_run`                      | A worktree search finished on its own (never the query)                                                                                       | `regex`, `result_bucket` (`0`, `1-10`, `11-100`, `101-1000`, `1000+`), `truncated`                                                             |
| `web_terminal_viewed`                      | A terminal opened in the read-only viewer, once per terminal                                                                                  | `kind` (`run`, `setup`, `shell`), `live` — streaming, not polled from a computer too old to stream                                             |
| `web_agent_start_submitted`                | The start composer sent its agent off                                                                                                         | `workspace` (`current`, `worktree`, `existing`), `changed_workspace` — not the one it opened on, `has_images`, `effort_set`                    |
| `web_message_action`                       | A message's copy, edit or fork was used                                                                                                       | `action` (`copy`, `edit`, `fork_session`, `fork_agent`), `role` (`user`, `assistant`), `success` (the computer took it; always true for copy)  |
| `web_chat_history_used`                    | A session's saved chats were searched (first search) or one was deleted                                                                       | `action` (`search`, `delete`)                                                                                                                  |
| `web_transcript_work_log_opened`           | A turn's folded work ("Worked for 5m 29s") was opened                                                                                         | `working` (the agent was still on that turn)                                                                                                   |
| `web_mcp_servers_opened`                   | An agent's MCP servers list was opened                                                                                                        | —                                                                                                                                              |
| `web_proposal_handled`                     | An inbox proposal was answered                                                                                                                | `action` (`accept`, `dismiss`, `resolve`, `cleanup`, `request_revision`)                                                                       |
| `web_proposal_opened`                      | A proposal card opened the run that raised it                                                                                                 | —                                                                                                                                              |
| `web_run_acted`                            | A run was started, cancelled, argued with, deleted, marked read or kept as an automation                                                      | `action` (`start`, `start_scratch`, `cancel`, `feedback`, `delete`, `mark_read`, `save_scratch`)                                               |
| `web_automation_edited`                    | An automation was created, saved, deleted, paused or resumed, drafted or its playbook rewritten                                               | `action` (`create`, `save`, `delete`, `enable`, `disable`, `revise_playbook`, `describe`, `regenerate` — a shown draft drafted again)          |
| `web_memory_edited`                        | An automation's memory was saved or deleted                                                                                                   | `action` (`save`, `delete`)                                                                                                                    |
| `web_app_error`                            | A request failed and the failure went into the Warnings & errors list (a dropped connection on a background refresh doesn't count)            | `scope` (the method's area, e.g. `claude_accounts`), scrubbed `message` (≤2000 chars)                                                          |
| `web_host_feature_unsupported`             | The computer runs an older Argus without a method the browser used; once per method per visit                                                 | `method` — the protocol method name (e.g. `usage.limits`)                                                                                      |
| `web_notifications_opened`                 | The Warnings & errors list was opened                                                                                                         | `count`                                                                                                                                        |
| `web_notifications_cleared`                | One entry was dismissed, or the whole list cleared                                                                                            | `scope` (`one`, `all`)                                                                                                                         |
| `web_claude_account_changed`               | A Claude account was picked, added, signed in again, removed or renamed (pinning one to a session is the computer's `agent_account_switched`) | `action` (`select`, `add`, `reauth`, `remove`, `rename`)                                                                                       |
| `web_claude_sign_in_code_submitted`        | A sign-in code was pasted to finish a Claude sign-in                                                                                          | `success`                                                                                                                                      |
| `web_default_changed`                      | A default new work starts from was changed                                                                                                    | `setting` (`permission_mode`, `autonomy`), `value` (the mode or rung, or `none`)                                                               |
| `web_appearance_changed`                   | The colour scheme was changed                                                                                                                 | `appearance` (`system`, `light`, `dark`)                                                                                                       |
| `web_color_theme_changed`                  | The colour theme was changed                                                                                                                  | `theme` — the preset id (`muted`, `amber`, `grove`, `ocean`, `ember`, `iris`, `rose`)                                                          |
| `web_design_opened`                        | The design viewer opened on a Figma frame (comparing is the computer's `design_compared`)                                                     | `source` (`session` — a session's Figma chip, `issue` — a Figma link in an issue, `link` — the page loaded on `/design`)                       |
| `telemetry_enabled` / `telemetry_disabled` | The privacy toggle moved                                                                                                                      | — (shared with desktop and iOS on purpose: same signal)                                                                                        |

Uncaught errors and unhandled rejections are sent as `$exception` (full
mode only) with `$exception_type`, a scrubbed `$exception_message` and
`$exception_stack_trace_raw` (home directories, the page's origin and query
strings removed), and `source` (`window.onerror`, `unhandledrejection`).

`baseProps` in full mode: `app_version` (the Argus release the bundle
shipped with), `client: "web"`, `platform: "web"`, `build`. The heartbeat
skips all of it and carries `app_version` alone. No user agent, screen size,
referrer or URL is sent.

The hosted app's Content-Security-Policy has to allow the PostHog host
(`connect-src https://eu.i.posthog.com`, or whatever `VITE_POSTHOG_HOST`
names) for any of this to leave the page; until it does, the requests are
blocked and nothing is sent.

## Mac app (beta)

The native Mac app (`clients/apple/ArgusDesktop`) sends its events
**through its own host** with `telemetry_capture`, the way the Electron
renderer does — same install id, same PostHog key, same consent gate.
Its consent level is the host's, stored with the Electron app's in
`app-settings.json` (`telemetry_mode`), so both apps honour the same
choice; until the user opts up it is `presence`, so none of these
leave the machine.

Everything the host already sees (`agent_started`, `session_created`,
`session_merged`, …) is captured there and absent below.

| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mac_launched` | The app launched | — |
| `mac_quit` | The app is quitting | `had_running_agents` |
| `mac_host_started` | The bundled host came up | `restarts` (crash restarts so far this launch) |
| `mac_host_crashed` | The bundled host exited unexpectedly | `exit_code`, `attempt` |
| `mac_host_failed` | The host crashed too often in a row and the app gave up | `crashes` |
| `mac_host_lock_conflict` | Another app's host was already running on this Argus home | `holder` (`electron`, `mac`, `mac_server`, `cli`) |
| `mac_host_handover` | The user had the app quit the other host and take over | `holder`, `success` |
| `mac_host_connected` | The window connected to a host: the one it runs itself, or another app's it opened next to as a second window | `mode` (`own`, `attached`), `holder` (`electron`, `mac`, `mac_server`, `cli`; only when attached) |
| `mac_route_upgraded` | A connection to another host moved to a faster route after a network change or a periodic check | `from`, `to` (`lan`, `tailscale`, `cloudflare`) |
| `mac_host_feature_unsupported` | The host runs an older Argus (e.g. an attached Electron app) without a method the app used; once per method per launch | `method` — the protocol method or command name (e.g. `usage.limits`) |
| `mac_screen_viewed` | The window navigated | `screen` — the route pattern, never an id |
| `mac_link_opened` | A deep link or the launch route was opened; one naming a session waits for its machine to connect | `screen` (route pattern), `outcome` (`direct`, `waited` — its machine connected later, `abandoned` — its session never turned up) |
| `mac_chat_history_used` | In a session's Recent Chats dialog: the search was first used, or a saved chat was opened, resumed in a new agent, deleted, or all of them cleared | `action` (`search`, `view`, `resume`, `delete`, `clear`) |
| `mac_branch_renamed` | A session's branch was renamed from its context card | `success` |
| `mac_home_card_acted` | A home card was used: notifications enabled, their settings opened or the card dismissed, a project removed from the recents grid, or the old-format secrets card checked again | `card` (`notifications`, `recent_project`, `legacy_secrets`), `action` (`open`, `dismiss`, `fixed`, `failed`) |
| `mac_host_folder_picked` | A folder was browsed for on a paired host's disk (Add Project, a worktree location) | `stage` (`opened`, `picked`, `cancelled`) |
| `mac_tab_used` | A window tab was opened (the + button, ⌥⌘T, Open in New Tab on a session or machine), closed, or switched to | `action` (`open`, `close`, `switch`) |
| `mac_session_panel_switched` | A session's Agent, Code or Git view was picked from the context card's switcher, the View menu (⌘1–⌘3) or the command palette | `panel` (`agents`, `code`, `git`), `via` (`card`, `menu`, `shortcut`, `palette`) |
| `mac_agent_close_confirmed` | ⌘W asked before closing the agent tab in front, which stops the agent | `closed` (it went ahead), `running` (the agent was mid-turn) |
| `mac_menu_command_used` | A keyboard command for agents, panels, screens or git ran from its menu item or shortcut: New Agent (⇧⌘A, ⌘T), Interrupt Agent (⌘.), Focus Chat Input (⌘L), next/previous agent (⇧⌘] / ⇧⌘[), Agent 1–9 (⌃⌘1–9), Open Session (⇧⌘O), App Home (⇧⌘H), ⌥⌘1–5, and the Git menu: Fetch (⇧⌘F), Pull (⇧⌘P), Push (⇧⌘U), New/Rename Branch (⌘B), Merge (⇧⌘M), Rebase (⇧⌘R), Create Pull Request, Commit (⌘↩) and Stash (⇧⌘S) | `action` (`new_agent`, `next_agent`, `previous_agent`, `select_agent`, `interrupt_agent`, `focus_composer`, `quick_switcher`, `go_home`, `go_to_screen`, `git_fetch`, `git_pull`, `git_push`, `git_branch`, `git_merge`, `git_rebase`, `git_create_pull_request`, `git_commit`, `git_stash`), `via` (`menu`, `shortcut`) |
| `mac_menu_bar_used` | An item in the menu bar item's menu that does something was used. How a pairing it started went is `mac_pairing` | `action` (`open_app`, `open_agent`, `pair`, `link`, `approve_join`, `deny_join`, `open_settings`, `check_for_updates`, `restart_host`, `quit`) |
| `mac_menu_bar_toggled` | The menu bar item was shown or hidden | `shown`, `via` (`settings` the General tab's switch, `menu_bar` dragged off the menu bar with ⌘), `server_installed` — whether an Argus Server is installed on this Mac, which turns the item off by default |
| `mac_login_item` | **Open at Login** was switched in Settings → General or the menu bar item | `enabled`, `status` (`enabled`, `requires_approval`, `off`) — what macOS made of it |
| `mac_scratch_pad_created` | A scratch pad was created from the sidebar (the host captures the agent it starts) | — |
| `mac_start_workspace_picked` | A start composer's workspace was switched between the current checkout and a new worktree (the host captures the session and agent a send creates) | `workspace` (`current`, `worktree`) |
| `mac_start_branch_switched` | The current checkout was switched to another local branch from a start composer's branch menu (the checkout's outcome is its `mac_git_used` `checkout`) | — |
| `mac_prefs_supplied` | On connecting to its host, the app handed it preferences or picks the host had no value for yet (the host already held the rest, which the app took) | `keys` — how many |
| `mac_transcript_link_opened` | A file or URL link in a transcript was used | `action` (`open`, `open_in_editor`, `reveal`, `copy_path`, `open_url`, `copy_link`), `relative` (the path needed the session's worktree) |
| `mac_transcript_find_used` | Find in chat closed after a search | `matches_bucket` (`0`, `1-9`, `10-99`, `100+`), `navigated` (stepped between matches) |
| `mac_transcript_copied` | Transcript text was copied with ⌘C or the context menu | `span` (`selection` within one message, `across_messages`) |
| `mac_transcript_work_log_opened` | A turn's folded work ("Worked for 5m 29s") was opened in a transcript | `working` (the agent was still on that turn) |
| `mac_image_viewer_used` | The image viewer was opened, paged, or an image was copied, saved or opened in Preview from it | `action` (`open`, `page`, `copy`, `save`, `open_preview`) |
| `mac_design_layer_selected` | The first layer picked in a design viewer frame | `source` (`canvas` — clicked on the render, `tree` — picked in the layer list) |
| `mac_message_action` | A message's hover action was used | `action` (`copy`, `edit`, `fork_session`, `fork_agent`), `role` (`user`, `assistant`), `success` (the host took the edit or fork; always true for copy) |
| `mac_input_used` | A chat-input feature was used | `affordance` (`slash_command`, `mention`, `image_paste`, `image_drop`, `image_attach`, `file_mention`, `permission_cycle`, `interrupt_shortcut`, `follow_up`) |
| `mac_terminal_used` | Something was done to a terminal from the panel or the run control | `action` (`new_shell`, `close`, `rename`, `run`, `stop`, `stop_others_and_run`, `open_link`) |
| `mac_terminal_replayed` | A terminal view attached and replayed what the host had captured | `bytes_bucket` (`0`, `<4k`, `<64k`, `64k+`), `truncated` (the host had already dropped older output) |
| `mac_terminal_find_used` | Find in a terminal closed after a search | `matches_bucket` (`0`, `1-9`, `10-99`, `100+`), `navigated` |
| `mac_runtime_target_picked` | A device was picked in the side panel's Device tab | `platform` (`ios`, `android`, `web`) |
| `mac_device_watched` | A live device picture closed | `platform`, `duration_ms`, `interacted` (a tap, key or button was sent) |
| `mac_device_popout_opened` | A device was opened in its own floating window | `platform` |
| `mac_panel_toggled` | The side panel was shown or hidden for the session on screen, from the toolbar's panel button or the panel's close button, ⌘J, ⇧⌘T or ⌥⌘B on the tab already in front, the View menu or the command palette | `shown` (bool), `via` (`button`, `shortcut`, `menu`, `palette`) |
| `mac_panel_tab_opened` | A side panel tab was opened or brought to the front, from its "+" menu, a shortcut (⇧⌘T terminal, ⌥⌘B device), the View menu, the command palette, the empty panel's buttons, or a run command or runtime that brings its output into view | `kind` (`browser`, `terminal`, `files`, `diff`, `pull_request`, `device`, `huddle_chat`), `via` (`button`, `shortcut`, `menu`, `palette`, `tab_menu`, `action`) |
| `mac_device_power` | A device was booted, shut down (Devices screen) or disconnected (the side panel's Device tab) | `action` (`boot`, `shutdown`, `disconnect`), `platform` |
| `mac_eas_session_start_prompted` | The app asked before booting a stopped EAS Simulator device, which starts a billed session | `outcome` (`confirmed`, `cancelled`) |
| `mac_browser_used` | The side panel's Browser tab was driven from its toolbar | `action` (`open`, `navigate`, `back`, `forward`, `reload`, `preset`) |
| `mac_inspection_used` | The device inspector captured a screen, launched an app with inspection, selected an element or edited a property | `action` (`capture`, `launch`, `select`, `edit`), `success` |
| `mac_git_used` | A git action ran from the git panel (the app runs git itself, so the host never sees these; merging into the base and pull requests are captured by the host) | `action` (`stage`, `unstage`, `stage_hunk`, `unstage_hunk`, `stage_lines`, `unstage_lines`, `discard`, `discard_hunk`, `discard_lines`, `commit`, `amend`, `checkout`, `branch_create`, `branch_rename`, `branch_delete`, `merge`, `rebase`, `interactive_rebase`, `cherry_pick`, `revert`, `reset`, `reword`, `squash`, `drop`, `stash_create`, `stash_apply`, `stash_pop`, `stash_drop`, `tag_create`, `tag_delete`, `fetch`, `pull`, `push`, `sync` (fetch, pull and push from the toolbar's Sync), `resolve_conflict`, `continue_operation`, `abort_operation`, `restore_file`, `file_action` (ignore, stop tracking, rename, trash or track a file with Git LFS), `undo`, `redo`, `bisect`, `submodule`, `remote`, `hook`, `config` (repo config, auto-fetch or a per-project git preference), `pin`, `archive` (pin/archive or their undo, in the git sidebar), `set_upstream`, `template`, `gitmoji` (a commit template or gitmoji put into the message), `identity` (switched to a saved identity profile), `patch_create`, `patch_apply`), `scope` (`session`, `project`), `remote` (the session is on a paired host), `success` |
| `mac_git_recovery_used` | A fix was picked from the git panel's error banner | `kind` (the failure: `non-fast-forward`, `no-upstream`, `merge-conflict`, `rebase-conflict`, `cherry-pick-conflict`, `dirty-working-tree`, `auth-required`, `network-timeout`, `lock-file-exists`, `lfs-missing`, `signing-failed`, `hook-failed`, `unknown`, …), `action` (`publish-branch`, `pull-then-push`, `force-with-lease`, `retry`, `open-conflicts`, `continue`, `abort`, `stash-and-retry`, `install-lfs`, `configure-signing`, `copy-details`) |
| `mac_git_view_picked` | A git view was picked from the git panel's pill bar or its More menu | `view` (the route segment: `working`, `branch`, `history`, `stashes`, `pull-requests`, `branches-review`, `conflicts`, `reflog`, `blame`, `bisect`, `hooks`, `submodules`, `settings`), `via` (`tabs`, `more`) |
| `mac_diff_layout_changed` | Diffs were switched between unified and split, from a diff's header or Settings → Git | `layout` (`unified`, `split`), `via` (`diff`, `settings`) |
| `mac_pull_request_acted` | A pull request was opened, merged, commented on or closed from the app (through the host's `gh`), or Claude filled in a new one's description | `action` (`open`, `merge`, `comment`, `close`, `fill`) |
| `mac_account_join_acted` | This Mac asked to join the account, or approved or denied a device joining it | `action` (`requested`, `approved`, `denied`, `expired`), `role` (`subject`, `approver`) |
| `mac_account_member_changed` | This Mac removed or renamed a device or host on the account | `action` (`removed`, `renamed`), `role` (`device`, `host`) |
| `mac_device_name_changed` | This Mac's name setting changed, in Settings → General or by renaming this Mac or its host in the account list (a rename from another device that the setting follows sends nothing) | `source` (`settings`, `account_list`), `linked` — renamed on the account too |
| `mac_hosts_used` | Another host was paired, attached, detached, forgotten, renamed or shown from the Hosts settings or the machines menu | `action` (`pair`, `attach`, `detach`, `forget`, `rename`, `focus`), `success` |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mac_palette_command_run` | A command palette entry was run | `section` (`navigate`, `sessions`, `session`, `project`, `app`, `git`, `settings`, `automations`) |
| `mac_handoff_continued` | The phone handed a session over through Handoff | `matched` (it named this computer, so the session opened) |
| `mac_onboarding_step` | A first-run step was finished or skipped | `step` (`welcome`, `privacy`, `setup`, `project`), `skipped` |
| `mac_prereq_fixed` | A one-click environment fixer ran (first run or a home-screen card) | `prereq` (the check's id, e.g. `claude_cli`, `git_identity`), `success` |
| `mac_project_added` | A project was added | `source` (`open_panel`, `example`, `recent`) |
| `mac_argus_json_generated` | A proposed `.argus.json` was saved, discarded, or couldn't be generated | `method` (`quick`, `claude`), `outcome` (`saved`, `discarded`, `failed`) |
| `mac_project_settings_saved` | Project Settings was saved | `changed_bucket` (top-level `.argus.json` keys that changed: `0`, `1-9`, `10-99`, `100+`), `personal` (the branch prefix changed too), `success` |
| `mac_settings_changed` | A setting was changed in the Settings window — which one, never its value | `section` (the Settings tab), `setting` (listed below) |
| `mac_remote_setting_changed` | A Remote Access setting was changed (`setting` also `notify_when_focused`, `push_contact`) | `setting` (`enabled`, `managed_tunnel`, `legacy_tunnels`, `push`, …), `on` (toggles) |
| `mac_pairing` | A device pairing moved on in the pairing sheet or the menu bar item's pairing window | `stage` (`started`, `confirmed`, `completed`, `cancelled`, `failed`), `client` (`desktop`, `mobile`, `web`, `unknown`) |
| `mac_remote_device_managed` | A paired device's grants were changed, it was revoked, or sent a test push | `action` (`grants`, `revoke`, `test_push`), `success` |
| `mac_huddle_used` | A huddle was started, blocked or ended, a guest let in or out, a chat message sent or the invite copied | `action` (`start`, `blocked`, `stop`, `approve`, `deny`, `remove`, `say`, `copy_invite`), `has_device` |
| `mac_automation_edited` | An automation was created, described, saved, deleted, paused or resumed, or its playbook rewritten | `action` (`create`, `describe`, `save`, `delete`, `enable`, `disable`, `revise_playbook`) |
| `mac_run_acted` | A run was started, cancelled, argued with, kept as an automation, deleted or marked read | `action` (`start`, `start_scratch`, `cancel`, `feedback`, `save_scratch`, `delete`, `mark_read`) |
| `mac_proposal_handled` | An inbox proposal was answered | `action` (`accept`, `dismiss`, `resolve`, `cleanup`, `request_revision`) |
| `mac_memory_edited` | An automation's memory was saved or deleted | `action` (`save`, `delete`) |
| `mac_editor_file_opened` | The code view read a file into a tab | `source` (`chat_link`, `diff`, `blame`, `changes`, `tree`, `quick_open`, `search`, `diagnostic`, `definition`, `symbol`, `history`), `language` (a bundled grammar or `other`), `size_bucket` (`<10k`, `<100k`, `<1m`, `1m+`), `read_only` |
| `mac_editor_file_saved` | A file was saved from the code view | `formatted`, `formatter` (`prettier`, `swiftformat`, `swift_format`, `lsp`, `other`, `none`: what ran on the save), `had_conflict` (the file had changed on disk since it was read) |
| `mac_editor_conflict_resolved` | The "changed on disk" banner was answered | `action` (`compare`, `keep_mine`, `reload`) |
| `mac_editor_external_reload` | An open file with no unsaved edits took a change from disk; once per file per session | `agent_running` |
| `mac_editor_highlight_unavailable` | An opened file isn't highlighted | `language`, `reason` (`no_grammar`, `too_large`, `long_lines`) |
| `mac_editor_search_run` | A search finished: in-file find when its bar closes, worktree search when results are in | `scope` (`file`, `worktree`), `regex`, `result_bucket` (`0`, `1-9`, `10-99`, `100+`), `truncated` |
| `mac_editor_ask_agent` | Code was handed to the session's agent to look at | `source` (`diagnostic`, `selection`), `started_agent` (no agent was live, so one was started) |
| `mac_editor_completion_accepted` | A completion was accepted in the code view | `language` |
| `mac_editor_command` | An editor command ran from its key, a menu or the gutter's fold chevrons; once per command per open file | `command` (`toggle_line_comment`, `toggle_block_comment`, `move_lines_up`, `move_lines_down`, `copy_lines_up`, `copy_lines_down`, `delete_lines`, `insert_line_below`, `insert_line_above`, `indent_lines`, `outdent_lines`, `select_line`, `add_next_occurrence`, `select_all_occurrences`, `add_cursor_above`, `add_cursor_below`, `jump_to_bracket`, `go_to_line`, `next_problem`, `previous_problem`, `go_to_definition`, `trigger_completion`, `fold`, `unfold`, `fold_all`, `unfold_all`) |
| `mac_editor_quick_open_used` | Quick open closed | `mode` (`files`, `mixed`, `symbols`, `file_symbols`, `line`), `result` (`opened`, `dismissed`) |
| `mac_sidebar_project_toggled` | A project in the sidebar was collapsed or expanded | `collapsed` |
| `mac_sidebar_filtered` | The sidebar was searched (once per search, never the query) or narrowed to one project from its filter menu | `kind` (`search`, `project`) |
| `mac_context_card_used` | A session's context card was folded to its switcher or opened again, or one of its actions used (its view switcher counts as `mac_session_panel_switched`) | `action` (`collapse`, `expand`, `recent_chats`, `open_editor`, `reveal`, `copy_path`, `run`, `share`, `branch`, `switch_branch`, `push`, `changes`, `linked_issue`, `design`, `mcp`) |
| `mac_session_hover_card_shown` | The pointer rested on a sidebar session long enough to open its git and activity card | `has_changes` (bool) — its diff wasn't empty |
| `mac_issue_property_menu_opened` | An issue page's status or priority menu was opened (picking a value is `linear_issue_updated`) | `property` (`status`, `priority`), `via` (`click`, `shortcut` the page's S / P keys) |
| `mac_agent_tab_menu_used` | An item in an agent tab's right-click menu was used | `action` (`rename`, `copy_id`, `pin`, `unpin`, `stop`, `reveal`, `close`, `close_others`, `close_left`, `close_right`, `close_idle`, `close_all`) |
| `mac_home_usage_opened` | The plan-limits strip on Home was clicked to open Usage | `level` (`normal`, `warning`, `critical`) — the most severe limit shown |
| `mac_issue_searched` | A workspace issue search settled on the Issues screen, once per term (never the term) | `result_bucket` (`0`, `1-9`, `10-99`, `100+`) |
| `mac_navigated_history` | Back or Forward went through the window tab's history | `direction` (`back`, `forward`), `via` (`button` the toolbar chevrons, `shortcut` ⌘[ / ⌘] or the code view's ⌃- / ⌃⇧-, `menu` the Go menu clicked, `palette`, `mouse` the side buttons) |

`mac_settings_changed`'s `section` is `general`, `appearance`, `accounts`, `agents`, `llm`,
`mcp`, `integrations`, `tools`, `editor` or `advanced`, and `setting` is one of `theme`, `color_theme`, `display_size`,
`launch_route`, `worktree_location`, `automation_worktree_location`,
`custom_editors`, `telemetry_mode`, `account_selected`, `account_added`,
`account_removed`, `account_renamed`, `account_reauth`,
`permission_mode`, `automations_enabled`, `follow_up_suggestions`, `warm_agents`, `default_autonomy`, `concurrency`,
`daily_budget`, `import_cli_chats`, `save_chat_history`, `allowed_commands`, `allowed_tools`, `refusal_allowed`,
`refusal_dismissed`, `runner`, `llm_model`, `custom_runner_saved`,
`custom_runner_deleted`, `mcp_servers`, `mcp_tested`, `mcp_signed_in`,
`mcp_signed_out`, `tool_toggled`, `prereq_fixed`, `conductor_version`,
`update_channel`, `editor_font`, `editor_font_size`, `editor_tab_width`,
`editor_insert_spaces`, `editor_wrap_lines`, `editor_show_invisibles`,
`editor_format_on_save`, `open_file_links_in`, `language_servers`,
`linear_mark_started` or `linear_report`. `mcp_tested` also fires when a server is tested from Project
Settings.

## Argus Server (Mac)

The native Argus Server (`clients/apple/ArgusServer`) sends its events
through its own host with `telemetry_capture`, like the Mac app. A server
has no onboarding to ask, so it stays at `presence` — the launch heartbeat
only — until someone picks **Full analytics** in its Settings. Everything the
host already sees (agents, sessions, the account and its tunnel, pairing on
the host side) is captured there and absent below.

| Event                    | When                                                                                                                           | Props                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mac_server_launched`    | The app started                                                                                                                | `login_item` (`enabled`, `requires_approval`, `off`), `launched_by_launchd` — started by its login item rather than by hand                                                                                                               |
| `mac_server_host`        | The supervised host started, crashed, was given up on after repeated crashes, found another app on its home, or was taken over | `stage` (`started`, `crashed`, `gave_up`, `lock_conflict`, `handover`); `restarts` (crash restarts so far, or crashes when giving up), `exit_code`, `holder` (`electron`, `mac`, `mac_server`, `cli`) and `success` only where they apply |
| `mac_server_menu_action` | A menu item or window button that does something was used                                                                      | `action` (`pair`, `link`, `approve_join`, `deny_join`, `rename`, `unlink`, `toggle_tunnel`, `open_web`, `open_agent`, `open_logs`, `restart_host`, `take_over`, `quit`)                                                                   |
| `mac_server_pairing`     | A pairing started from the server was confirmed with codes matching, rejected because they differed, failed, or cancelled      | `stage` (`confirmed`, `rejected`, `failed`, `cancelled`), `grant` (`monitor`, `control`, `admin`; `none` unless confirmed)                                                                                                                |
| `mac_server_update`      | An update was checked for, downloaded, started installing, refused because agents were running, installed when idle, or failed | `stage` (`checked`, `downloaded`, `installed`, `blocked_by_agents`, `auto_installed`, `failed`)                                                                                                                                           |
| `mac_server_login_item`  | **Open at Login** was switched                                                                                                 | `enabled`, `status` (`enabled`, `requires_approval`, `off`) — what macOS made of it                                                                                                                                                       |
| `mac_server_migrated`    | The old Electron server's login agent was replaced by this app's login item, or the running old server was taken over          | `from` (`electron_agent`, `electron_running`), `success`                                                                                                                                                                                  |
