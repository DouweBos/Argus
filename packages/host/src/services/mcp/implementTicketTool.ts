/**
 * `implement_ticket`: start Argus's `/implement-ticket` loop from an agent,
 * in a new agent or an idle one, through the same paths as `spawn_agent` and
 * `send_agent_message`.
 */

import type { ToolId } from "../tools/types";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult as ToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { appState } from "../../state";
import { implementTicketMessage } from "../agent/argusCommands";
import {
  devicesArg,
  modelArg,
  permissionModeArg,
  sessionProjectPathArg,
  toolsArg,
} from "./spawnArgs";

export interface ImplementTicketDeps {
  /** `spawn_agent` with the command as its prompt. */
  spawn: (args: {
    session: string;
    project_path: string;
    prompt: string;
    model?: string;
    permission_mode?: z.infer<typeof permissionModeArg>;
    devices?: string[];
    tools?: { disabled?: ToolId[] };
  }) => Promise<ToolResult>;
  /** `send_agent_message` with the command as its message. */
  send: (args: { agent_id: string; message: string }) => ToolResult;
}

function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function registerImplementTicketTool(
  server: McpServer,
  deps: ImplementTicketDeps,
): void {
  server.tool(
    "implement_ticket",
    "Run Argus's verified ticket loop (`/implement-ticket`) on a Linear issue: the agent reads the ticket and its linked Figma frames, implements it, verifies every acceptance criterion on device after its last code change, runs the project's verify checks, and reports with evidence. Use it instead of `spawn_agent` whenever the work is a Linear ticket that should be proven done; use `spawn_agent` for anything else.",
    {
      ticket: z
        .string()
        .describe("The Linear issue: its identifier (`ENG-123`) or URL."),
      notes: z
        .string()
        .optional()
        .describe(
          "Extra instructions for the agent, appended after the ticket like text typed after `/implement-ticket ENG-123`.",
        ),
      session: z
        .string()
        .optional()
        .describe(
          'Start a new agent in this session: `"current"`, `"root"`, a session ID, branch or display name, as for `spawn_agent`. Pass this or `agent_id`, not both.',
        ),
      agent_id: z
        .string()
        .optional()
        .describe(
          "Send the command to this existing, idle agent instead of starting one. Pass this or `session`, not both.",
        ),
      project_path: sessionProjectPathArg,
      model: modelArg,
      permission_mode: permissionModeArg,
      devices: devicesArg,
      tools: toolsArg,
    },
    async ({
      ticket,
      notes,
      session,
      agent_id,
      project_path,
      model,
      permission_mode,
      devices,
      tools,
    }) => {
      const id = ticket.trim();
      if (!id || /\s/.test(id)) {
        return fail(
          "Pass one Linear issue identifier (ENG-123) or URL as `ticket`.",
        );
      }
      if (Boolean(session) === Boolean(agent_id)) {
        return fail(
          "Pass exactly one of `session` (start a new agent there) or `agent_id` (an idle agent).",
        );
      }
      const message = implementTicketMessage(id, notes ?? "");

      if (session) {
        return deps.spawn({
          session,
          project_path,
          prompt: message,
          model,
          permission_mode,
          devices,
          tools,
        });
      }

      const agentId = agent_id!;
      if (model || permission_mode || devices || tools) {
        return fail(
          "`model`, `permission_mode`, `devices` and `tools` only apply to a new agent: pass `session` instead of `agent_id`.",
        );
      }
      const agent = appState.agents.get(agentId);
      if (!agent) {
        return fail(`No agent found: ${agentId}`);
      }
      const ws = appState.sessions.get(agent.sessionId);
      if (ws && ws.repo_root !== project_path) {
        return fail(
          `Agent ${agentId} belongs to project ${ws.repo_root}, not ${project_path}.`,
        );
      }
      if (agent.status !== "idle") {
        return fail(
          `Agent ${agentId} is ${agent.status}, not idle. Wait for it with \`wait_for_agent\`, or start a new agent with \`session\`.`,
        );
      }
      const sent = deps.send({ agent_id: agentId, message });
      if (sent.isError) {
        return sent;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                agent_id: agentId,
                session_id: agent.sessionId,
                branch: ws?.branch,
                status: "running",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
