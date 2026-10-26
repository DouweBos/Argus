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
type LspLanguage =
  | "c"
  | "css"
  | "go"
  | "html"
  | "json"
  | "kotlin"
  | "python"
  | "ruby"
  | "rust"
  | "swift"
  | "typescript"
  | "yaml";

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
  agent_limit_auto_continue: {
    action: "cancelled" | "dismissed" | "gave_up" | "scheduled" | "sent";
    has_reset_time: boolean;
  };
  agent_nudged: { critical: boolean; tagged: boolean };
  agent_stopped: undefined;
  agent_start_submitted: {
    /** The picked workspace differs from the one the composer opened with. */
    changed_workspace: boolean;
    workspace: "current" | "worktree";
  };
  agent_transcript_paged: { success: boolean };
  agent_transcript_resynced: { new_epoch: boolean };
  app_error: { message: string; scope: string };
  app_launched: undefined;
  app_quit: undefined;
  automation_extra_instructions_changed: { has_instructions: boolean };
  automation_github_read: {
    success: boolean;
    tool: "artifact_search" | "get";
  };
  browser_devtools_requested: { available: boolean };
  claude_account_rechecked: {
    badge_cleared: boolean;
    outcome: "ok" | "rate_limited" | "reauth" | "unknown";
  };
  cli_chats_imported: {
    imported_bucket: "0" | "1-5" | "6-20" | "21-100" | "100+";
    project_count: number;
    trigger: "boot" | "interval" | "manual" | "project_added";
  };
  cli_projects_imported: { count: number };
  cli_projects_scanned: {
    candidate_bucket: "0" | "1-5" | "6-20" | "21-100" | "100+";
    truncated: boolean;
  };
  color_theme_changed: {
    theme: "amber" | "ember" | "grove" | "iris" | "ocean" | "rose";
  };
  follow_up_used: { method: "click" | "tab" };
  follow_ups_suggested: { count: number; success: boolean };
  host_lock_handover: { holder: "cli" | "electron" | "mac" };
  lsp_feature_used: {
    feature:
      | "code_action"
      | "definition"
      | "document_symbols"
      | "format"
      | "hover"
      | "references"
      | "rename"
      | "signature_help"
      | "workspace_symbols";
    language: LspLanguage;
    success: boolean;
  };
  lsp_server_crashed: { gave_up: boolean; language: LspLanguage };
  lsp_server_started: {
    duration_bucket: "<1s" | "<5s" | "<30s" | ">=30s";
    language: LspLanguage;
    /** Swift only. */
    project?: "files" | "swiftpm" | "xcode";
    source: "bundled" | "none" | "path" | "toolchain";
    success: boolean;
  };
  lsp_setup_needed: {
    language: LspLanguage;
    reason: "loose_files" | "no_build_server" | "not_built";
  };
  onboarding_completed: undefined;
  prefs_imported: { keys: number };
  proposal_start_failed: {
    stage: "creating_worktree" | "setting_up" | "starting_agent";
  };
  queued_message_sent_now: { mid_turn: boolean };
  renderer_started: { popout: string };
  secret_store_migrated: {
    outcome: "failed" | "migrated";
    store: "mcp_tokens" | "remote_devices";
  };
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
  session_setup_recovered: {
    action: "mark_ready" | "retry";
    success: boolean;
  };
  simulator_boot_failed: {
    reason:
      | "disk_full"
      | "missing_data"
      | "not_found"
      | "runtime_missing"
      | "timeout"
      | "unknown";
  };
  simulator_inspection_launched: {
    platform: "ios" | "tvos";
    outcome: "failed" | "ok" | "unavailable";
  };
  simulator_repaired: { action: "delete" | "erase"; success: boolean };
  telemetry_disabled: undefined;
  telemetry_enabled: undefined;
  usage_summary_loaded: {
    prices_available: boolean;
    range: "7d" | "24h" | "30d" | "90d";
  };
  usage_limits_fetched: {
    outcome: "failed" | "ok" | "unsupported";
    window_count: number;
  };
  worktrees_moved: {
    copied: boolean;
    duration_bucket: "<1m" | "<10m" | "<10s" | ">=10m";
    failed: number;
    moved: number;
    purpose: "automation" | "user";
  };
}

export type EventName = keyof EventMap;

/**
 * Variadic-tuple second arg: events whose props type is `undefined` are
 * called as `capture("name")`; all others require a typed props object.
 */
export type EventArgs<N extends EventName> = EventMap[N] extends undefined
  ? []
  : [props: EventMap[N]];
