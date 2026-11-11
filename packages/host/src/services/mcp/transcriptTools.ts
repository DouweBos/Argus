/**
 * `read_agent_transcript`: another agent's conversation, plus the Agent-tool
 * subagents it ran, which otherwise never show up in it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appState } from "../../state";
import { readConversation } from "../agent/conversation/live";
import {
  listSubagents,
  readSubagent,
  subagentsDir,
} from "../agent/subagentTranscripts";
import { capture } from "../telemetry/telemetry";

/**
 * Argus `spawn_agent` ids are UUIDs (`crypto.randomUUID()`); the built-in
 * `Agent` tool's background subagents (local_agents) use a dash-less `a…` hex
 * id. When an unknown id looks like the latter, return an explanatory hint so
 * the caller reaches for the right API instead of a bare "not found".
 */
export function localAgentHint(agentId: string): string | null {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      agentId,
    );
  if (isUuid) {
    return null;
  }

  return (
    `\`${agentId}\` is not an Argus \`spawn_agent\` agent. It looks like a ` +
    `background Agent-tool subagent (local_agent), which Argus doesn't track — ` +
    `use the \`Agent\` tool's returned result or \`TaskOutput\` to read its final report, ` +
    `or \`read_agent_transcript\` with the parent agent's id and \`subagent: "${agentId}"\`.`
  );
}

export interface SliceOptions {
  tail_messages?: number;
  head_messages?: number;
  offset?: number;
  limit?: number;
}

/** Half-open `[start, end)` of the messages to return. */
export function sliceWindow(
  total: number,
  { tail_messages, head_messages, offset, limit }: SliceOptions,
): [number, number] {
  if (offset !== undefined) {
    const start =
      offset < 0 ? Math.max(0, total + offset) : Math.min(offset, total);

    return [
      start,
      limit === undefined ? total : Math.min(total, start + Math.max(0, limit)),
    ];
  }
  if (head_messages !== undefined) {
    return [0, Math.min(total, head_messages)];
  }
  const tail = tail_messages === undefined ? 50 : Math.max(0, tail_messages);

  return [tail > 0 && total > tail ? total - tail : 0, total];
}

function json(value: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export function registerTranscriptTools(server: McpServer): void {
  server.tool(
    "read_agent_transcript",
    "Read the conversation transcript of another agent — the messages it sent and received, including its tool calls and their outputs. Use this to review what a child agent actually did before merging or to debug why a child got stuck. Returns the live in-memory snapshot while the agent's conversation is loaded. `get_agent_result` only returns the final summary; this returns the full conversation. For long sessions, use `tail_messages`, `head_messages`, or `offset`+`limit` to pull a subset into your own context. The response includes `total_messages`, `start_index`, and `end_index` (half-open, end-exclusive) so you can paginate across follow-up calls. Work the agent delegated to Agent-tool subagents (often in the background) is not in its own messages: the response lists them under `subagents` (description, time range, tool-call counts) — pass one's `id` as `subagent` to page through its transcript the same way.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
      subagent: z
        .string()
        .optional()
        .describe(
          "Read this Agent-tool subagent of the agent instead (an `id` from `subagents`). Slicing params apply to its messages.",
        ),
      tail_messages: z
        .number()
        .int()
        .optional()
        .describe(
          "Return only the last N messages. Defaults to 50 when no other slicing param is given. Pass 0 for the full transcript. Ignored if `head_messages` or `offset` is set.",
        ),
      head_messages: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Return only the first N messages of the conversation. Useful for inspecting the initial prompt and early planning steps. Ignored if `offset` is set.",
        ),
      offset: z
        .number()
        .int()
        .optional()
        .describe(
          "Start index of the slice to return. 0 is the first message. Negative values count from the end (e.g. -20 starts 20 messages before the end). Combine with `limit` to page through the transcript.",
        ),
      limit: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Maximum number of messages to return starting from `offset`. Defaults to all messages from `offset` onward. Only used when `offset` is set.",
        ),
    },
    ({ agent_id, subagent, ...slice }) => {
      let conv: { messages?: unknown[]; title?: string; sessionId?: string };
      try {
        const read = readConversation(agent_id);
        if (!read) {
          return json(
            appState.agents.has(agent_id)
              ? `Agent ${agent_id} has not published a transcript snapshot yet — wait for it to produce messages and try again, or open its tab in the UI.`
              : (localAgentHint(agent_id) ??
                  `No transcript available for agent ${agent_id}. The agent has stopped and its in-memory snapshot was released; use \`get_agent_result\` for the final result summary instead.`),
            true,
          );
        }
        conv = read;
      } catch {
        return json(
          `Failed to parse transcript snapshot for agent ${agent_id}.`,
          true,
        );
      }

      const agentSession = appState.agents.get(agent_id);
      const sessionMeta = agentSession
        ? appState.sessions.get(agentSession.sessionId)
        : undefined;
      const dir = conv.sessionId
        ? subagentsDir(sessionMeta?.path ?? null, conv.sessionId)
        : null;
      const header = {
        agent_id,
        session_id: agentSession?.sessionId ?? null,
        branch: sessionMeta?.branch ?? null,
        title: conv.title ?? null,
      };

      if (subagent) {
        const messages = readSubagent(dir, subagent);
        if (!messages) {
          return json(
            `Agent ${agent_id} has no subagent "${subagent}". Read the transcript without \`subagent\` to list them.`,
            true,
          );
        }
        capture("agent_transcript_read", {
          has_subagents: true,
          target: "subagent",
        });
        const [start, end] = sliceWindow(messages.length, slice);

        return json({
          ...header,
          subagent: listSubagents(dir).find(
            (s) => s.id === subagent.replace(/^agent-/, ""),
          ),
          total_messages: messages.length,
          start_index: start,
          end_index: end,
          returned_messages: end - start,
          messages: messages.slice(start, end),
        });
      }

      const messages = Array.isArray(conv.messages) ? conv.messages : [];
      const [start, end] = sliceWindow(messages.length, slice);
      const subagents = listSubagents(dir);
      capture("agent_transcript_read", {
        has_subagents: subagents.length > 0,
        target: "agent",
      });

      return json({
        ...header,
        total_messages: messages.length,
        start_index: start,
        end_index: end,
        returned_messages: end - start,
        messages: messages.slice(start, end),
        subagents,
      });
    },
  );
}
