/**
 * Typed catalog of every telemetry event Argus sends to PostHog.
 *
 * Adding a new event:
 *   1. Add a row to {@link EventMap} below.
 *   2. Document it in `docs/telemetry-events.md`.
 *   3. Call `capture("event_name", { ... })` from the host service that does
 *      the work.
 *
 * Mismatched names or props now fail typecheck instead of silently shipping
 * to PostHog with the wrong shape.
 *
 * Two events bypass this catalog because they have bespoke prop schemas
 * (PostHog magic keys, $set_once, scrubbed stack traces): `$exception` is sent
 * via `captureException`, `user_feedback` via `captureFeedback`. Don't add
 * them here.
 */

// Inlined rather than imported so this module stays a dependency-free leaf.
type SessionKind =
  | "automation_host"
  | "project_root"
  | "scratch_pad"
  | "worktree";
type MergePhase = "attempt" | "continue";
/** Mirrors `EasFailure` in `services/deviceHosts/eas/credential.ts`. */
type EasFailure =
  | "api"
  | "auth_rejected"
  | "cancelled"
  | "invalid_credential"
  | "ledger"
  | "limit"
  | "network"
  | "no_app"
  | "no_credential"
  | "not_enabled"
  | "session_ended"
  | "stream"
  | "timeout";
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
 * `agent_*`, `app_*`, `feedback_*`, `onboarding_*`, `session_*`,
 * `telemetry_*`.
 */
/** Built-in runners by id; a user's own runner is just `custom`. */
export const TELEMETRY_RUNNERS = [
  "claude-code",
  "codex",
  "gemini",
  "antigravity",
  "kiro",
  "opencode",
  "cursor",
  "grok",
  "fx",
] as const;
/** What asked for a project's session list: an app, an agent's `refresh_sessions`, or a tool that didn't recognise a session. */
export type SessionListTrigger = "listing" | "mcp_lookup" | "mcp_refresh";

export type TelemetryRunner = (typeof TELEMETRY_RUNNERS)[number] | "custom";

export interface EventMap {
  account_join_resolved: {
    action: "approved" | "denied";
    approver: "host";
    subject: "device" | "host";
    surface: "app" | "server_tray" | "terminal";
  };
  account_link_failed: {
    stage:
      | "claim_timeout"
      | "denied"
      | "network"
      | "sas_rejected"
      | "start"
      | "verify";
  };
  account_link_started: {
    surface: "cli" | "electron" | "mac" | "menubar" | "paired" | "server_tray";
  };
  account_linked: {
    first_member: boolean;
    kind: "computer" | "host";
    via: "app" | "browser" | "host" | "local" | "paired";
  };
  account_log_rejected: {
    reason:
      | "bad_signature"
      | "fork"
      | "malformed"
      | "sas_mismatch"
      | "unknown_signer"
      | "web_approver";
  };
  account_member_renamed: { role: "device" | "host" };
  account_member_revoked: {
    role: "device" | "host";
    source: "local" | "log" | "sync";
  };
  account_reset_seen: { action: "dismissed" | "unlinked" };
  account_push_sent: {
    outcome: "delivered" | "failed" | "refused" | "unregistered";
  };
  account_tunnel_switched: {
    on: boolean;
    surface: "server_tray" | "terminal";
  };
  /** The Stop gate sent an agent back to re-verify; fires once the block resolves. */
  agent_done_gate: {
    /** It gathered new evidence before stopping again. */
    reverified: boolean;
  };
  agent_exited: {
    duration_ms: number;
    exit_code: number;
    success: boolean;
    tool_uses: number;
    turns_completed: number;
  };
  agent_interrupted: undefined;
  /** An agent without HTTP MCP started; its HTTP servers went over the stdio bridge. */
  agent_mcp_bridged: {
    /** `unavailable`: no bridge script was found, so the servers were skipped. */
    outcome: "bridged" | "unavailable";
    runner: TelemetryRunner;
    servers: number;
  };
  agent_pinned: {
    action: "pin" | "unpin";
    /** A live agent, or a saved chat whose agent is gone. */
    target: "agent" | "saved_chat";
    /** The desktop's IPC, or a gateway client (phone, Mac app, web). */
    via: "ipc" | "remote";
  };
  agents_auto_resumed: {
    pinned_count: number;
    resumed_count: number;
    /** Unpinned because their session or worktree was gone. */
    missing_count: number;
    failed_count: number;
  };
  agent_restored: {
    is_fresh_start: boolean;
    keep_turn_number: number;
  };
  agent_side_question: {
    /** The agent was mid-turn when asked. */
    agent_busy: boolean;
    duration_bucket: "<10s" | "10-30s" | "30-90s" | "90s+";
    success: boolean;
  };
  agent_started: {
    has_model: boolean;
    has_parent: boolean;
    has_resume_id: boolean;
    permission_mode: string;
    session_kind: SessionKind;
    /** Took the session's warm spare instead of spawning. */
    warm: boolean;
    /** Its prompt, and its subagents', carry the conductor guide. */
    conductor_guide: boolean;
    /** Its prompt carries the Linear / Figma tools section (an integration is connected). */
    integrations_guide: boolean;
    /** Devices its spawner handed it (`spawn_agent` `devices`); 0 for a warm spare. */
    attached_device_count: number;
    /** Related projects (and their run commands) its prompt lists. */
    related_project_count: number;
    /** Its spawner turned device control off for it (`tools.disabled`). */
    device_control_off: boolean;
    /** The harness it runs on; a user's own runner is just `custom`. */
    runner: TelemetryRunner;
  };
  /** A spawn was refused because the runner's CLI isn't installed. */
  runner_unavailable: {
    runner: TelemetryRunner;
  };
  runner_setup: {
    runner: TelemetryRunner;
    step: "install" | "login";
    outcome: "failed" | "opened_page" | "succeeded";
  };
  spare_discarded: {
    reason:
      | "account"
      | "config"
      | "evicted"
      | "exited"
      | "idle"
      | "runner"
      | "session";
  };
  spare_failed: undefined;
  agent_account_switched: {
    had_history: boolean;
    queued: boolean;
    after_limit: boolean;
    source: "limit_card" | "picker";
    success: boolean;
  };
  agent_continued_on_runner: {
    from_runner: TelemetryRunner;
    to_runner: TelemetryRunner;
    after_limit: boolean;
    source: "limit_card" | "menu";
    /** `mcp`: a lean seed plus the transcript tool; `inline`: a larger seed only. */
    seed: "inline" | "mcp";
    native: boolean;
    success: boolean;
  };
  agent_limit_auto_continue: {
    action: "cancelled" | "dismissed" | "gave_up" | "scheduled" | "sent";
    has_reset_time: boolean;
  };
  agent_nudged: { critical: boolean; tagged: boolean };
  agent_stopped: undefined;
  agent_transcript_read: {
    has_subagents: boolean;
    target: "agent" | "subagent";
  };
  app_error: { message: string; scope: string };
  app_launched: undefined;
  app_quit: undefined;
  automation_extra_instructions_changed: { has_instructions: boolean };
  automation_once_fired: {
    outcome: "caught_up" | "missed" | "overlap" | "ran";
  };
  automation_run_started: {
    /** `none` unpinned; otherwise whether the pinned account could run it. */
    account_pin: "missing" | "none" | "ok" | "reauth";
  };
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
    skipped_bucket: "0" | "1-5" | "6-20" | "21-100" | "100+";
    trigger: "boot" | "interval" | "manual" | "project_added";
  };
  cli_projects_imported: { count: number; source: "dialog" | "onboarding" };
  cli_projects_scanned: {
    source: "dialog" | "onboarding";
    candidate_bucket: "0" | "1-5" | "6-20" | "21-100" | "100+";
    truncated: boolean;
  };
  color_theme_changed: {
    theme: "amber" | "ember" | "grove" | "iris" | "muted" | "ocean" | "rose";
  };
  conductor_config_imported: {
    format: "conductor_json" | "settings_toml";
    has_setup: boolean;
    note_count: number;
    run_count: number;
  };
  design_compared: {
    diff_bucket: "<2%" | "<10%" | "<30%" | ">=30%";
    matched: boolean;
    mode: "component" | "screen";
    source: "agent" | "app";
  };
  device_host_added: { has_identity_file: boolean; has_port: boolean };
  device_host_removed: undefined;
  device_name_changed: {
    source: "account_list" | "server_tray" | "settings" | "terminal";
    linked: boolean;
  };
  device_host_tested: {
    failure:
      | "auth"
      | "host_key"
      | "invalid_config"
      | "no_xcode"
      | "none"
      | "not_macos"
      | "timeout"
      | "unknown"
      | "unreachable"
      | "unsupported_arch";
    success: boolean;
  };
  eas_account_checked: {
    credential_source: "eas-login" | "env" | "none" | "settings";
    failure: EasFailure | "none";
    success: boolean;
  };
  eas_device_host_added: { has_app_id: boolean; has_token: boolean };
  eas_device_host_removed: {
    left_outstanding: boolean;
    running_sessions: number;
  };
  eas_session_ended: {
    duration_bucket: "<10m" | "<30m" | "<60m" | ">=60m" | "unknown";
    reason: "closed" | "expired" | "host_removed" | "leftover" | "shutdown";
  };
  eas_session_start_failed: { reason: EasFailure };
  eas_session_started: { wait_bucket: "<1m" | "<3m" | "<10m" | ">=10m" };
  follow_ups_suggested: { count: number; success: boolean };
  host_heap_sampled: {
    agents: number;
    heap_limit_bucket: "<25%" | "<50%" | "<75%" | ">=75%";
    heap_used_bucket: "<1GB" | "<2GB" | "<4GB" | "<256MB" | ">=4GB";
    mcp_sessions: number;
    uptime_bucket: "<1d" | "<3d" | "<6h" | ">=3d";
  };
  integration_connected: {
    method: "key" | "oauth";
    service: "figma" | "linear";
    success: boolean;
  };
  integration_reauth_needed: { service: "figma" | "linear" };
  issue_designs_resolved: {
    failed: number;
    resolved: number;
    skipped: number;
  };
  issue_filed_from_device: { has_screenshot: boolean };
  issue_report_posted: { has_screenshots: boolean; trigger: "merge" | "pr" };
  linear_issue_updated: { field: "comment" | "priority" | "status" };
  /** Mirrors `LegacyTunnelKind` in `services/remote/legacyTunnels.ts`. */
  legacy_tunnel_retired: {
    kind: "cloudflare_quick" | "cloudflare_token" | "tailscale_funnel";
    reason: "managed" | "user";
  };
  limit_handoff_offered: { eligible_count_bucket: "1" | "2" | "3+" };
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
  managed_tunnel_failed: {
    stage: "connect" | "credentials" | "install" | "unavailable";
  };
  managed_tunnel_started: {
    created: boolean;
    install: "downloaded" | "managed" | "override" | "path";
  };
  mcp_task_finished: {
    /** `task`: the client took a task handle and moved on; `blocking`: it waited in the call. */
    mode: "blocking" | "task";
    /** `cancelled`: the client cancelled the task or disconnected before it finished. */
    outcome: "cancelled" | "completed" | "failed";
    tool:
      | "complete_session"
      | "merge_session"
      | "wait_for_agent"
      | "wait_for_any_agent"
      | "wait_for_terminal";
  };
  onboarding_completed: undefined;
  pr_watch_ended: {
    reason: "closed" | "merged" | "session_deleted" | "stopped";
    wakes_bucket: "0" | "1" | "2-5" | "6+";
  };
  pr_watch_toggled: {
    action: "start" | "stop";
    via: "mcp" | "ui";
    success: boolean;
  };
  pr_watch_woke: {
    check_failed: boolean;
    checks_passed: boolean;
    comment: boolean;
    conflict: boolean;
    outcome: "no_agent" | "queued" | "sent";
  };
  proposal_start_failed: {
    stage: "creating_worktree" | "setting_up" | "starting_agent";
  };
  queued_message_sent_now: { mid_turn: boolean };
  remote_connection_opened: {
    trust: "account" | "paired";
    hosted_web: boolean;
  };
  remote_device_watched: { success: boolean };
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
  session_adopted: {
    origin: "claude_code" | "conductor" | "other";
    setup_pending: boolean;
    trigger: SessionListTrigger;
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
    /** A worktree made outside Argus whose setup never ran, not a failed one. */
    pending: boolean;
    success: boolean;
  };
  session_started_from_issue: { source: "linear" };
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
  simulator_remote_stream_ended: {
    adaptive: boolean;
    downshifts_bucket: "0" | "1-2" | "3-10" | "10+";
    duration_bucket: "<1m" | "<10m" | "<10s" | ">=10m";
    lowest_level: "full" | "high" | "low" | "medium";
    platform: "android" | "ios";
  };
  simulator_repaired: { action: "delete" | "erase"; success: boolean };
  telemetry_disabled: undefined;
  terminal_stopped: {
    source: "mcp" | "rerun" | "ui";
    /** The signal that finished it; `SIGKILL` means it ignored the gentler ones. */
    step: "SIGINT" | "SIGKILL" | "SIGTERM";
    /** False when processes outlived SIGKILL. */
    stopped: boolean;
  };
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
