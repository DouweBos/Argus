/**
 * Folding an agent's stream into its conversation. Pure: every function takes
 * a conversation and returns the next one — the same object when nothing
 * changed — so the desktop's store and the host's own driver share it.
 */

import type {
  AgentCapabilities,
  AgentConversation,
  ConversationMessage,
  ImageAttachment,
  LlmContentBlock,
  LlmStreamEvent,
  SlashCommand,
  ToolCallChild,
  ToolCallInfo,
} from "./types";
import { contextWindowFromModelUsage } from "../contextWindowUsage";
import {
  newToolCall,
  withTaskNotification,
  withTaskStarted,
} from "./background";
import {
  applyTaskCallsLive,
  extractTasksFromMessages,
  extractTodos,
  findLatestTodosInMessages,
  TASK_TOOL_NAMES,
} from "./tasks";
import { toToolResult, updateToolCallInMessages } from "./toolCalls";
import { isMetaText } from "./visibility";

export function emptyConversation(): AgentConversation {
  return { messages: [] };
}

function reportedContextWindow(
  event: Extract<LlmStreamEvent, { type: "result" }>,
  existing: AgentConversation,
): number | undefined {
  return (
    contextWindowFromModelUsage(event.modelUsage, existing.model) ||
    existing.contextWindow
  );
}

/**
 * Attach tool_results to the calls that own them anywhere in the history — a
 * background Agent's result lands many turns after its call.
 */
function withToolResults(
  existing: AgentConversation,
  event: Extract<LlmStreamEvent, { type: "user" }>,
): AgentConversation {
  const results = event.message.content ?? [];
  if (results.length === 0) {
    return existing;
  }
  let messages = existing.messages;
  const taskCallsWithResults: ToolCallInfo[] = [];
  for (const match of results) {
    const next = updateToolCallInMessages(messages, match.tool_use_id, (tc) => {
      // AskUserQuestion and ExitPlanMode pass the user's answer back as a
      // denial, so the CLI marks it is_error — to the user it's a success.
      const isDenyAnswerFlow =
        tc.name === "AskUserQuestion" || tc.name === "ExitPlanMode";
      const nextTc: ToolCallInfo = {
        ...tc,
        result: toToolResult(match.content),
        isError: isDenyAnswerFlow ? false : (match.is_error ?? false),
      };
      if (TASK_TOOL_NAMES.has(nextTc.name)) {
        taskCallsWithResults.push(nextTc);
      }

      return nextTc;
    });
    if (next) {
      messages = next;
    }
  }
  const subagent = Boolean(event.parent_tool_use_id);
  if (subagent && messages === existing.messages) {
    return existing;
  }
  const tasksUpdate = applyTaskCallsLive(
    existing.tasks,
    existing.taskOrder,
    taskCallsWithResults,
    messages,
  );

  return {
    ...existing,
    lastEventType: event.type,
    messages,
    // A subagent's result doesn't end the parent's running tool.
    ...(subagent ? {} : { pendingToolName: null, pendingToolInput: null }),
    taskOrder: tasksUpdate?.order ?? existing.taskOrder,
    tasks: tasksUpdate ? tasksUpdate.tasks : (existing.tasks ?? null),
  };
}

function withAssistant(
  existing: AgentConversation,
  event: Extract<LlmStreamEvent, { type: "assistant" }>,
): AgentConversation {
  const content: LlmContentBlock[] = event.message.content ?? [];
  const now = Date.now();

  // Sub-agent messages: nest under the parent Task/Agent tool call.
  if (event.parent_tool_use_id) {
    // Thinking blocks have nothing to show; folding them in leaves empty cards.
    const newChildren: ToolCallChild[] = content.flatMap(
      (block): ToolCallChild[] => {
        if (block.type === "text") {
          return [{ kind: "text", text: block.text }];
        }
        if (block.type === "tool_use") {
          return [
            {
              kind: "tool_use",
              toolCall: newToolCall(block.id, block.name, block.input, now),
            },
          ];
        }

        return [];
      },
    );
    const messages = updateToolCallInMessages(
      existing.messages,
      event.parent_tool_use_id,
      (tc) => ({ ...tc, children: [...(tc.children ?? []), ...newChildren] }),
    );

    return messages
      ? { ...existing, lastEventType: event.type, messages }
      : existing;
  }

  const textBlocks: string[] = [];
  const toolCalls: ToolCallInfo[] = [];
  for (const block of content) {
    if (block.type === "text") {
      textBlocks.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push(newToolCall(block.id, block.name, block.input, now));
    }
  }
  // A thinking-only block or a synthetic stub: track the event, add no row.
  if (toolCalls.length === 0 && textBlocks.every(isMetaText)) {
    return {
      ...existing,
      lastEventType: event.type,
      model: existing.model ?? event.message.model,
      pendingToolName: null,
      pendingToolInput: null,
    };
  }
  const assistantMsg: ConversationMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    textBlocks,
    toolCalls,
    timestamp: now,
    usage: event.message.usage,
  };
  const lastTool =
    toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;

  return {
    ...existing,
    lastEventType: event.type,
    model: existing.model ?? event.message.model,
    messages: [...existing.messages, assistantMsg],
    pendingToolName: lastTool?.name ?? null,
    pendingToolInput: lastTool?.input ?? null,
    // Later TodoWrite calls overwrite earlier ones.
    todos: extractTodos(toolCalls) ?? existing.todos,
  };
}

function withInit(
  existing: AgentConversation,
  event: Extract<LlmStreamEvent, { subtype: "init" }>,
): AgentConversation {
  const byName = new Map<string, SlashCommand>(
    (existing.slashCommands ?? []).map((c) => [c.name, c]),
  );
  for (const name of new Set([
    ...(event.slash_commands ?? []),
    ...(event.skills ?? []),
  ])) {
    if (!byName.has(name)) {
      byName.set(name, { name, description: "", argumentHint: "" });
    }
  }

  return {
    ...existing,
    lastEventType: event.type,
    model: event.model,
    sessionId: event.session_id,
    tools: event.tools.map((t) => t.name),
    slashCommands: Array.from(byName.values()),
  };
}

/** Fold one stream event in. */
export function reduceEvent(
  existing: AgentConversation,
  event: LlmStreamEvent,
): AgentConversation {
  // A --resume replays the last turn. Skip it (but let init refresh session
  // metadata) and clear the flag on the first result.
  if (existing.resuming) {
    if (event.type === "result") {
      return {
        ...existing,
        contextWindow: reportedContextWindow(event, existing),
        resuming: false,
      };
    }
    if (event.type !== "system") {
      return existing;
    }
  }

  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        return withInit(existing, event);
      }
      if (event.subtype === "session_state_changed") {
        return {
          ...existing,
          lastEventType: `system:${event.subtype}:${event.state}`,
        };
      }
      if (event.subtype === "task_started") {
        return withTaskStarted(existing, event, Date.now());
      }
      if (event.subtype === "task_notification") {
        return withTaskNotification(existing, event, Date.now());
      }
      if (event.subtype === "api_retry") {
        return {
          ...existing,
          lastEventType: `system:${event.subtype}`,
          messages: [
            ...existing.messages,
            {
              id: crypto.randomUUID(),
              role: "system",
              textBlocks: [
                `API retry ${event.attempt}/${event.max_retries}` +
                  (event.error_status ? ` (HTTP ${event.error_status})` : "") +
                  ` — retrying in ${Math.round(event.retry_delay_ms / 1000)}s`,
              ],
              toolCalls: [],
              timestamp: Date.now(),
            },
          ],
        };
      }

      return existing;
    case "assistant":
      return withAssistant(existing, event);
    case "user":
      return withToolResults(existing, event);
    case "result":
      return {
        ...existing,
        lastEventType: event.type,
        pendingToolName: null,
        pendingToolInput: null,
        contextWindow: reportedContextWindow(event, existing),
        totalCost: (existing.totalCost ?? 0) + (event.total_cost_usd ?? 0),
        totalDuration: (existing.totalDuration ?? 0) + (event.duration_ms ?? 0),
      };
    default:
      return existing;
  }
}

/** A message the user (or a guest, `author`) sent. Starts a new turn. */
export function withUserMessage(
  existing: AgentConversation,
  text: string,
  options: {
    author?: string;
    checkpointId?: string;
    images?: ImageAttachment[];
  } = {},
): AgentConversation {
  const msg: ConversationMessage = {
    id: crypto.randomUUID(),
    role: "user",
    textBlocks: [text],
    toolCalls: [],
    timestamp: Date.now(),
    images: options.images?.length ? options.images : undefined,
    checkpointId: options.checkpointId,
    author: options.author,
  };

  return {
    ...existing,
    followUps: undefined,
    resuming: false,
    lastEventType: "user_sent",
    messages: [...existing.messages, msg],
  };
}

/** A system notice (stderr, a diagnostic). */
export function withSystemMessage(
  existing: AgentConversation,
  msg: ConversationMessage,
): AgentConversation {
  return { ...existing, messages: [...existing.messages, msg] };
}

/**
 * A prompt sent on the agent's behalf (spawn_agent, send_agent_message). Like a
 * typed message it starts a new turn, so nothing after it is a --resume replay.
 */
export function withInjectedPrompt(
  existing: AgentConversation,
  msg: ConversationMessage,
): AgentConversation {
  return {
    ...existing,
    resuming: false,
    messages: [...existing.messages, msg],
  };
}

export function withCapabilities(
  existing: AgentConversation,
  capabilities: AgentCapabilities,
): AgentConversation {
  return { ...existing, capabilities, slashCommands: capabilities.commands };
}

/**
 * Mark the (possibly nested) tool call as waiting on a permission, or not.
 * Null when the call isn't in the conversation yet.
 */
export function withPermissionPending(
  existing: AgentConversation,
  toolUseId: string,
  pending: boolean,
): AgentConversation | null {
  const messages = updateToolCallInMessages(
    existing.messages,
    toolUseId,
    (tc) => ({ ...tc, pendingPermission: pending }),
  );

  return messages ? { ...existing, messages } : null;
}

/** A conversation rebuilt from saved messages, its task lists refolded. */
export function fromSavedMessages(
  messages: ConversationMessage[],
  meta: {
    model?: string;
    resuming?: boolean;
    sessionId?: string;
    title?: string;
  } = {},
): AgentConversation {
  const tasks = extractTasksFromMessages(messages);

  return {
    messages,
    model: meta.model,
    sessionId: meta.sessionId,
    resuming: meta.resuming,
    title: meta.title,
    todos: findLatestTodosInMessages(messages),
    tasks: tasks?.tasks ?? null,
    taskOrder: tasks?.order,
  };
}

/** Derive a short title from the first user message in a conversation. */
export function deriveTitle(messages: ConversationMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || firstUser.textBlocks.length === 0) {
    return "Untitled conversation";
  }
  const text = firstUser.textBlocks[0];
  if (text.length <= 80) {
    return text;
  }

  return text.slice(0, 77) + "...";
}
