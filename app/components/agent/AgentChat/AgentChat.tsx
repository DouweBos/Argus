import type { SlashCommand } from "../../../lib/types";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  ConfirmDialog,
  Icons,
  StatusDot,
  ThinkingDots,
  UnreadDivider,
} from "@argus/peacock";
import { deriveActivity } from "../../../lib/activityDescription";
import {
  maybeGenerateTitle,
  notifyMessageSent,
} from "../../../lib/agentEventService";
import {
  contextLimitForModel,
  tokensInContext,
} from "../../../lib/contextWindow";
import { editAndRestoreFromMessage } from "../../../lib/editRestoreChat";
import {
  type ImageAttachment,
  getCommandMetrics,
  interruptAgent,
  setAgentModel as ipcSetAgentModel,
  setAgentPermissionMode as ipcSetAgentPermissionMode,
  readFile,
  respondToPermission,
  sendAgentMessage,
  writeFile,
} from "../../../lib/ipc";
import {
  type CanonicalPermissionMode,
  toCanonicalPermissionMode,
} from "../../../lib/permissionModes";
import { randomSpinnerVerb } from "../../../lib/spinnerVerbs";
import {
  getAgent,
  updateAgent,
  useAgentStatus,
} from "../../../stores/agentStore";
import {
  type ConversationMessage,
  type ToolCallInfo,
  addUserMessage,
  clearAgentTodos,
  clearConversation,
  clearPermission,
  markMessageRead,
  queueMessage,
  useConversation,
  useUnreadMessageIds,
} from "../../../stores/conversationStore";
import { useSessions } from "../../../stores/sessionStore";
import { ChatInput } from "../ChatInput";
import { ChatMessage } from "../ChatMessage";
import { ChatSearchBar } from "../ChatSearchBar";
import { CollapsedToolGroup } from "../CollapsedToolGroup";
import { ForkSessionDialog } from "../ForkSessionDialog";
import { TodoList } from "../TodoList";
import styles from "./AgentChat.module.css";
import { QueuedMessages } from "./QueuedMessages";

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

interface AgentChatProps {
  agentId: string | null;
  onClose?: () => void;
  onRestart?: () => void;
  onResume?: () => void;
  permissionMode?: string;
  readOnly?: boolean;
  sessionId: string;
}

export function AgentChat({
  agentId,
  onClose,
  onRestart,
  onResume,
  permissionMode,
  readOnly,
  sessionId,
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
  const [searchOpen, setSearchOpen] = useState(false);

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

  // Derive live context-window usage from the latest assistant message's
  // usage payload. Each assistant turn reports cumulative input-side tokens
  // (input + cache_read + cache_creation) plus the output tokens it emitted,
  // which together approximate the tokens now resident in context.
  const contextLimit = useMemo(
    () => contextLimitForModel(modelValue),
    [modelValue],
  );
  const lastUsage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.usage) {
        return m.usage;
      }
    }

    return undefined;
  }, [messages]);
  const contextTokens = tokensInContext(lastUsage);

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
  const sessions = useSessions();
  const repoRoot = useMemo(
    () => sessions.find((w) => w.id === sessionId)?.repo_root ?? null,
    [sessions, sessionId],
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

  // Find the first segment whose message(s) contain an unread assistant message;
  // a single divider is rendered above it instead of per-message indicators.
  const unreadMessageIds = useUnreadMessageIds(agentId);
  const firstUnreadSegmentIndex = useMemo(() => {
    if (unreadMessageIds.size === 0) {
      return -1;
    }
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const inSegment =
        segment.type === "single"
          ? unreadMessageIds.has(segment.message.id)
          : segment.messages.some((m) => unreadMessageIds.has(m.id));
      if (inSegment) {
        return i;
      }
    }

    return -1;
  }, [segments, unreadMessageIds]);

  // The agent's current todo list lives on the conversation in the store —
  // updated by every TodoWrite tool call and cleared to null when the user
  // dismisses it. A subsequent TodoWrite repopulates it.
  const activeTodos = conversation?.todos ?? null;

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

  useEffect(() => {
    if (!agentId || readOnly) {
      return;
    }
    chatInputRef.current?.focus();
  }, [agentId, readOnly]);

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

  // Auto-mark unread assistant messages as read when scrolled into view.
  // Observer uses the messages container as root so visibility tracks the
  // chat's internal scroll, not the page viewport.
  useEffect(() => {
    if (!agentId || unreadMessageIds.size === 0) {
      return;
    }
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const id = (entry.target as HTMLElement).dataset.messageId;
          if (id) {
            markMessageRead(agentId, id);
          }
        }
      },
      { root: container, threshold: 0.5 },
    );
    const nodes = container.querySelectorAll<HTMLElement>("[data-unread]");
    for (const el of Array.from(nodes)) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [agentId, unreadMessageIds, segments]);

  // Cmd+L / Ctrl+L to focus the input, Cmd+F / Ctrl+F to open find-in-chat.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        chatInputRef.current?.focus();

        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
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

  // Swap the generic "Thinking" fallback for a whimsical verb, held stable
  // for the duration of each thinking episode so the bubble doesn't flicker
  // on re-render. Reset on agent switch so each agent gets a fresh verb.
  const isThinking = activity.description === "Thinking";
  const [spinnerVerb, setSpinnerVerb] = useState<string>(() =>
    randomSpinnerVerb(),
  );
  const [prevAgentId, setPrevAgentId] = useState<string | null>(agentId);
  const [wasThinking, setWasThinking] = useState(false);
  if (prevAgentId !== agentId) {
    setPrevAgentId(agentId);
    setWasThinking(false);
    setSearchOpen(false);
  } else if (isThinking && !wasThinking) {
    setSpinnerVerb(randomSpinnerVerb());
    setWasThinking(true);
  } else if (!isThinking && wasThinking) {
    setWasThinking(false);
  }
  const activityDescription = isThinking ? spinnerVerb : activity.description;

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

  const handleCopyMessage = useCallback((message: ConversationMessage) => {
    const textParts: string[] = [];
    for (const block of message.textBlocks) {
      const trimmed = block.trim();
      if (trimmed) {
        textParts.push(trimmed);
      }
    }
    if (textParts.length === 0) {
      return;
    }
    navigator.clipboard.writeText(textParts.join("\n\n")).catch(() => {});
  }, []);

  const [forkDialogMessageId, setForkDialogMessageId] = useState<string | null>(
    null,
  );
  const [pendingEdit, setPendingEdit] = useState<{
    messageId: string;
    newText: string;
  } | null>(null);

  const handleEditMessage = useCallback(
    (message: ConversationMessage, newText: string) => {
      if (!agentId) {
        return;
      }
      setPendingEdit({ messageId: message.id, newText });
    },
    [agentId],
  );

  const handleConfirmEditRestore = useCallback(async () => {
    if (!agentId || !pendingEdit) {
      return;
    }
    const edit = pendingEdit;
    setPendingEdit(null);
    try {
      await editAndRestoreFromMessage(
        sessionId,
        agentId,
        edit.messageId,
        edit.newText,
      );
    } catch {
      // Restore failed — leave the original conversation intact.
    }
  }, [agentId, pendingEdit, sessionId]);

  const handleForkMessage = useCallback(
    (message: ConversationMessage) => {
      if (!agentId) {
        return;
      }
      setForkDialogMessageId(message.id);
    },
    [agentId],
  );

  const handleSaveToolCallToDisk = useCallback(
    async (toolCall: ToolCallInfo) => {
      const filePath = toolCall.input.file_path;
      if (typeof filePath !== "string" || !filePath) {
        return;
      }
      try {
        if (toolCall.name === "Write") {
          const content = toolCall.input.content;
          if (typeof content !== "string") {
            return;
          }
          await writeFile(sessionId, filePath, content);

          return;
        }
        if (toolCall.name === "Edit") {
          const { old_string: oldStr, new_string: newStr } = toolCall.input;
          if (typeof oldStr !== "string" || typeof newStr !== "string") {
            return;
          }
          const current = await readFile(sessionId, filePath);
          const next = toolCall.input.replace_all
            ? current.split(oldStr).join(newStr)
            : current.replace(oldStr, newStr);
          await writeFile(sessionId, filePath, next);

          return;
        }
        if (
          toolCall.name === "MultiEdit" &&
          Array.isArray(toolCall.input.edits)
        ) {
          let current = await readFile(sessionId, filePath);
          for (const edit of toolCall.input.edits as Record<
            string,
            unknown
          >[]) {
            const oldStr = edit.old_string;
            const newStr = edit.new_string;
            if (typeof oldStr !== "string" || typeof newStr !== "string") {
              continue;
            }
            current = edit.replace_all
              ? current.split(oldStr).join(newStr)
              : current.replace(oldStr, newStr);
          }
          await writeFile(sessionId, filePath, current);
        }
      } catch {
        // Best-effort — file may not exist yet or disk state may have drifted.
      }
    },
    [sessionId],
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

  const handleSetPermissionMode = useCallback(
    async (mode: CanonicalPermissionMode) => {
      if (!agentId) {
        return;
      }
      try {
        await ipcSetAgentPermissionMode(agentId, mode);
        updateAgent(agentId, {
          permission_mode: mode === "auto" ? undefined : mode,
        });
      } catch {
        // Best-effort — agent may have exited.
      }
    },
    [agentId],
  );

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
          const current = toCanonicalPermissionMode(permissionMode);
          await handleSetPermissionMode(current === "plan" ? "auto" : "plan");

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

      // Kick off background title generation on the first real user message.
      // `maybeGenerateTitle` is a no-op for later messages.
      maybeGenerateTitle(agentId, message);

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
    [agentId, permissionMode, repoRoot, handleSetPermissionMode],
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

      {searchOpen && (
        <ChatSearchBar
          containerRef={messagesContainerRef}
          messagesVersion={messages.length}
          onClose={() => setSearchOpen(false)}
        />
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

        {segments.map((segment, index) => {
          const key =
            segment.type === "collapsed"
              ? segment.messages[0].id
              : segment.message.id;

          return (
            <Fragment key={key}>
              {index === firstUnreadSegmentIndex && <UnreadDivider />}
              {segment.type === "collapsed" ? (
                <CollapsedToolGroup
                  agentId={agentId ?? undefined}
                  messages={segment.messages}
                  onPermissionRespond={
                    readOnly ? undefined : handlePermissionRespond
                  }
                  onSaveToolCallToDisk={
                    readOnly ? undefined : handleSaveToolCallToDisk
                  }
                />
              ) : (
                <ChatMessage
                  agentId={agentId ?? undefined}
                  message={segment.message}
                  onCopy={readOnly ? undefined : handleCopyMessage}
                  onEdit={readOnly ? undefined : handleEditMessage}
                  onFork={readOnly ? undefined : handleForkMessage}
                  onPermissionRespond={
                    readOnly ? undefined : handlePermissionRespond
                  }
                  onSaveToolCallToDisk={
                    readOnly ? undefined : handleSaveToolCallToDisk
                  }
                />
              )}
            </Fragment>
          );
        })}

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
              <span className={styles.activityText}>{activityDescription}</span>
              {activity.state === "working" && <ThinkingDots />}
            </div>
          )}

        {!readOnly && agentId && queuedMessages.length > 0 && (
          <QueuedMessages agentId={agentId} messages={queuedMessages} />
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

      {activeTodos && activeTodos.length > 0 && agentId && (
        <TodoList
          todos={activeTodos}
          onDismiss={() => clearAgentTodos(agentId)}
        />
      )}

      {!readOnly && (
        <ChatInput
          agentId={agentId}
          agentStatus={agentStatus}
          contextLimit={contextLimit}
          contextTokens={contextTokens}
          disabled={!isAlive}
          model={model}
          sessionId={sessionId}
          modelPickerOpen={modelPickerOpen}
          modelValue={modelValue}
          models={modelOptions}
          permissionMode={permissionMode}
          slashCommands={allCommands}
          textareaRef={chatInputRef}
          onInterrupt={handleInterrupt}
          onModelPickerOpenChange={setModelPickerOpen}
          onModelSelect={handleModelSelect}
          onSend={handleSend}
          onSetPermissionMode={handleSetPermissionMode}
        />
      )}
      {forkDialogMessageId != null && agentId != null && repoRoot != null && (
        <ForkSessionDialog
          repoRoot={repoRoot}
          agentId={agentId}
          messageId={forkDialogMessageId}
          sourceSessionId={sessionId}
          onClose={() => setForkDialogMessageId(null)}
        />
      )}
      {pendingEdit != null && (
        <ConfirmDialog
          title="Restore conversation?"
          titleId="edit-restore-title"
          confirmLabel="Edit & restore"
          cancelLabel="No"
          onCancel={() => setPendingEdit(null)}
          onConfirm={handleConfirmEditRestore}
        >
          Your edit will replace this message and the conversation will be
          rewound to this point. All messages after it will be discarded.
        </ConfirmDialog>
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
    msg.textBlocks.every((t) => t.trim().length === 0) &&
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
