# Telemetry events

Catalog of every event Argus sends to PostHog. Anonymous distinct id only — see [`app-settings.md`](app-settings.md) for the privacy contract.

Two sources: **main** (`electron/services/telemetry/telemetry.ts` via `posthog-node`) and **renderer** (`app/lib/telemetry.ts` via `posthog-js`). Renderer events can also be forwarded through the `telemetry_capture` IPC when something in the renderer wants the main-process channel (survives renderer death).

## Base properties

Attached to every event automatically.

**Main** (`baseProps()` in `electron/services/telemetry/telemetry.ts`):

- `app_version`, `is_packaged`, `platform`, `arch`, `os_release`, `electron_version`, `node_version`

**Renderer** (registered in `posthog.init` `loaded` callback):

- `app_version`, `platform`, `process: "renderer"`

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
