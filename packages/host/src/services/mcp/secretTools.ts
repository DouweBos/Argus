/**
 * `request_secret`: the agent asks for a token, PIN or pairing code through a
 * secure card on the user's Mac, phone or browser instead of in chat, and gets
 * back only where the value went.
 */

import type {
  ConversationMessage,
  ToolCallInfo,
} from "../agent/conversation/types";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appState } from "../../state";
import { conversationOf } from "../agent/conversation/folded";
import {
  isPendingSecretRequest,
  openSecretRequest,
} from "../secretRequest/requests";
import { isSecretRequestTool, SECRET_TOOL } from "../secretRequest/toolName";
import {
  MAX_TTL_MS,
  MIN_TTL_MS,
  setRunSecretEnv,
  writeSecretFile,
} from "../secretRequest/vault";
import { capture } from "../telemetry/telemetry";
import { resolveRunCommand } from "../terminal/multiplexer";
import { worktreePurposeForCaller } from "./automationCaller";

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const TOOL_USE_RETRIES = 20;
const TOOL_USE_RETRY_MS = 50;

export const DECLINED_RESULT =
  "The user declined to provide this secret. Do not ask for it in chat or any other way, and do not try to find it on disk. Carry on without it, or stop and say what you could not do.";

const DESCRIPTION = `Ask the user for a secret — an API token, password, PIN, OTP, or a pairing code such as \`adb pair\`'s — through a secure card in the Argus app (Mac, iPhone, web). ALWAYS use this instead of asking in chat: anything typed in chat stays in the transcript, syncs to every client, and gets copied into other agents' prompts. The value never reaches you. With \`delivery: "file"\` you get the path of an owner-only file holding it (deleted after \`ttl_minutes\`); read it where it's needed, e.g. \`adb pair host:port "$(cat <path>)"\`. With \`delivery: "env"\` it's set as \`env_var\` on one of this session's run commands next time it starts (\`trigger_run\`). Never print, echo, or log the value, and never copy it or its contents into messages, commits, files, or \`spawn_agent\` prompts — pass the path instead. Blocks until the user answers.`;

function text(body: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: body }],
    ...(isError ? { isError: true } : {}),
  };
}

function findOpenCall(
  agentId: string,
  calls: ToolCallInfo[],
): ToolCallInfo | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const tc = calls[i]!;
    const nested = (tc.children ?? []).flatMap((c) =>
      c.kind === "tool_use" ? [c.toolCall] : [],
    );
    const inner = findOpenCall(agentId, nested);
    if (inner) {
      return inner;
    }
    if (
      isSecretRequestTool(tc.name) &&
      tc.result === undefined &&
      !isPendingSecretRequest(agentId, tc.id)
    ) {
      return tc;
    }
  }

  return null;
}

/** The newest unanswered `request_secret` call, for runners that don't send its id. */
export function openSecretCall(
  agentId: string,
  messages: ConversationMessage[],
): ToolCallInfo | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const found = findOpenCall(agentId, messages[i]!.toolCalls);
    if (found) {
      return found;
    }
  }

  return null;
}

async function resolveToolCall(
  agentId: string,
  meta: Record<string, unknown> | undefined,
): Promise<{ id: string; name?: string } | null> {
  const fromMeta = meta?.["claudecode/toolUseId"];
  for (let attempt = 0; attempt < TOOL_USE_RETRIES; attempt++) {
    const messages = conversationOf(agentId).messages;
    if (typeof fromMeta === "string") {
      const call = findById(messages, fromMeta);
      if (call || attempt === TOOL_USE_RETRIES - 1) {
        return { id: fromMeta, name: call?.name };
      }
    } else {
      const call = openSecretCall(agentId, messages);
      if (call) {
        return { id: call.id, name: call.name };
      }
    }
    // The assistant message carrying the call may not be folded in yet.
    await new Promise((r) => setTimeout(r, TOOL_USE_RETRY_MS));
  }

  return null;
}

function findById(
  messages: ConversationMessage[],
  id: string,
): ToolCallInfo | null {
  const search = (calls: ToolCallInfo[]): ToolCallInfo | null => {
    for (const tc of calls) {
      if (tc.id === id) {
        return tc;
      }
      const nested = (tc.children ?? []).flatMap((c) =>
        c.kind === "tool_use" ? [c.toolCall] : [],
      );
      const found = search(nested);
      if (found) {
        return found;
      }
    }

    return null;
  };
  for (const m of messages) {
    const found = search(m.toolCalls);
    if (found) {
      return found;
    }
  }

  return null;
}

function expiryText(expiresAt: number): string {
  return new Date(expiresAt).toISOString();
}

export function registerSecretTools(
  server: McpServer,
  callerAgentId: string | null,
): void {
  server.registerTool(
    SECRET_TOOL,
    {
      description: DESCRIPTION,
      inputSchema: {
        label: z
          .string()
          .min(1)
          .max(80)
          .describe(
            "What you need, as the card's title — e.g. 'adb pairing code', 'GitHub token'.",
          ),
        reason: z
          .string()
          .min(1)
          .max(500)
          .describe(
            "Why you need it and what you'll do with it, in a sentence.",
          ),
        delivery: z
          .enum(["file", "env"])
          .default("file")
          .describe(
            "'file' (default): get back the path of an owner-only file. 'env': set it as `env_var` on the run command `run_command` in your session.",
          ),
        run_command: z
          .string()
          .optional()
          .describe(
            "With delivery 'env': the run command title (see `list_run_commands`).",
          ),
        env_var: z
          .string()
          .optional()
          .describe(
            "With delivery 'env': the variable name, e.g. 'EXPO_TOKEN'.",
          ),
        ttl_minutes: z
          .number()
          .int()
          .min(MIN_TTL_MS / 60_000)
          .max(MAX_TTL_MS / 60_000)
          .default(MAX_TTL_MS / 60_000)
          .describe(
            "How long the secret is kept before it's deleted. Default and maximum 24 hours.",
          ),
      },
      _meta: { "anthropic/alwaysLoad": true },
    },
    async (args, extra) => {
      if (!callerAgentId || !appState.agents.has(callerAgentId)) {
        return text(
          "request_secret only works for agents Argus runs: there's no Argus window to show the card in.",
          true,
        );
      }
      if (worktreePurposeForCaller(callerAgentId) === "automation") {
        return text(
          "This is an automation run and nobody is watching it to answer. Don't ask for secrets; report what you'd need instead.",
          true,
        );
      }
      const sessionId = appState.agents.get(callerAgentId)!.sessionId;
      let runTitle: string | undefined;
      if (args.delivery === "env") {
        if (!args.env_var || !ENV_NAME.test(args.env_var)) {
          return text(
            "delivery 'env' needs `env_var`: an uppercase name like EXPO_TOKEN.",
            true,
          );
        }
        try {
          runTitle = resolveRunCommand(sessionId, args.run_command).title;
        } catch (e) {
          return text(String(e), true);
        }
      }

      const call = await resolveToolCall(callerAgentId, extra._meta);
      if (!call) {
        return text(
          "Argus couldn't find this call in your transcript, so it can't show the card. Tell the user what you need and that they should provide it outside the chat.",
          true,
        );
      }

      const answer = await openSecretRequest({
        agentId: callerAgentId,
        toolUseId: call.id,
        toolName: call.name,
        input: {
          label: args.label,
          reason: args.reason,
          delivery: args.delivery,
          ...(runTitle ? { run_command: runTitle, env_var: args.env_var } : {}),
        },
        signal: extra.signal,
      });
      capture("secret_requested", {
        delivery: args.delivery,
        outcome: answer.kind,
      });
      if (answer.kind === "declined") {
        return text(DECLINED_RESULT, true);
      }
      if (answer.kind === "cancelled") {
        return text(
          "The request was cancelled before the user answered.",
          true,
        );
      }

      const ttlMs = args.ttl_minutes * 60_000;
      if (args.delivery === "env") {
        const expiresAt = setRunSecretEnv(
          sessionId,
          runTitle!,
          args.env_var!,
          answer.value,
          ttlMs,
        );

        return text(
          `The user provided ${args.label}. It's set as $${args.env_var} on the run command '${runTitle}' from its next start until ${expiryText(expiresAt)}. Start it with \`trigger_run\` (stop it first with \`stop_terminal\` if it's already running and doesn't restart on rerun). Never print the variable.`,
        );
      }
      try {
        const file = writeSecretFile(args.label, answer.value, ttlMs);

        return text(
          JSON.stringify(
            {
              path: file.path,
              expires_at: expiryText(file.expiresAt),
              note: 'Read it where it\'s needed, e.g. "$(cat <path>)". Never print it or copy its contents anywhere; pass the path if another agent needs it.',
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return text(`Couldn't store the secret: ${String(e)}`, true);
      }
    },
  );
}
