/**
 * Which of Argus's MCP tools an outside client may call, by grant. Deny by
 * default: a tool missing here is never exposed, and a test fails until every
 * tool is decided.
 *
 * - monitor (read only): look at projects, sessions, agents, diffs, terminals.
 * - control (supervised): also start and message agents — always in the
 *   `default` or `plan` permission mode, so every tool use is approved in
 *   Argus — in projects Argus already has.
 * - admin (full access): also merge, delete, write files, any permission mode.
 */

import type { McpAccess } from "./store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appState } from "../../../state";

export const OUTSIDE_TOOL_ACCESS: Record<string, McpAccess | null> = {
  list_projects: "monitor",
  list_sessions: "monitor",
  refresh_sessions: "monitor",
  list_agents: "monitor",
  agent_status: "monitor",
  agent_vitals: "monitor",
  get_agent_result: "monitor",
  wait_for_agent: "monitor",
  wait_for_any_agent: "monitor",
  read_agent_transcript: "monitor",
  list_past_agents: "monitor",
  list_run_commands: "monitor",
  read_terminal: "monitor",
  wait_for_terminal: "monitor",
  check_conflicts: "monitor",
  session_diff: "monitor",
  list_session_changes: "monitor",
  read_session_file: "monitor",
  merge_status: "monitor",

  create_session: "control",
  spawn_agent: "control",
  send_agent_message: "control",
  stop_agent: "control",
  interrupt_agent: "control",
  trigger_run: "control",
  stop_terminal: "control",
  push_notification: "control",

  // No per-agent permission mode, so it would run at the app's default.
  spawn_agents_batch: "admin",
  add_related_project: "admin",
  delete_session: "admin",
  write_session_file: "admin",
  attempt_merge: "admin",
  continue_merge: "admin",
  abort_merge: "admin",
  merge_session: "admin",
  complete_session: "admin",

  // Automations' own tools, and the user's Linear, Figma and GitHub sign-ins.
  emit_proposal: null,
  emit_report: null,
  list_open_proposals: null,
  withdraw_proposal: null,
  save_memory: null,
  delete_memory: null,
  open_session_pr: null,
  github_get: null,
  search_github_artifact: null,
  watch_pull_request: null,
  linear_get_issue: null,
  linear_search_issues: null,
  linear_comment: null,
  figma_get_frame: null,
  figma_export_assets: null,
  design_compare: null,
};

const RANK: Record<McpAccess, number> = { monitor: 0, control: 1, admin: 2 };

export function allows(access: McpAccess, tool: string): boolean {
  const needs = OUTSIDE_TOOL_ACCESS[tool];

  return needs !== null && needs !== undefined && RANK[access] >= RANK[needs];
}

const SUPERVISED_MODES = new Set(["default", "plan"]);

/** Why a supervised call is refused, or null; may set `permission_mode`. */
export function supervisedBlock(
  tool: string,
  args: Record<string, unknown>,
): string | null {
  const project = args.project_path;
  if (typeof project === "string" && !appState.repoRoots.has(project)) {
    return "Supervised access only reaches projects already open in Argus.";
  }
  const attachments = args.attachments as { path?: unknown }[] | undefined;
  if (attachments?.some((a) => a.path !== undefined)) {
    return "Send attachments as data; file paths need full access.";
  }
  if (tool === "spawn_agent" || tool === "create_session") {
    const mode = args.permission_mode;
    if (mode === undefined) {
      args.permission_mode = "default";
    } else if (!SUPERVISED_MODES.has(String(mode))) {
      return "Supervised access starts agents in the default or plan permission mode only.";
    }
  }

  return null;
}

interface Registered {
  handler: unknown;
  remove: () => void;
}

/** Strip a freshly built server down to what `access` may call. */
export function restrictToAccess(server: McpServer, access: McpAccess): void {
  const tools = (
    server as unknown as { _registeredTools: Record<string, Registered> }
  )._registeredTools;
  for (const [name, tool] of Object.entries(tools)) {
    if (!allows(access, name)) {
      tool.remove();
      continue;
    }
    if (access !== "admin" && typeof tool.handler === "function") {
      const inner = tool.handler as (args: unknown, extra: unknown) => unknown;
      tool.handler = (args: unknown, extra: unknown) => {
        const blocked = supervisedBlock(
          name,
          (args ?? {}) as Record<string, unknown>,
        );
        if (blocked) {
          return { content: [{ type: "text", text: blocked }], isError: true };
        }

        return inner(args, extra);
      };
    }
  }
}
