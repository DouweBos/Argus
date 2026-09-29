/**
 * Finding agents that are no longer running, so an orchestrator can resume
 * its children after a crash or restart. Backed by the chat history index —
 * the only record of an agent that outlives the process.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appState } from "../../state";
import { type ChatHistoryEntry, loadHistoryIndex } from "../agent/chatHistory";

function isLive(agentId: string | undefined): boolean {
  const agent = agentId ? appState.agents.get(agentId) : undefined;

  return !!agent && agent.status !== "stopped" && agent.status !== "error";
}

/** A past agent by its old agent id or its runner session id. */
export function findPastAgent(
  repoRoot: string,
  ref: string,
): ChatHistoryEntry | null {
  return (
    loadHistoryIndex(repoRoot).find(
      (e) => e.agentId === ref || e.sessionId === ref,
    ) ?? null
  );
}

export function registerPastAgentTools(server: McpServer): void {
  server.tool(
    "list_past_agents",
    "List agents in a project that are no longer running — stopped, finished, or lost to an app crash or restart — newest first. Use it to pick up where an earlier orchestration left off: find the children you (or a previous instance of you) spawned, inspect their session with `list_session_changes`/`session_diff`, then continue one with `spawn_agent` + `resume`, which restores its full conversation. Agents still running are excluded (see `list_agents`). Records only exist when the project saves chat history; agents that never finished a message are absent.",
    {
      project_path: z
        .string()
        .describe(
          "Absolute path to the project root. Use the project_path from your system prompt.",
        ),
      parent_agent_id: z
        .string()
        .optional()
        .describe(
          "Only agents spawned by this agent id. A resumed orchestrator has a new id — pass its previous one, as seen in its earlier spawn_agent results.",
        ),
      session: z
        .string()
        .optional()
        .describe("Only agents that ran in this session ID or branch name."),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Maximum entries to return (default 30)."),
    },
    async ({ project_path, parent_agent_id, session, limit }) => {
      const entries = loadHistoryIndex(project_path)
        .filter((e) => !isLive(e.agentId))
        .filter((e) => !parent_agent_id || e.parentAgentId === parent_agent_id)
        .filter(
          (e) =>
            !session ||
            e.argusSessionId === session ||
            e.sessionBranch === session,
        )
        .slice(0, limit ?? 30)
        .map((e) => {
          const argusSession = e.argusSessionId
            ? appState.sessions.get(e.argusSessionId)
            : [...appState.sessions.values()].find(
                (s) =>
                  s.repo_root === project_path && s.branch === e.sessionBranch,
              );

          return {
            agent_id: e.agentId,
            resume: e.agentId ?? e.sessionId,
            title: e.title,
            parent_agent_id: e.parentAgentId,
            session_id: argusSession?.id ?? e.argusSessionId,
            branch: e.sessionBranch,
            session_exists: !!argusSession,
            model: e.model,
            message_count: e.messageCount,
            last_active_at: new Date(e.endedAt).toISOString(),
          };
        });

      return {
        content: [
          {
            type: "text" as const,
            text:
              entries.length > 0
                ? JSON.stringify(entries, null, 2)
                : "No past agents found.",
          },
        ],
      };
    },
  );
}
