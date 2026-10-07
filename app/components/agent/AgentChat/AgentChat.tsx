import type { SlashCommand } from "../../../lib/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { visibleMessages as shownMessages } from "@argus/host/services/agent/conversation/visibility";
import {
  Button,
  ConfirmDialog,
  Icons,
  StatusDot,
  ThinkingDots,
  UnreadDivider,
} from "@argus/peacock";
import { deriveActivity } from "../../../lib/activityDescription";
import { notifyMessageSent } from "../../../lib/agentEventService";
import {
  resolveContextLimit,
  tokensInContext,
} from "../../../lib/contextWindow";
import { editAndRestoreFromMessage } from "../../../lib/editRestoreChat";
import { huddleAuthor } from "../../../lib/huddleAuthor";
import {
  type ImageAttachment,
  clearAgentTranscript,
  dismissAgentList,
  getCommandMetrics,
  interruptAgent,
  setAgentEffort as ipcSetAgentEffort,
  setAgentModel as ipcSetAgentModel,
  setAgentPermissionMode as ipcSetAgentPermissionMode,
  readFile,
  respondToPermission,
  submitAgentMessage,
  writeFile,
} from "../../../lib/ipc";
import { getLastKnownCapabilities } from "../../../lib/lastKnownCapabilities";
import {
  type CanonicalPermissionMode,
  toCanonicalPermissionMode,
} from "../../../lib/permissionModes";
import { restoreFromMessage } from "../../../lib/restoreCheckpointChat";
import { randomSpinnerVerb } from "../../../lib/spinnerVerbs";
import {
  getAgent,
  updateAgent,
  useAgentStatus,
} from "../../../stores/agentStore";
import {
  type ConversationMessage,
  type ToolCallInfo,
  clearAgentUnread,
  clearPermission,
  setDraft,
  useConversation,
  useHasRunningSubagents,
  useUnreadMessageIds,
} from "../../../stores/conversationStore";
import { useQueuedMessages, watchQueue } from "../../../stores/queueStore";
import { useRegisteredRunners } from "../../../stores/runnersStore";
import { useSessions } from "../../../stores/sessionStore";
import {
  getLastEffortForRunner,
  setLastEffortForRunner,
} from "../../../stores/settingsStore";
import { ChatInput } from "../ChatInput";
import { ChatMessage } from "../ChatMessage";
import { ChatSearchBar } from "../ChatSearchBar";
import { CollapsedToolGroup } from "../CollapsedToolGroup";
import { ULTRACODE_EFFORT } from "../EffortPicker";
import { ForkSessionDialog } from "../ForkSessionDialog";
import { HuddleTypingBar } from "../HuddleShare";
import { TaskList } from "../TaskList";
import { TodoList } from "../TodoList";
import styles from "./AgentChat.module.css";
import { LimitResumeBanner } from "./LimitResumeBanner";
import { QueuedMessages } from "./QueuedMessages";
import { useOlderTranscript } from "./useOlderTranscript";

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
    argumentHint: "[low|medium|high|xhigh|max|ultracode]",
  },
];
const EMPTY_MESSAGES: ConversationMessage[] = [];

// Render only the most recent messages initially, then lazily reveal older
// ones as the user scrolls toward the top. Keeps long conversations (thousands
// of messages) from rendering everything at once.
const INITIAL_VISIBLE_MESSAGES = 100;
const VISIBLE_MESSAGES_STEP = 100;
// Distance from the top (px) at which we reveal the next page of older messages.
const LOAD_MORE_THRESHOLD = 300;

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
  const hasRunningSubagents = useHasRunningSubagents(agentId);
  const { loadOlder, releaseOlder } = useOlderTranscript(agentId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // How many of the most recent messages are currently rendered. Grows as the
  // user scrolls up; reset when switching agents.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [commandMetrics, setCommandMetrics] = useState<Record<string, number>>(
    {},
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const queuedMessages = useQueuedMessages(agentId);
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
  const reportedWindow = conversation?.contextWindow;
  const contextLimit = useMemo(() => {
    // Prefer the agent's selected variant (e.g. `opus[1m]`, preserved across
    // restarts) over the resolved id from stream events, which loses the
    // variant suffix. Capabilities fall back to the last-known set so resumed
    // agents still resolve before their live capabilities arrive.
    const selectedModel = agentSnapshot?.model ?? modelValue;
    const models = capabilitiesModels ?? getLastKnownCapabilities().models;

    return resolveContextLimit({
      models,
      reported: reportedWindow,
      resolvedModel: conversation?.model,
      selectedModel,
    });
  }, [
    capabilitiesModels,
    modelValue,
    agentSnapshot?.model,
    reportedWindow,
    conversation?.model,
  ]);
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

  // Effort levels supported by the active model, advertised in the
  // initialize-response capabilities. Empty when the model doesn't expose
  // effort or when capabilities haven't arrived yet — the ChatInput hides
  // the pill in that case.
  const supportedEffortLevels = useMemo(() => {
    if (!capabilitiesModels?.length) {
      return undefined;
    }
    const match = capabilitiesModels.find((m) => m.value === modelValue);
    const active = match ?? capabilitiesModels[0];
    if (!active?.supportsEffort || !active.supportedEffortLevels?.length) {
      return undefined;
    }

    // `ultracode` (xhigh effort + workflow orchestration) is never advertised;
    // append it as a synthetic option when the model supports xhigh, matching
    // the CLI's picker. The runner translates it into an `ultracode` flag.
    const levels = active.supportedEffortLevels;

    return levels.includes("xhigh") ? [...levels, ULTRACODE_EFFORT] : levels;
  }, [capabilitiesModels, modelValue]);

  // Fetch per-project command metrics for popularity sorting.
  const sessions = useSessions();

  // Model options for the picker. A custom runner declares its own models —
  // the CLI's handshake only knows the base runner's, which don't exist on
  // the gateway it's pointed at.
  const registeredRunners = useRegisteredRunners();
  // The agent owns its runner; the session's is only what it inherited.
  const agentRunnerId =
    agentSnapshot?.runner_id ??
    sessions.find((s) => s.id === sessionId)?.runner_id ??
    null;
  const runnerModels = useMemo(
    () =>
      agentRunnerId
        ? (registeredRunners.find((r) => r.id === agentRunnerId)?.models ?? [])
        : [],
    [registeredRunners, agentRunnerId],
  );
  const modelOptions = useMemo(() => {
    if (runnerModels.length > 0) {
      return runnerModels;
    }
    if (!capabilitiesModels?.length) {
      return undefined;
    }

    return capabilitiesModels.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
    }));
  }, [capabilitiesModels, runnerModels]);
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

  // Only render the tail of the conversation; older messages are revealed as
  // the user scrolls toward the top (see the load-more scroll handler).
  const hasMoreMessages = messages.length > visibleCount;
  const visibleMessages = useMemo(
    () =>
      hasMoreMessages
        ? messages.slice(messages.length - visibleCount)
        : messages,
    [messages, visibleCount, hasMoreMessages],
  );

  // Hide bookkeeping (thinking-only turns, ToolSearch), then group consecutive
  // tool-call-only assistant messages into collapsed segments.
  const settled =
    agentStatus === null ||
    agentStatus === "stopped" ||
    agentStatus === "error";
  const segments = useMemo(
    () => groupMessages(shownMessages(visibleMessages, { settled })),
    [visibleMessages, settled],
  );

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

  // Task* tool family produces a separate, stateful task list. Render in
  // creation order; both panels can show simultaneously if the agent mixes
  // TodoWrite and Task* calls.
  const tasksMap = conversation?.tasks;
  const taskOrder = conversation?.taskOrder;
  const activeTasks = useMemo(() => {
    if (!tasksMap) {
      return null;
    }
    const order = taskOrder ?? Object.keys(tasksMap);
    const list = order
      .map((id) => tasksMap[id])
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    return list.length > 0 ? list : null;
  }, [tasksMap, taskOrder]);

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

  // Reset the visible window so a freshly-opened chat only renders its tail.
  // Done during render (not in an effect) so the first paint already shows the
  // trimmed window — the React-recommended "adjust state on prop change" form.
  const [windowAgentId, setWindowAgentId] = useState(agentId);
  if (agentId !== windowAgentId) {
    setWindowAgentId(agentId);
    setVisibleCount(INITIAL_VISIBLE_MESSAGES);
  }

  // Scroll to bottom when switching to this agent tab. Dismissal state is
  // already scoped to agentId, so no cross-agent reset is needed here.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    // The scroll handler will update isAtBottom from the new position.
  }, [agentId]);

  // The queue lives in the backend — mirror it for as long as the chat is open.
  useEffect(() => {
    if (agentId) {
      watchQueue(agentId);
    }
  }, [agentId]);

  // While a chat is open, unread messages for it never accumulate: we clear
  // on initial open and again whenever new unread state appears (e.g. the
  // agent finishes a turn while the user is already viewing this chat).
  useEffect(() => {
    if (!agentId) {
      return;
    }
    clearAgentUnread(agentId);
  }, [agentId, unreadMessageIds]);

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

  // Scroll metrics captured just before a load-more, so the layout effect can
  // restore the visual position after older messages are prepended.
  const pendingScrollRestoreRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  // Keep mutable copies for the stable scroll handler to read without
  // reattaching the listener on every message/visibleCount change.
  const messagesLengthRef = useRef(messages.length);
  const visibleCountRef = useRef(visibleCount);
  useEffect(() => {
    messagesLengthRef.current = messages.length;
    visibleCountRef.current = visibleCount;
  }, [messages.length, visibleCount]);

  // Track scroll position to show/hide scroll-to-bottom button
  const recheckAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  const handleScroll = useCallback(() => {
    recheckAtBottom();
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    // Back at the bottom → drop the older pages again, so one trip up a long
    // history doesn't keep every row mounted for the rest of the session.
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (
      scrollHeight - scrollTop - clientHeight < 40 &&
      visibleCountRef.current > INITIAL_VISIBLE_MESSAGES
    ) {
      setVisibleCount(INITIAL_VISIBLE_MESSAGES);
      releaseOlder();

      return;
    }
    if (container.scrollTop >= LOAD_MORE_THRESHOLD) {
      return;
    }
    // Near the top with older messages still hidden → reveal the next page.
    if (visibleCountRef.current < messagesLengthRef.current) {
      pendingScrollRestoreRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
      setVisibleCount((c) =>
        Math.min(c + VISIBLE_MESSAGES_STEP, messagesLengthRef.current),
      );

      return;
    }
    // Everything loaded is showing → fetch the page before it from the host.
    loadOlder().then((added) => {
      if (added > 0 && messagesContainerRef.current) {
        pendingScrollRestoreRef.current = {
          scrollHeight: messagesContainerRef.current.scrollHeight,
          scrollTop: messagesContainerRef.current.scrollTop,
        };
        setVisibleCount((c) => c + added);
      }
    });
  }, [recheckAtBottom, loadOlder, releaseOlder]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // After prepending older messages, restore the scroll position so the
  // content the user was looking at stays put instead of jumping.
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    const pending = pendingScrollRestoreRef.current;
    if (!container || !pending) {
      return;
    }
    pendingScrollRestoreRef.current = null;
    const delta = container.scrollHeight - pending.scrollHeight;
    if (delta > 0) {
      container.scrollTop = pending.scrollTop + delta;
    }
  }, [visibleCount]);

  // Recheck when content collapses/expands (segments change) — the scroll
  // container height shrinks but no scroll event fires.
  useEffect(() => {
    recheckAtBottom();
  }, [segments, recheckAtBottom]);

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
        hasRunningSubagents,
      ),
    [
      agentStatus,
      lastEventType,
      pendingToolName,
      pendingToolInput,
      hasPendingPermission,
      hasRunningSubagents,
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
    !readOnly &&
    (agentStatus === "running" ||
      agentStatus === "idle" ||
      agentStatus === "requires_action");

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
  const [pendingRestore, setPendingRestore] = useState<{
    messageId: string;
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

  const handleRestoreMessage = useCallback(
    (message: ConversationMessage) => {
      if (!agentId) {
        return;
      }
      setPendingRestore({ messageId: message.id });
    },
    [agentId],
  );

  const handleConfirmRestore = useCallback(async () => {
    if (!agentId || !pendingRestore) {
      return;
    }
    const { messageId } = pendingRestore;
    setPendingRestore(null);
    try {
      const { restoredPrompt } = await restoreFromMessage(
        sessionId,
        agentId,
        messageId,
      );
      // Mirror Claude Code's UX: drop the original prompt back into the
      // input so the user can re-send or edit it.
      setDraft(agentId, restoredPrompt);
      chatInputRef.current?.focus();
    } catch {
      // Restore failed — leave conversation intact.
    }
  }, [agentId, pendingRestore, sessionId]);

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
          permission_mode: mode,
        });
      } catch {
        // Best-effort — agent may have exited.
      }
    },
    [agentId],
  );

  const sessionRunnerId = useMemo(
    () => sessions.find((s) => s.id === sessionId)?.runner_id ?? "claude-code",
    [sessions, sessionId],
  );

  const handleSetEffort = useCallback(
    async (level: string | null) => {
      if (!agentId) {
        return;
      }
      try {
        await ipcSetAgentEffort(agentId, level);
        updateAgent(agentId, { effort: level });
        setLastEffortForRunner(sessionRunnerId, level);
      } catch {
        // Best-effort — agent may have exited.
      }
    },
    [agentId, sessionRunnerId],
  );

  // Apply the persisted per-runner default once capabilities for a fresh agent
  // arrive. Skips if the agent already has an effort set or if the persisted
  // level isn't supported by the active model.
  const appliedDefaultEffortRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (!supportedEffortLevels?.length) {
      return;
    }
    if (appliedDefaultEffortRef.current.has(agentId)) {
      return;
    }
    appliedDefaultEffortRef.current.add(agentId);

    const current = getAgent(agentId)?.effort;
    if (current != null) {
      return;
    }
    const persisted = getLastEffortForRunner(sessionRunnerId);
    if (persisted == null) {
      return;
    }
    if (!supportedEffortLevels.includes(persisted)) {
      return;
    }
    ipcSetAgentEffort(agentId, persisted)
      .then(() => updateAgent(agentId, { effort: persisted }))
      .catch(() => {
        // Best-effort — agent may have exited before defaults applied.
      });
  }, [agentId, sessionRunnerId, supportedEffortLevels]);

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
          clearAgentTranscript(agentId).catch(() => {});

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

      // The host sends it now or queues it behind the turn in flight, and
      // records the bubble (with a worktree checkpoint) once it goes out.
      try {
        const { queued } = await submitAgentMessage(agentId, message, {
          author: huddleAuthor(agentId),
          images,
        });
        if (!queued) {
          notifyMessageSent(agentId);
        }
        // Refresh command metrics after sending a slash command so sorting
        // updates immediately.
        if (trimmed.startsWith("/") && repoRoot) {
          getCommandMetrics(repoRoot)
            .then(setCommandMetrics)
            .catch(() => {});
        }
      } catch {
        // The agent may have exited; its status says so.
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
        {hasMoreMessages && (
          <div className={styles.loadMoreIndicator}>
            <ThinkingDots />
            <span>Loading earlier messages…</span>
          </div>
        )}

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
            <div key={key} className={styles.row}>
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
                  onRestore={readOnly ? undefined : handleRestoreMessage}
                  onSaveToolCallToDisk={
                    readOnly ? undefined : handleSaveToolCallToDisk
                  }
                />
              )}
            </div>
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

        {!readOnly && agentId && <LimitResumeBanner agentId={agentId} />}

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
          onDismiss={() => dismissAgentList(agentId, "todos").catch(() => {})}
        />
      )}

      {activeTasks && agentId && (
        <TaskList
          tasks={activeTasks}
          onDismiss={() => dismissAgentList(agentId, "tasks").catch(() => {})}
        />
      )}

      {!readOnly && agentId && <HuddleTypingBar agentId={agentId} />}
      {!readOnly && (
        <ChatInput
          agentId={agentId}
          agentStatus={agentStatus}
          agentRunnerId={agentRunnerId}
          canSwitchRunner={messages.length === 0}
          contextLimit={contextLimit}
          contextTokens={contextTokens}
          disabled={!isAlive}
          model={model}
          sessionId={sessionId}
          modelPickerOpen={modelPickerOpen}
          modelValue={modelValue}
          models={modelOptions}
          permissionMode={permissionMode}
          effort={agentSnapshot?.effort ?? null}
          supportedEffortLevels={supportedEffortLevels}
          slashCommands={allCommands}
          textareaRef={chatInputRef}
          onInterrupt={handleInterrupt}
          onModelPickerOpenChange={setModelPickerOpen}
          onModelSelect={handleModelSelect}
          onSend={handleSend}
          onSetEffort={handleSetEffort}
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
      {pendingRestore != null && (
        <ConfirmDialog
          title="Restore from this message?"
          titleId="restore-checkpoint-title"
          confirmLabel="Restore"
          cancelLabel="Cancel"
          onCancel={() => setPendingRestore(null)}
          onConfirm={handleConfirmRestore}
        >
          Files will be reverted to their state when this message was sent, and
          all later chat messages will be discarded. Your prompt will be
          returned to the input so you can re-send or edit it.
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
