/**
 * Typed catalog of every telemetry event Argus sends to PostHog.
 *
 * Adding a new event:
 *   1. Add a row to {@link EventMap} below.
 *   2. Document it in `docs/telemetry-events.md`.
 *   3. Call `capture("event_name", { ... })` from main or renderer telemetry.
 *
 * Mismatched names or props now fail typecheck instead of silently shipping
 * to PostHog with the wrong shape.
 *
 * Two events bypass this catalog because they have bespoke prop schemas
 * (PostHog magic keys, $set_once, scrubbed stack traces): `$exception` is sent
 * via `captureException`, `user_feedback` via `captureFeedback`. Don't add
 * them here.
 */

// Inlined rather than imported so this module stays usable from both the
// renderer (`app/`) and the main process (`electron/`) without dragging in
// electron-side type imports.
type SessionKind =
  | "automation_host"
  | "project_root"
  | "scratch_pad"
  | "worktree";
type MergePhase = "attempt" | "continue";
type MergeAbortKind = "merge" | "rebase";
type MergeStrategy = "keep" | "squash";

/**
 * Events are alphabetized (lint enforces this). Group by prefix when adding:
 * `agent_*`, `app_*`, `feedback_*`, `onboarding_*`, `renderer_*`,
 * `session_*`, `telemetry_*`.
 */
export interface EventMap {
  agent_exited: {
    duration_ms: number;
    exit_code: number;
    success: boolean;
    tool_uses: number;
    turns_completed: number;
  };
  agent_interrupted: undefined;
  agent_restored: {
    is_fresh_start: boolean;
    keep_turn_number: number;
  };
  agent_started: {
    has_model: boolean;
    has_parent: boolean;
    has_resume_id: boolean;
    permission_mode: string;
    session_kind: SessionKind;
  };
  agent_stopped: undefined;
  app_error: { message: string; scope: string };
  app_launched: undefined;
  app_quit: undefined;
  automation_github_read: {
    success: boolean;
    tool: "artifact_search" | "get";
  };
  claude_account_rechecked: {
    badge_cleared: boolean;
    outcome: "ok" | "rate_limited" | "reauth" | "unknown";
  };
  onboarding_completed: undefined;
  renderer_started: { popout: string };
  scratch_pad_created: { has_name: boolean };
  session_created: {
    has_description: boolean;
    has_explicit_base_branch: boolean;
    has_explicit_branch: boolean;
    use_existing_branch: boolean;
  };
  session_deleted: {
    delete_branch: boolean;
    kind: SessionKind;
  };
  session_merge_aborted: { kind: MergeAbortKind };
  session_merge_conflict: { conflicting_files: number; phase: MergePhase };
  session_merged: { phase: MergePhase; strategy: MergeStrategy };
  session_prompt_dispatched: { success: boolean };
  telemetry_disabled: undefined;
  telemetry_enabled: undefined;
}

export type EventName = keyof EventMap;

/**
 * Variadic-tuple second arg: events whose props type is `undefined` are
 * called as `capture("name")`; all others require a typed props object.
 */
export type EventArgs<N extends EventName> = EventMap[N] extends undefined
  ? []
  : [props: EventMap[N]];
