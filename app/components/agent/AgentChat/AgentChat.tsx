import type { SlashCommand } from "../../../lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icons, StatusDot, ThinkingDots } from "@argus/peacock";
import { deriveActivity } from "../../../lib/activityDescription";
import { notifyMessageSent } from "../../../lib/agentEventService";
import {
  type ImageAttachment,
  getCommandMetrics,
  interruptAgent,
  setAgentModel as ipcSetAgentModel,
  setAgentPermissionMode as ipcSetAgentPermissionMode,
  respondToPermission,
  sendAgentMessage,
} from "../../../lib/ipc";
import {
  getAgent,
  updateAgent,
  useAgentStatus,
} from "../../../stores/agentStore";
import {
  type ConversationMessage,
  addUserMessage,
  clearConversation,
  clearPermission,
  queueMessage,
  useConversation,
} from "../../../stores/conversationStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { ChatInput } from "../ChatInput";
import { ChatMessage } from "../ChatMessage";
import { CollapsedToolGroup } from "../CollapsedToolGroup";
import { TodoList, type TodoItem } from "../TodoList";
import styles from "./AgentChat.module.css";

/**
 * Well-known commands that should always appear in autocomplete.
 *
 * Includes client-side commands (handled locally) and built-in CLI commands
 * that the CLI filters out in headless mode but still accepts via stdin.
 */
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: "clear",
    description: "Clear conversation history",
    argumentHint: "",
  },
  {
    name: "plan",
    description: "Enable plan mode or view the session plan",
    argumentHint: "[open|<description>]",
  },
  {
    name: "model",
    description: "Switch the model for this session",
    argumentHint: "[model]",
  },
  {
    name: "compact",
    description: "Summarize and clear conversation context",
    argumentHint: "[instructions]",
  },
  {
    name: "help",
    description: "Show help and available commands",
    argumentHint: "",
  },
  {
    name: "doctor",
    description: "Diagnose your Claude Code installation",
    argumentHint: "",
  },
  {
    name: "status",
    description: "Show model, account, and tool status",
    argumentHint: "",
  },
  { name: "fast", description: "Toggle fast mode", argumentHint: "" },
  {
    name: "effort",
    description: "Set reasoning effort level",
    argumentHint: "[low|medium|high|max]",
  },
];
const EMPTY_MESSAGES: ConversationMessage[] = [];

function findLatestTodos(
  messages: ConversationMessage[],
): { id: string; todos: TodoItem[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
      const tc = msg.toolCalls[j];
      if (tc.name !== "TodoWrite") {
        continue;
      }
      const todos = (tc.input as { todos?: unknown }).todos;
      if (Array.isArray(todos) && todos.length > 0) {
        return { id: tc.id, todos: todos as TodoItem[] };
      }
    }
  }

  return null;
}

interface AgentChatProps {
  agentId: string | null;
  onClose?: () => void;
  onRestart?: () => void;
  onResume?: () => void;
  permissionMode?: string;
  readOnly?: boolean;
  workspaceId: string;
}

export function AgentChat({
  agentId,
  onClose,
  onRestart,
  onResume,
  permissionMode,
  readOnly,
  workspaceId,
}: AgentChatProps) {
  const conversation = useConversation(agentId);
  const agentSnapshot = useAgentStatus(agentId ?? "");
  const agentStatus = agentId != null ? (agentSnapshot?.status ?? null) : null;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [commandMetrics, setCommandMetrics] = useState<Record<string, number>>(
    {},
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const queuedMessages = conversation?.queuedMessages ?? [];
  const slashCommands = conversation?.slashCommands;
  const capabilitiesModels = conversation?.capabilities?.models;

  // The model ID from events (e.g. "claude-opus-4-6") or "default".
  const modelValue = conversation?.model ?? "default";

  // Resolve display name from capabilities; fall back to the raw model ID.
  const model = useMemo(() => {
    if (!capabilitiesModels?.length) {
      return conversation?.model;
    }
    const match = capabilitiesModels.find((m) => m.value === modelValue);

    return match?.displayName ?? capabilitiesModels[0]?.displayName;
  }, [capabilitiesModels, modelValue, conversation?.model]);

  // Model options for the picker, derived from capabilities.
  const modelOptions = useMemo(() => {
    if (!capabilitiesModels?.length) {
      return undefined;
    }

    return capabilitiesModels.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
    }));
  }, [capabilitiesModels]);

  // Fetch per-project command metrics for popularity sorting.
  const workspaces = useWorkspaces();
  const repoRoot = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.repo_root ?? null,
    [workspaces, workspaceId],
  );
  useEffect(() => {
    if (!repoRoot) {
      return;
    }
    getCommandMetrics(repoRoot)
      .then(setCommandMetrics)
      .catch(() => {});
  }, [repoRoot]);

  // Group consecutive tool-call-only assistant messages into collapsed segments
  const segments = useMemo(() => groupMessages(messages), [messages]);

  // Find the most recent TodoWrite tool call's todo list (if any). Displayed
  // above the chat input so users always see current progress. React Compiler
  // memoizes this for us.
  const latestTodos = findLatestTodos(messages);

  // Track the dismissed todo list per agent. Scoping by agentId means switching
  // agents automatically re-surfaces the current list instead of carrying a
  // stale dismissal across tabs. A new TodoWrite produces a new ID and
  // re-surfaces the view within the same agent.
  const [dismissedTodo, setDismissedTodo] = useState<{
    agentId: string;
    todoId: string;
  } | null>(null);
  const isDismissed =
    dismissedTodo != null &&
    dismissedTodo.agentId === agentId &&
    latestTodos != null &&
    dismissedTodo.todoId === latestTodos.id;
  const activeTodos = latestTodos && !isDismissed ? latestTodos.todos : null;

  // Merge built-in commands with backend-reported commands, deduplicating by
  // name and preferring richer objects (ones with a description).
  // Sort by project-level usage count (descending), then alphabetically.
  const allCommands = useMemo(() => {
    const map = new Map<string, SlashCommand>();
    // Add built-ins first (lowest priority — overwritten by richer data).
    for (const cmd of BUILTIN_COMMANDS) {
      map.set(cmd.name, cmd);
    }

    // Add backend commands (higher priority — may have richer descriptions).
    for (const cmd of slashCommands ?? []) {
      const existing = map.get(cmd.name);
      if (!existing || cmd.description) {
        map.set(cmd.name, cmd);
      }
    }

    const cmds = Array.from(map.values());
    cmds.sort((a, b) => {
      const countA = commandMetrics[a.name] ?? 0;
      const countB = commandMetrics[b.name] ?? 0;
      if (countA !== countB) {
        return countB - countA;
      } // Most-used first.

      return a.name.localeCompare(b.name);
    });

    return cmds;
  }, [slashCommands, commandMetrics]);

  // Auto-scroll to bottom when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, queuedMessages.length, isAtBottom]);

  // Scroll to bottom when switching to this agent tab. Dismissal state is
  // already scoped to agentId, so no cross-agent reset is needed here.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    // The scroll handler will update isAtBottom from the new position.
  }, [agentId]);

  // Track whether any tool call is waiting for user permission.
  const hasPendingPermission = useMemo(
    () => messages.some((m) => m.toolCalls.some((tc) => tc.pendingPermission)),
    [messages],
  );

  // Scroll to bottom when a permission prompt appears.
  useEffect(() => {
    if (hasPendingPermission) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [hasPendingPermission]);

  // Track scroll position to show/hide scroll-to-bottom button
  const recheckAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    container.addEventListener("scroll", recheckAtBottom, { passive: true });

    return () => container.removeEventListener("scroll", recheckAtBottom);
  }, [recheckAtBottom]);

  // Recheck when content collapses/expands (segments change) — the scroll
  // container height shrinks but no scroll event fires.
  useEffect(() => {
    recheckAtBottom();
  }, [segments, recheckAtBottom]);

  // Cmd+L / Ctrl+L to focus the input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        chatInputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Derive rich activity state for the status row.
  const lastEventType = conversation?.lastEventType;
  const pendingToolName = conversation?.pendingToolName ?? null;
  const pendingToolInput = conversation?.pendingToolInput ?? null;
  const activity = useMemo(
    () =>
      deriveActivity(
        agentStatus,
        lastEventType,
        pendingToolName,
        pendingToolInput,
        hasPendingPermission,
      ),
    [
      agentStatus,
      lastEventType,
      pendingToolName,
      pendingToolInput,
      hasPendingPermission,
    ],
  );

  const isAlive =
    !readOnly && (agentStatus === "running" || agentStatus === "idle");

  const handleModelSelect = useCallback(
    async (selectedModel: string) => {
      if (!agentId) {
        return;
      }
      try {
        await ipcSetAgentModel(agentId, selectedModel);
      } catch {
        // Best-effort — agent may have exited.
      }
    },
    [agentId],
  );

  const handlePermissionRespond = useCallback(
    async (
      toolUseId: string,
      decision: "allow" | "deny",
      allowRule?: string,
      allowAll?: boolean,
      denyMessage?: string,
    ) => {
      if (!agentId) {
        return;
      }
      clearPermission(agentId, toolUseId);
      try {
        await respondToPermission(
          agentId,
          toolUseId,
          decision,
          allowRule,
          allowAll,
          denyMessage,
        );
      } catch {
        // Best-effort — the hook may have already timed out.
      }
    },
    [agentId],
  );

  const handleInterrupt = useCallback(async () => {
    if (!agentId) {
      return;
    }
    try {
      await interruptAgent(agentId);
    } catch {
      // Best-effort — process may have already finished.
    }
  }, [agentId]);

  const handleSend = useCallback(
    async (message: string, images?: ImageAttachment[]) => {
      if (!agentId) {
        return;
      }

      // Handle client-side commands (commands that the CLI cannot handle in
      // stream-json mode because they are `local-jsx` type and require an
      // interactive terminal UI).
      const trimmed = message.trim();
      if (trimmed.startsWith("/")) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        if (cmd === "clear") {
          clearConversation(agentId);

          return;
        }

        if (cmd === "plan") {
          const newMode = permissionMode === "plan" ? "default" : "plan";
          try {
            await ipcSetAgentPermissionMode(agentId, newMode);
            updateAgent(agentId, {
              permission_mode: newMode === "default" ? undefined : newMode,
            });
          } catch {
            // Best-effort — agent may have exited.
          }

          return;
        }

        if (cmd === "model") {
          const modelArg = parts.slice(1).join(" ");
          if (modelArg) {
            try {
              await ipcSetAgentModel(agentId, modelArg);
            } catch {
              // Best-effort — agent may have exited.
            }
          } else {
            // No args — open the model picker.
            setModelPickerOpen(true);
          }

          return;
        }
      }

      const status = getAgent(agentId)?.status;

      // If the agent is busy (running/starting), queue the message for later.
      if (status === "running") {
        queueMessage(agentId, message, images);

        return;
      }

      // Agent is idle — send directly.
      addUserMessage(agentId, message, images);
      notifyMessageSent(agentId);
      updateAgent(agentId, { status: "running" });
      try {
        await sendAgentMessage(agentId, message, images);
        // Refresh command metrics after sending a slash command so sorting
        // updates immediately.
        if (trimmed.startsWith("/") && repoRoot) {
          getCommandMetrics(repoRoot)
            .then(setCommandMetrics)
            .catch(() => {});
        }
      } catch {
        // Message failed — user sees the optimistic message
      }
    },
    [agentId, permissionMode, repoRoot],
  );

  if (!agentId) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No agent selected.</p>
      </div>
    );
  }

  return (
    <div className={styles.chat}>
      {readOnly && (
        <div className={styles.historyBanner}>
          <span className={styles.historyBannerText}>Saved conversation</span>
          <div className={styles.historyBannerActions}>
            {onResume && (
              <Button variant="secondary" size="sm" onClick={onResume}>
                Resume
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      )}

      <div ref={messagesContainerRef} className={styles.messages}>
        {messages.length === 0 && queuedMessages.length === 0 && (
          <div className={styles.emptyMessages}>
            <p className={styles.emptyText}>
              {readOnly
                ? "This conversation has no messages."
                : "Send a message to get started."}
            </p>
          </div>
        )}

        {segments.map((segment) =>
          segment.type === "collapsed" ? (
            <CollapsedToolGroup
              key={segment.messages[0].id}
              agentId={agentId ?? undefined}
              messages={segment.messages}
              onPermissionRespond={
                readOnly ? undefined : handlePermissionRespond
              }
            />
          ) : (
            <ChatMessage
              key={segment.message.id}
              agentId={agentId ?? undefined}
              message={segment.message}
              onPermissionRespond={
                readOnly ? undefined : handlePermissionRespond
              }
            />
          ),
        )}

        {!readOnly &&
          activity &&
          activity.state !== "stopped" &&
          activity.state !== "idle" && (
            <div
              className={`${styles.activityBubble} ${
                activity.state === "working"
                  ? styles.activityWorking
                  : styles.activityBlocked
              }`}
            >
              <StatusDot
                tone={activity.state === "working" ? "accent" : "warning"}
                pulse={activity.state === "working"}
              />
              <span className={styles.activityText}>
                {activity.description}
              </span>
              {activity.state === "working" && <ThinkingDots />}
            </div>
          )}

        {!readOnly && queuedMessages.length > 0 && (
          <div className={styles.queuedSection}>
            <span className={styles.queuedLabel}>Queued</span>
            {queuedMessages.map((qm) => (
              <div key={qm.id} className={styles.queuedMessage}>
                {qm.text}
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!isAtBottom && (
        <button
          aria-label="Scroll to bottom"
          className={styles.scrollToBottom}
          onClick={scrollToBottom}
        >
          <Icons.ChevronDownIcon size={12} />
          Scroll to bottom
        </button>
      )}

      {!readOnly && !isAlive && onRestart && (
        <div className={styles.errorBanner}>
          <span className={styles.errorBannerText}>
            {agentStatus === "error"
              ? "Agent process exited with an error."
              : "Agent has stopped."}
          </span>
          <Button variant="danger" size="sm" onClick={onRestart}>
            Restart
          </Button>
        </div>
      )}

      {activeTodos && activeTodos.length > 0 && (
        <TodoList
          todos={activeTodos}
          onDismiss={() =>
            latestTodos && setDismissedTodo({ agentId, todoId: latestTodos.id })
          }
        />
      )}

      {!readOnly && (
        <ChatInput
          agentId={agentId}
          agentStatus={agentStatus}
          disabled={!isAlive}
          model={model}
          workspaceId={workspaceId}
          modelPickerOpen={modelPickerOpen}
          modelValue={modelValue}
          models={modelOptions}
          planMode={permissionMode === "plan"}
          slashCommands={allCommands}
          textareaRef={chatInputRef}
          onInterrupt={handleInterrupt}
          onModelPickerOpenChange={setModelPickerOpen}
          onModelSelect={handleModelSelect}
          onSend={handleSend}
          onTogglePlanMode={async () => {
            if (!agentId) {
              return;
            }
            const newMode = permissionMode === "plan" ? "default" : "plan";
            try {
              await ipcSetAgentPermissionMode(agentId, newMode);
              updateAgent(agentId, {
                permission_mode: newMode === "default" ? undefined : newMode,
              });
            } catch {
              // Best-effort
            }
          }}
        />
      )}
    </div>
  );
}

type Segment =
  | { message: ConversationMessage; type: "single" }
  | { messages: ConversationMessage[]; type: "collapsed" };

/** Is this an assistant message with tool calls but no visible text? */
function isToolCallOnly(msg: ConversationMessage): boolean {
  return (
    msg.role === "assistant" &&
    msg.toolCalls.length > 0 &&
    msg.textBlocks.length === 0 &&
    !msg.toolCalls.some(
      (tc) =>
        tc.name === "Agent" ||
        tc.name === "Edit" ||
        tc.name === "MultiEdit" ||
        tc.name === "Write",
    )
  );
}

/**
 * Group consecutive tool-call-only assistant messages (3+) into collapsed
 * segments. Runs of 1-2 render normally to avoid collapsing single turns.
 */
function groupMessages(messages: ConversationMessage[]): Segment[] {
  const segments: Segment[] = [];
  let toolOnlyRun: ConversationMessage[] = [];

  const flushRun = () => {
    if (toolOnlyRun.length >= 3) {
      segments.push({ type: "collapsed", messages: toolOnlyRun });
    } else {
      for (const m of toolOnlyRun) {
        segments.push({ type: "single", message: m });
      }
    }

    toolOnlyRun = [];
  };

  for (const msg of messages) {
    if (isToolCallOnly(msg)) {
      toolOnlyRun.push(msg);
    } else {
      flushRun();
      segments.push({ type: "single", message: msg });
    }
  }

  flushRun();

  return segments;
}
