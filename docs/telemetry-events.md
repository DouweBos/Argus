# Telemetry events

Catalog of every event Argus sends to PostHog. Telemetry has **three
levels**, picked during the one-time consent step on first launch and
changeable any time under Settings → Privacy:

| Mode       | What gets sent                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `off`      | Nothing. The privacy-maximum mode — even heartbeat `$pageview` is suppressed, so PostHog never sees this install at all.                                           |
| `presence` | Exactly one event per app launch: a [heartbeat `$pageview`](#presence) with a fixed `argus:///` path. No baseProps, no errors, no feedback, no other `$pageview`s. |
| `full`     | The whole catalogue below — lifecycle, sessions, merges, agents, org tasks, errors, feedback. Same as before.                                                      |

The default for new installs is `off` until the user makes an explicit
choice in onboarding. Existing installs that opted out under the old
on/off toggle keep behaving as `off`; existing opt-ins map to `full`.

Events come from two channels: **main** (the Argus app process,
covering lifecycle, sessions, merges, agents, org tasks) and
**renderer** (the UI, covering renderer lifecycle and feedback). Both
funnel into the same PostHog project. In `presence` mode the renderer
SDK is initialised but emits nothing — the heartbeat is sent from main
only.

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
  at `~/.argus/telemetry-id` (main) or `localStorage` (renderer). Wipe
  the file or clear browser storage to rotate it. We never call
  `posthog.identify(...)` — there is no person profile, no email, and no
  account linked to it (`$is_identified: false`,
  `$process_person_profile: false`).

**Argus props (from our `baseProps()`):**

- Main: `app_version`, `is_packaged`, `platform`, `arch`, `os_release`,
  `electron_version`, `node_version`.
- Renderer: `app_version`, `platform`, `process: "renderer"`.

**PostHog SDK auto-properties (renderer only — `posthog-js`):**

- `$browser`, `$browser_version`, `$browser_language`, `$raw_user_agent`
- `$os`, `$os_version` (derived from the user agent)
- `$device_type` (e.g. `Desktop`)
- `$screen_width` / `$screen_height` and `$viewport_width` / `$viewport_height`
- `$timezone`, `$timezone_offset`
- `$current_url`, `$pathname`, `$host` — the in-app URL of the renderer
  window (always under `localhost:1420` or the bundled file URL; never
  external sites)
- `$referrer`, `$referring_domain` — almost always `$direct` because
  the renderer is local
- `$session_id`, `$window_id`, `$session_entry_*` — rotating per
  PostHog SDK session (30-min idle timeout); used by PostHog to group
  events into sessions on its end
- `$insert_id`, `$sent_at`, `$time`, `$lib`, `$lib_version` — SDK
  bookkeeping

These come from PostHog's `posthog-js` and are not configured by us. If
you want to know what each one means, the
[PostHog autocapture docs](https://posthog.com/docs/data/autocapture)
list them in full.

**GeoIP enrichment (server-side at PostHog):**

We have **Discard client IP data** turned on for our PostHog project.
This means PostHog does **not** store the request IP alongside the
event. However, the IP is still used at ingestion time — before it is
discarded — to derive coarse geographic properties. Each event in
PostHog therefore includes:

- `$geoip_country_code`, `$geoip_country_name`, `$geoip_continent_code`,
  `$geoip_continent_name`
- `$geoip_subdivision_1_code`, `$geoip_subdivision_1_name` (state /
  province)
- `$geoip_city_name`
- `$geoip_postal_code`
- `$geoip_latitude`, `$geoip_longitude`, `$geoip_accuracy_radius`
- `$geoip_time_zone`

The accuracy is roughly city-level. The raw IP is **not** retained.
PostHog only supports discarding the IP after enrichment — they don't
offer an option to skip GeoIP enrichment entirely. If even city-level
geography is unacceptable to you, leave telemetry off — that is the
supported privacy mode.

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

**When telemetry is hard-disabled, regardless of the toggle:**

- Development builds. Our own development sessions never appear in
  PostHog.

## Presence

Sent in both `presence` and `full` modes. This is the single source of
DAU truth — PostHog defines a Daily Active User as a `distinct_id` with
at least one `$pageview` event in the day, so the heartbeat **has to be
a `$pageview`** (not a custom event) for presence-only users to count.

| Event       | Source | When                                                                                              | Extra props                                                                         |
| ----------- | ------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `$pageview` | main   | Once per process lifetime, the first time the active mode flips from `off` to either non-off mode | `$current_url: "argus:///"`, `$pathname: "/"`, `app_version`, `source: "heartbeat"` |

The heartbeat deliberately **bypasses `baseProps()`** — no platform,
arch, OS release, Electron or Node version is attached. The only
property beyond the `$pageview` magic keys is `app_version`, kept so we
can answer "are old builds still in the wild?" without learning
anything else about the device. The `source: "heartbeat"` property lets
analytics distinguish the main-process heartbeat from the
renderer-route `$pageview` events that `full` users also emit.

## Lifecycle

Sent only in `full` mode.

| Event                | Source   | When                                                                      | Extra props                                         |
| -------------------- | -------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| `app_launched`       | main     | Telemetry transitions off → on (first opt-in, or re-enable after opt-out) | —                                                   |
| `app_quit`           | main     | App is quitting                                                           | —                                                   |
| `renderer_started`   | renderer | Each renderer (main window or popout) finishes booting                    | `popout: "main" \| string`                          |
| `$pageview`          | renderer | The renderer URL changes (initial mount + every navigation)               | `$pathname`, `$current_url` — both sanitised, see ↓ |
| `telemetry_enabled`  | main     | User opts in                                                              | —                                                   |
| `telemetry_disabled` | main     | User opts out (sent before the off-flip + flush)                          | —                                                   |

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

| Event             | Source | When                     | Extra props                                                                                 |
| ----------------- | ------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| `session_created` | main   | A new session is created | `has_explicit_branch`, `has_description`, `use_existing_branch`, `has_explicit_base_branch` |
| `session_deleted` | main   | A session is deleted     | `kind` (`worktree` \| `project_root`), `delete_branch`                                      |

## Merges

`session_merge_*` covers the merge flow. `phase` distinguishes the
initial attempt from a `continue` after the user resolved conflicts.

| Event                    | Source | When                             | Extra props                                     |
| ------------------------ | ------ | -------------------------------- | ----------------------------------------------- |
| `session_merged`         | main   | Merge completed cleanly          | `phase: "attempt" \| "continue"`                |
| `session_merge_conflict` | main   | Merge stopped on conflicts       | `phase`, `conflicting_files` (count, not paths) |
| `session_merge_aborted`  | main   | An in-progress merge was aborted | `kind: "rebase" \| "merge"`                     |

## Agents

| Event               | Source | When                                  | Extra props                                                                   |
| ------------------- | ------ | ------------------------------------- | ----------------------------------------------------------------------------- |
| `agent_started`     | main   | A new agent is started                | `has_model`, `has_resume_id`, `has_parent`, `permission_mode`, `session_kind` |
| `agent_restored`    | main   | Conversation restored at a prior turn | `keep_turn_number`, `is_fresh_start`                                          |
| `agent_exited`      | main   | The agent process exited              | `exit_code`, `success`, `turns_completed`, `tool_uses`, `duration_ms`         |
| `agent_stopped`     | main   | The agent was stopped                 | —                                                                             |
| `agent_interrupted` | main   | The agent was interrupted             | —                                                                             |

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
