/**
 * Every event the web client sends, with its props — the browser's twin of
 * `packages/host/src/telemetryEvents.ts` and the iOS `TelemetryEvent`, with
 * the same guarantee: wrong props don't compile. Documented in
 * `docs/telemetry-events.md` (Web client), which `telemetryDocs.test.ts`
 * holds this file to.
 *
 * Only what the computer can't see: it already captures `agent_started`,
 * `session_created`, `session_merged` and the rest when this client asks.
 */

import type { ResultBucket } from "@argus/client-core";

/** Which bundle is running: served by the computer, or the hosted app. */
export type WebBuild = "hosted" | "network";

/** How long something lasted, never the exact duration. */
export type DurationBucket = "<10s" | "10s-1m" | "1m-10m" | "10m-1h" | "1h+";

/** Where a launch URL came from. */
export type LinkSource = "link" | "notification";

/** Where a file was opened from; `link` is a URL straight to it. */
export type FileViewSource = "changes" | "link" | "quick_open" | "search";

/** The palette (Cmd/Ctrl+P) or the session's Files screen. */
export type QuickOpenVia = "screen" | "shortcut";

/** Where the design viewer was opened from; `link` is a URL straight to it. */
export type DesignOpenSource = "issue" | "session";

export type TerminalKind = "run" | "setup" | "shell";
/** How an inbox proposal was answered. */
export type ProposalAction =
  | "accept"
  | "cleanup"
  | "dismiss"
  | "request_revision"
  | "resolve";

/** What was done to a run. */
export type RunAction =
  | "cancel"
  | "delete"
  | "feedback"
  | "mark_read"
  | "save_scratch"
  | "start"
  | "start_scratch";

/** What was done to an automation's definition. */
export type AutomationAction =
  | "create"
  | "delete"
  | "describe"
  | "disable"
  | "enable"
  | "regenerate"
  | "revise_playbook"
  | "save";

export type ClaudeAccountAction =
  | "add"
  | "reauth"
  | "remove"
  | "rename"
  | "select";

export interface EventMap {
  web_launched: { build: WebBuild; paired: boolean };
  web_paired: { has_control: boolean };
  web_pair_failed: { reason: "invalid_code" | "failed" };
  web_link_opened: { screen: string; via: LinkSource; fallback: boolean };
  web_connection_lost: { connected_bucket: DurationBucket };
  web_reconnected: { offline_bucket: DurationBucket };
  web_host_switched: { computer_count: number };
  web_file_viewed: { source: FileViewSource; language: string };
  web_quick_open_used: { via: QuickOpenVia; picked: boolean };
  web_file_search_run: {
    regex: boolean;
    result_bucket: ResultBucket;
    truncated: boolean;
  };
  web_terminal_viewed: { kind: TerminalKind; live: boolean };
  web_agent_start_submitted: {
    workspace: "current" | "existing" | "worktree";
    changed_workspace: boolean;
    has_images: boolean;
    effort_set: boolean;
  };
  web_message_action: {
    action: "copy" | "edit" | "fork_agent" | "fork_session";
    role: "assistant" | "user";
    success: boolean;
  };
  web_chat_history_used: { action: "delete" | "search" };
  web_transcript_work_log_opened: { working: boolean };
  web_mcp_servers_opened: undefined;
  web_proposal_handled: { action: ProposalAction };
  web_proposal_opened: undefined;
  web_run_acted: { action: RunAction };
  web_automation_edited: { action: AutomationAction };
  web_memory_edited: { action: "delete" | "save" };
  web_app_error: { scope: string; message: string };
  web_host_feature_unsupported: { method: string };
  web_notifications_opened: { count: number };
  web_notifications_cleared: { scope: "all" | "one" };
  web_claude_account_changed: { action: ClaudeAccountAction };
  web_claude_sign_in_code_submitted: { success: boolean };
  web_default_changed: {
    setting: "autonomy" | "permission_mode";
    value: string;
  };
  web_appearance_changed: { appearance: "dark" | "light" | "system" };
  web_color_theme_changed: { theme: string };
  web_design_opened: { source: DesignOpenSource | "link" };
  web_eas_session_start_prompted: { outcome: "cancelled" | "confirmed" };
  web_browser_viewed: { streaming: boolean };
  web_issue_searched: { results_bucket: "0" | "1-5" | "6-20" | "21+" };
  web_issue_filter_changed: {
    action: "add" | "clear" | "flip" | "remove";
    field: string;
  };
  web_issue_start_submitted: {
    issue_count: number;
    changed_project: boolean;
    has_prompt: boolean;
  };
  telemetry_enabled: undefined;
  telemetry_disabled: undefined;
}

export type EventName = keyof EventMap;

export function durationBucket(ms: number): DurationBucket {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 60_000) {
    return "10s-1m";
  }
  if (ms < 600_000) {
    return "1m-10m";
  }

  return ms < 3_600_000 ? "10m-1h" : "1h+";
}
