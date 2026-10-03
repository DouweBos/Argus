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
(the UI, covering renderer lifecycle and feedback), and **ios** (the
iOS client — see [iOS client](#ios-client)). Desktop has one PostHog
client, in the main process: the renderer sends its events over IPC and
main does the talking, so there is no browser SDK in the app. The iOS
client talks to PostHog directly, because it has to work unpaired and
offline. In `presence` mode the renderer emits nothing — the heartbeat
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

- Builds with no PostHog key configured. On iOS that is every checkout
  without a local `Config/Argus.local.xcconfig`, which is the default.

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

| Event                | Source   | When                                                                       | Extra props                                         |
| -------------------- | -------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| `app_launched`       | main     | Telemetry transitions presence → full (opt-in, or replayed at each launch) | —                                                   |
| `app_quit`           | main     | App is quitting                                                            | —                                                   |
| `renderer_started`   | renderer | Each renderer (main window or popout) finishes booting                     | `popout: "main" \| string`                          |
| `$pageview`          | renderer | The renderer URL changes (initial mount + every navigation)                | `$pathname`, `$current_url` — both sanitised, see ↓ |
| `telemetry_enabled`  | main     | User opts up to full                                                       | —                                                   |
| `telemetry_disabled` | main     | User drops back to presence (sent before the flip + flush)                 | —                                                   |
| `host_lock_handover` | main     | Another host held this Argus home and the user had Argus quit it to start  | `holder: "cli" \| "electron" \| "mac"`              |

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

## Sessions

| Event                       | Source | When                                                                                                                   | Extra props                                                                                 |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `session_created`           | main   | A new session is created                                                                                               | `has_explicit_branch`, `has_description`, `use_existing_branch`, `has_explicit_base_branch` |
| `session_prompt_dispatched` | main   | The host starts the agent for a session created with a prompt (e.g. a plan handed off from the phone)                  | `success`                                                                                   |
| `session_deleted`           | main   | A session is deleted                                                                                                   | `kind` (`worktree` \| `project_root` \| `scratch_pad`), `delete_branch`                     |
| `session_setup_recovered`   | main   | A session whose setup failed is retried (fires when the retry finishes) or marked ready, from the desktop or the phone | `action` (`retry` \| `mark_ready`), `success`                                               |
| `scratch_pad_created`       | main   | A scratch pad is created                                                                                               | `has_name` — whether a name was given rather than the default                               |
| `worktrees_moved`           | main   | A project's worktrees were moved to a new location                                                                     | `moved`, `failed` (counts), `copied` (crossed drives), `duration_bucket`, `purpose`         |

## Merges

`session_merge_*` covers the merge flow. `phase` distinguishes the
initial attempt from a `continue` after the user resolved conflicts.

| Event                    | Source | When                             | Extra props                                                      |
| ------------------------ | ------ | -------------------------------- | ---------------------------------------------------------------- |
| `session_merged`         | main   | Merge completed cleanly          | `phase: "attempt" \| "continue"`, `strategy: "keep" \| "squash"` |
| `session_merge_conflict` | main   | Merge stopped on conflicts       | `phase`, `conflicting_files` (count, not paths)                  |
| `session_merge_aborted`  | main   | An in-progress merge was aborted | `kind: "rebase" \| "merge"`                                      |

## Agents

| Event                       | Source | When                                                                                                             | Extra props                                                                           |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `agent_started`             | main   | A new agent is started                                                                                           | `has_model`, `has_resume_id`, `has_parent`, `permission_mode`, `session_kind`         |
| `agent_restored`            | main   | Conversation restored at a prior turn                                                                            | `keep_turn_number`, `is_fresh_start`                                                  |
| `agent_exited`              | main   | The agent process exited                                                                                         | `exit_code`, `success`, `turns_completed`, `tool_uses`, `duration_ms`                 |
| `agent_stopped`             | main   | The agent was stopped                                                                                            | —                                                                                     |
| `agent_nudged`              | main   | An agent sent a `push_notification`                                                                              | `critical` (urgency), `tagged` (tied to a session)                                    |
| `agent_interrupted`         | main   | The agent was interrupted                                                                                        | —                                                                                     |
| `agent_limit_auto_continue` | main   | An agent stalled on a usage limit got a continue scheduled, sent, cancelled by a send, dismissed, or given up on | `action` (`scheduled`, `sent`, `cancelled`, `dismissed`, `gave_up`), `has_reset_time` |

## Automations

| Event                                   | Source | When                                                     | Extra props                                                   |
| --------------------------------------- | ------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| `automation_extra_instructions_changed` | main   | An automation's extra instructions were added or cleared | `has_instructions`                                            |
| `automation_github_read`                | main   | An automation run read GitHub through an Argus tool      | `tool: "get" \| "artifact_search"`, `success`                 |
| `proposal_start_failed`                 | main   | Starting a proposal failed before its agent ran          | `stage` (`creating_worktree`, `setting_up`, `starting_agent`) |

## Claude accounts

| Event                      | Source | When                                                    | Extra props                                                                 |
| -------------------------- | ------ | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `claude_account_rechecked` | main   | An account badged Limit reached or Signed out re-probed | `outcome: "ok" \| "rate_limited" \| "reauth" \| "unknown"`, `badge_cleared` |

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

| Event                                      | When                                                                                    | Extra props                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `$pageview`                                | Once per launch, in every mode                                                          | `$current_url: "argus-ios:///"`, `$pathname: "/"`, `app_version`, `source: "heartbeat"` |
| `$screen`                                  | A screen is pushed                                                                      | `$screen_name` — the route pattern only, e.g. `agent`, never a project or branch name   |
| `ios_launched`                             | Telemetry is in full mode at launch, or opts up                                         | —                                                                                       |
| `ios_paired`                               | A computer was paired                                                                   | `endpoint_kind`, `has_control`                                                          |
| `ios_pair_failed`                          | Pairing failed                                                                          | `reason` (the failure case name, no detail)                                             |
| `ios_host_switched`                        | A different paired computer was selected                                                | `host_count`                                                                            |
| `ios_message_sent`                         | A message reached the computer, or its queue                                            | `queued`, `has_images`, `length_bucket`                                                 |
| `ios_message_send_failed`                  | A message never left the phone                                                          | `retried`                                                                               |
| `ios_permission_answered`                  | A permission prompt was answered                                                        | `approved`, `from_notification`                                                         |
| `ios_agent_controlled`                     | An agent was steered from the phone                                                     | `action` (`interrupt`, `stop`, `model`, `effort`, `permission_mode`)                    |
| `ios_work_landed`                          | Work was committed, pushed or merged                                                    | `action`, `success`, `strategy` (`keep`, `squash`, or `none` outside a merge)           |
| `ios_device_watched`                       | A mirrored device screen was closed                                                     | `duration_ms`, `interacted`                                                             |
| `ios_claude_account_changed`               | A Claude account was picked, added, removed, renamed or pinned to a session             | `action` (`select`, `add`, `remove`, `rename`, `pin`)                                   |
| `ios_memory_edited`                        | An automation's memory was saved or deleted                                             | `action` (`save`, `delete`)                                                             |
| `ios_proposal_opened`                      | The inbox opened the run behind a proposal                                              | —                                                                                       |
| `ios_setting_changed`                      | A phone-local setting was toggled                                                       | `setting` (`auto_expand_image_reads`), `enabled`                                        |
| `ios_automation_edited`                    | An automation was created, saved, deleted, paused or resumed, or its playbook rewritten | `action` (`create`, `save`, `delete`, `enable`, `disable`, `revise_playbook`)           |
| `ios_run_acted`                            | A run was started, cancelled, argued with, or kept as an automation                     | `action` (`start`, `start_scratch`, `cancel`, `feedback`, `save_scratch`)               |
| `ios_proposal_handled`                     | An inbox proposal was answered                                                          | `action` (`accept`, `dismiss`, `resolve`, `cleanup`)                                    |
| `ios_pull_request_acted`                   | A pull request was opened, merged or commented on                                       | `action` (`open`, `merge`, `comment`)                                                   |
| `ios_branch_acted`                         | A branch was checked out, created or deleted                                            | `action` (`checkout`, `create`, `delete`)                                               |
| `ios_session_renamed`                      | A session's name, branch or base branch was changed                                     | `target` (`session`, `branch`, `base`)                                                  |
| `ios_app_error`                            | A failure the user was shown                                                            | `scope`, scrubbed `message` (≤2000 chars)                                               |
| `telemetry_enabled` / `telemetry_disabled` | The privacy toggle moved                                                                | — (shared with desktop on purpose: same signal)                                         |

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

## Mac app (beta)

The native Mac app (`clients/apple/ArgusDesktop`) sends its events
**through its own host** with `telemetry_capture`, the way the Electron
renderer does — same install id, same PostHog key, same consent gate.
Its consent level is kept by the app and pushed to the host on every
connect; until the user opts up it is `presence`, so none of these
leave the machine.

Everything the host already sees (`agent_started`, `session_created`,
`session_merged`, …) is captured there and absent below.

| Event                        | When                                                                                                                                                          | Extra props                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mac_launched`               | The app launched                                                                                                                                              | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `mac_quit`                   | The app is quitting                                                                                                                                           | `had_running_agents`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mac_host_started`           | The bundled host came up                                                                                                                                      | `restarts` (crash restarts so far this launch)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `mac_host_crashed`           | The bundled host exited unexpectedly                                                                                                                          | `exit_code`, `attempt`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `mac_host_failed`            | The host crashed too often in a row and the app gave up                                                                                                       | `crashes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mac_host_lock_conflict`     | Another app's host was already running on this Argus home                                                                                                     | `holder` (`electron`, `mac`, `cli`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `mac_host_handover`          | The user had the app quit the other host and take over                                                                                                        | `holder`, `success`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `mac_screen_viewed`          | The window navigated                                                                                                                                          | `screen` — the route pattern, never an id                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mac_transcript_link_opened` | A file or URL link in a transcript was used                                                                                                                   | `action` (`open`, `open_in_editor`, `reveal`, `copy_path`, `open_url`, `copy_link`), `relative` (the path needed the session's worktree)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `mac_transcript_find_used`   | Find in chat closed after a search                                                                                                                            | `matches_bucket` (`0`, `1-9`, `10-99`, `100+`), `navigated` (stepped between matches)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `mac_input_used`             | A chat-input feature was used                                                                                                                                 | `affordance` (`slash_command`, `mention`, `image_paste`, `image_drop`, `image_attach`, `file_mention`, `permission_cycle`, `interrupt_shortcut`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `mac_terminal_used`          | Something was done to a terminal from the panel or the run control                                                                                            | `action` (`new_shell`, `close`, `rename`, `run`, `stop`, `stop_others_and_run`, `open_link`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `mac_terminal_replayed`      | A terminal view attached and replayed what the host had captured                                                                                              | `bytes_bucket` (`0`, `<4k`, `<64k`, `64k+`), `truncated` (the host had already dropped older output)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mac_terminal_find_used`     | Find in a terminal closed after a search                                                                                                                      | `matches_bucket` (`0`, `1-9`, `10-99`, `100+`), `navigated`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `mac_runtime_target_picked`  | A device or the browser was picked in the runtime panel                                                                                                       | `platform` (`ios`, `android`, `web`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mac_device_watched`         | A live device picture closed                                                                                                                                  | `platform`, `duration_ms`, `interacted` (a tap, key or button was sent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `mac_device_popout_opened`   | A device was opened in its own floating window                                                                                                                | `platform`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `mac_device_power`           | A device was booted, shut down (Devices screen) or disconnected (runtime panel)                                                                               | `action` (`boot`, `shutdown`, `disconnect`), `platform`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `mac_browser_used`           | The runtime panel's browser was driven from its toolbar                                                                                                       | `action` (`navigate`, `back`, `forward`, `reload`, `preset`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `mac_inspection_used`        | The device inspector captured a screen, launched an app with inspection, selected an element or edited a property                                             | `action` (`capture`, `launch`, `select`, `edit`), `success`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `mac_git_used`               | A git action ran from the git panel (the app runs git itself, so the host never sees these; merging into the base and pull requests are captured by the host) | `action` (`stage`, `unstage`, `stage_hunk`, `unstage_hunk`, `stage_lines`, `unstage_lines`, `discard`, `discard_hunk`, `discard_lines`, `commit`, `amend`, `checkout`, `branch_create`, `branch_rename`, `branch_delete`, `merge`, `rebase`, `interactive_rebase`, `cherry_pick`, `revert`, `reset`, `reword`, `squash`, `drop`, `stash_create`, `stash_apply`, `stash_pop`, `stash_drop`, `tag_create`, `tag_delete`, `fetch`, `pull`, `push`, `resolve_conflict`, `continue_operation`, `abort_operation`, `restore_file`, `file_action` (ignore, stop tracking, rename or trash a file), `undo`, `redo`, `bisect`, `submodule`, `remote`, `hook`, `config` (repo config, auto-fetch or a per-project git preference), `pin`, `archive` (pin/archive or their undo, in the git sidebar), `set_upstream`), `scope` (`session`, `project`), `success` |
| `mac_pull_request_acted`     | A pull request was opened, merged, commented on or closed from the app (through the host's `gh`)                                                              | `action` (`open`, `merge`, `comment`, `close`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Event                        | When                                                                                                              | Extra props                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mac_launched`               | The app launched                                                                                                  | —                                                                                                                                                |
| `mac_quit`                   | The app is quitting                                                                                               | `had_running_agents`                                                                                                                             |
| `mac_host_started`           | The bundled host came up                                                                                          | `restarts` (crash restarts so far this launch)                                                                                                   |
| `mac_host_crashed`           | The bundled host exited unexpectedly                                                                              | `exit_code`, `attempt`                                                                                                                           |
| `mac_host_failed`            | The host crashed too often in a row and the app gave up                                                           | `crashes`                                                                                                                                        |
| `mac_host_lock_conflict`     | Another app's host was already running on this Argus home                                                         | `holder` (`electron`, `mac`, `cli`)                                                                                                              |
| `mac_host_handover`          | The user had the app quit the other host and take over                                                            | `holder`, `success`                                                                                                                              |
| `mac_screen_viewed`          | The window navigated                                                                                              | `screen` — the route pattern, never an id                                                                                                        |
| `mac_transcript_link_opened` | A file or URL link in a transcript was used                                                                       | `action` (`open`, `open_in_editor`, `reveal`, `copy_path`, `open_url`, `copy_link`), `relative` (the path needed the session's worktree)         |
| `mac_transcript_find_used`   | Find in chat closed after a search                                                                                | `matches_bucket` (`0`, `1-9`, `10-99`, `100+`), `navigated` (stepped between matches)                                                            |
| `mac_input_used`             | A chat-input feature was used                                                                                     | `affordance` (`slash_command`, `mention`, `image_paste`, `image_drop`, `image_attach`, `file_mention`, `permission_cycle`, `interrupt_shortcut`) |
| `mac_terminal_used`          | Something was done to a terminal from the panel or the run control                                                | `action` (`new_shell`, `close`, `rename`, `run`, `stop`, `stop_others_and_run`, `open_link`)                                                     |
| `mac_terminal_replayed`      | A terminal view attached and replayed what the host had captured                                                  | `bytes_bucket` (`0`, `<4k`, `<64k`, `64k+`), `truncated` (the host had already dropped older output)                                             |
| `mac_terminal_find_used`     | Find in a terminal closed after a search                                                                          | `matches_bucket` (`0`, `1-9`, `10-99`, `100+`), `navigated`                                                                                      |
| `mac_runtime_target_picked`  | A device or the browser was picked in the runtime panel                                                           | `platform` (`ios`, `android`, `web`)                                                                                                             |
| `mac_device_watched`         | A live device picture closed                                                                                      | `platform`, `duration_ms`, `interacted` (a tap, key or button was sent)                                                                          |
| `mac_device_popout_opened`   | A device was opened in its own floating window                                                                    | `platform`                                                                                                                                       |
| `mac_device_power`           | A device was booted, shut down (Devices screen) or disconnected (runtime panel)                                   | `action` (`boot`, `shutdown`, `disconnect`), `platform`                                                                                          |
| `mac_browser_used`           | The runtime panel's browser was driven from its toolbar                                                           | `action` (`navigate`, `back`, `forward`, `reload`, `preset`)                                                                                     |
| `mac_inspection_used`        | The device inspector captured a screen, launched an app with inspection, selected an element or edited a property | `action` (`capture`, `launch`, `select`, `edit`), `success`                                                                                      |
| `mac_palette_command_run`    | A command palette entry was run                                                                                   | `section` (`navigate`, `sessions`, `session`, `project`, `app`, `git`, `settings`)                                                               |
| `mac_handoff_continued`      | The phone handed a session over through Handoff                                                                   | `matched` (it named this computer, so the session opened)                                                                                        |
| `mac_onboarding_step`        | A first-run step was finished or skipped                                                                          | `step` (`welcome`, `privacy`, `setup`, `project`), `skipped`                                                                                     |
| `mac_prereq_fixed`           | A one-click environment fixer ran (first run or a home-screen card)                                               | `prereq` (the check's id, e.g. `claude_cli`, `git_identity`), `success`                                                                          |
| `mac_project_added`          | A project was added                                                                                               | `source` (`open_panel`, `example`, `recent`)                                                                                                     |
| `mac_argus_json_generated`   | A proposed `.argus.json` was saved, discarded, or couldn't be generated                                           | `method` (`quick`, `claude`), `outcome` (`saved`, `discarded`, `failed`)                                                                         |
| `mac_project_settings_saved` | Project Settings was saved                                                                                        | `changed_bucket` (top-level `.argus.json` keys that changed: `0`, `1-9`, `10-99`, `100+`), `personal` (the branch prefix changed too), `success` |
| `mac_settings_changed`       | A setting was changed in the Settings window — which one, never its value                                         | `section` (the Settings tab), `setting` (listed below)                                                                                           |
| `mac_remote_setting_changed` | A Remote Access setting was changed (`setting` also `notify_when_focused`, `push_contact`)                        | `setting` (`enabled`, `tailscale`, `cloudflare`, `tunnel_mode`, `tunnel_token`, `public_url`, `push`, …), `on` (toggles)                         |
| `mac_pairing`                | A device pairing moved on in the pairing sheet                                                                    | `stage` (`started`, `confirmed`, `completed`, `cancelled`, `failed`), `client` (`desktop`, `mobile`, `web`, `unknown`)                           |
| `mac_remote_device_managed`  | A paired device's grants were changed, it was revoked, or sent a test push                                        | `action` (`grants`, `revoke`, `test_push`), `success`                                                                                            |
| `mac_tailscale_checked`      | The Tailscale Funnel checklist re-checked or ran a one-click fix                                                  | `fix` (a fix rather than a check), `ready` (every prerequisite passed)                                                                           |
| `mac_huddle_used`            | A huddle was started, blocked or ended, a guest let in or out, a chat message sent or the invite copied           | `action` (`start`, `blocked`, `stop`, `approve`, `deny`, `remove`, `say`, `copy_invite`), `has_device`                                           |

`mac_settings_changed`'s `section` is `general`, `accounts`, `agents`, `llm`,
`mcp`, `tools` or `advanced`, and `setting` is one of `theme`, `display_size`,
`launch_route`, `worktree_location`, `automation_worktree_location`,
`custom_editors`, `telemetry_mode`, `account_selected`, `account_added`,
`account_removed`, `account_renamed`, `account_reauth`, `default_model`,
`permission_mode`, `automations_enabled`, `default_autonomy`, `concurrency`,
`daily_budget`, `allowed_commands`, `allowed_tools`, `refusal_allowed`,
`refusal_dismissed`, `runner`, `llm_model`, `custom_runner_saved`,
`custom_runner_deleted`, `mcp_servers`, `mcp_tested`, `mcp_signed_in`,
`mcp_signed_out`, `tool_toggled`, `prereq_fixed`, `conductor_version` or
`update_channel`.
