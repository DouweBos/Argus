# Telemetry events

Catalog of every event Argus sends to PostHog when telemetry is opted in.
Telemetry is **off by default** and gated by a one-time consent step during
first-launch onboarding. See [`app-settings.md`](app-settings.md) for the
toggle and the storage details.

Two sources: **main** (`electron/services/telemetry/telemetry.ts` via
`posthog-node`) and **renderer** (`app/lib/telemetry.ts` via `posthog-js`).
Renderer events can also be forwarded through the `telemetry_capture` IPC
when something in the renderer wants the main-process channel (survives
renderer death).

## What's attached to every event

When you opt in, every event PostHog receives carries the catalogue below.
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

PostHog's ingestion pipeline derives geographic properties from the
request IP and attaches them to every event. This means the IP touches
PostHog's servers, and the resulting event in PostHog includes:

- `$geoip_country_code`, `$geoip_country_name`, `$geoip_continent_code`,
  `$geoip_continent_name`
- `$geoip_subdivision_1_code`, `$geoip_subdivision_1_name` (state /
  province)
- `$geoip_city_name`
- `$geoip_postal_code`
- `$geoip_latitude`, `$geoip_longitude`, `$geoip_accuracy_radius`
- `$geoip_time_zone`

The accuracy is roughly city-level. We do not log or persist your IP
ourselves, but PostHog's ingestion sees it. If this is unacceptable to
you, leave telemetry off — that is the supported privacy mode.

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

- Any non-packaged build (`pnpm dev`, Vite previews — anything where
  `app.isPackaged` is `false` or `import.meta.env.PROD` is `false`).
- Production builds where `VITE_POSTHOG_KEY` was not configured at
  build time.

## Lifecycle

| Event                | Source   | When                                                                      | Extra props                |
| -------------------- | -------- | ------------------------------------------------------------------------- | -------------------------- |
| `app_launched`       | main     | Telemetry transitions off → on (first opt-in, or re-enable after opt-out) | —                          |
| `app_quit`           | main     | `before-quit` in `electron/main.ts`                                       | —                          |
| `renderer_started`   | renderer | Each renderer (main window or popout) finishes booting                    | `popout: "main" \| string` |
| `telemetry_enabled`  | main     | User opts in                                                              | —                          |
| `telemetry_disabled` | main     | User opts out (sent before the off-flip + flush)                          | —                          |

## Sessions

| Event             | Source | When                                | Extra props                                                                                 |
| ----------------- | ------ | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `session_created` | main   | `createSession` accepted user input | `has_explicit_branch`, `has_description`, `use_existing_branch`, `has_explicit_base_branch` |
| `session_deleted` | main   | `deleteSession` invoked             | `kind` (`worktree` \| `org_host` \| `project_root`), `delete_branch`, `is_org_task`         |

## Merges

`session_merge_*` covers the rebase-based merge flow in `electron/services/session/merge.ts`. `phase` distinguishes the initial attempt from a `continue` after the user resolved conflicts.

| Event                    | Source | When                                                 | Extra props                                     |
| ------------------------ | ------ | ---------------------------------------------------- | ----------------------------------------------- |
| `session_merged`         | main   | Merge completed cleanly (squash + fast-forward done) | `phase: "attempt" \| "continue"`                |
| `session_merge_conflict` | main   | Rebase or merge stopped on conflicts                 | `phase`, `conflicting_files` (count, not paths) |
| `session_merge_aborted`  | main   | `abort_merge` called on an in-progress rebase/merge  | `kind: "rebase" \| "merge"`                     |

## Agents

| Event               | Source | When                                      | Extra props                                                                   |
| ------------------- | ------ | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `agent_started`     | main   | New Claude child spawned (not on respawn) | `has_model`, `has_resume_id`, `has_parent`, `permission_mode`, `session_kind` |
| `agent_restored`    | main   | Conversation restored at a prior turn     | `keep_turn_number`, `is_fresh_start`                                          |
| `agent_exited`      | main   | Child process closed                      | `exit_code`, `success`, `turns_completed`, `tool_uses`, `duration_ms`         |
| `agent_stopped`     | main   | `stopAgent` finished tearing down         | —                                                                             |
| `agent_interrupted` | main   | Interrupt control request acked           | —                                                                             |

## Org tasks

| Event              | Source | When                           | Extra props  |
| ------------------ | ------ | ------------------------------ | ------------ |
| `org_task_started` | main   | `startOrgTask` validated input | `scope_size` |

## Onboarding

| Event                  | Source | When                                      | Extra props |
| ---------------------- | ------ | ----------------------------------------- | ----------- |
| `onboarding_completed` | main   | First time `completeOnboarding` is called | —           |

## Feedback

| Event           | Source   | When                                                  | Extra props                                         |
| --------------- | -------- | ----------------------------------------------------- | --------------------------------------------------- |
| `user_feedback` | renderer | Feedback message delivered (carries the message body) | `message`, `$set_once.has_submitted_feedback: true` |

## Errors

Two channels:

- **`$exception`** — only fires on truly unhandled crashes (process gone, uncaught exception/rejection, `window.onerror`). Follows PostHog's [exception autocapture schema](https://posthog.com/docs/error-tracking).
- **`app_error`** — every `log.error(...)` call from anywhere in the app. Wired through `setErrorSink` in `app/lib/logger.ts`, so caught-and-logged errors that never reach the unhandled path still get captured. Props: `scope` (logger scope, e.g. `agent`, `session:merge`) and `message` (scrubbed, truncated to 2 KB). No automatic capture for `log.warn` / `log.info`.

Error messages and stack traces are scrubbed of `/Users/<name>`, `/home/<name>`, and `C:\Users\<name>` paths before sending.

| Source   | Trigger               | `source` prop         |
| -------- | --------------------- | --------------------- |
| main     | `render-process-gone` | `render-process-gone` |
| main     | `child-process-gone`  | `child-process-gone`  |
| main     | `uncaughtException`   | `uncaughtException`   |
| main     | `unhandledRejection`  | `unhandledRejection`  |
| renderer | `window.onerror`      | `window.onerror`      |
| renderer | `unhandledrejection`  | `unhandledrejection`  |

Common props on all `$exception` events:

- `$exception_type` — `error.name`
- `$exception_message` — scrubbed `error.message`
- `$exception_stack_trace_raw` — scrubbed `error.stack` (if present)
- `$exception_level: "error"`
- `source` — see table above
- `render-process-gone` / `child-process-gone` additionally include `reason`, `exitCode`, and (for child) `type`. The `name` field from `child-process-gone` is dropped — it can leak window titles.

## Adding a new event

1. Use `capture(name, props)` from `app/lib/telemetry.ts` (renderer) or `electron/services/telemetry/telemetry.ts` (main). Don't call `posthog.capture` directly.
2. Event names are `snake_case`. Group with a stable prefix (`feedback_`, `agent_`, `session_`).
3. Never include prompts, file contents, project/repo names, branch names, file paths, or any user-identifying string in props.
4. Add a row to the matching table above.
