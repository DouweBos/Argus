import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import {
  useConversationStore,
  type ConversationMessage,
} from "../../stores/conversationStore";
import { useAgentStore } from "../../stores/agentStore";
import {
  sendAgentMessage,
  interruptAgent,
  respondToPermission,
  getCommandMetrics,
  type ImageAttachment,
} from "../../lib/ipc";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { deriveActivity } from "../../lib/activityDescription";
import { ChatMessage } from "./ChatMessage";
import { CollapsedToolGroup } from "./CollapsedToolGroup";
import { ChatInput } from "./ChatInput";
import { ChevronDownIcon } from "../shared/Icons";
import styles from "./AgentChat.module.css";

import type { SlashCommand } from "../../lib/types";

/**
 * Well-known commands that should always appear in autocomplete.
 *
 * Includes client-side commands (handled locally) and built-in CLI commands
 * that the CLI filters out in headless mode but still accepts via stdin.
 */
const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "clear", description: "Clear conversation history", argumentHint: "" },
  { name: "plan", description: "Enable plan mode or view the session plan", argumentHint: "[open|<description>]" },
  { name: "model", description: "Switch the model for this session", argumentHint: "[model]" },
  { name: "compact", description: "Summarize and clear conversation context", argumentHint: "[instructions]" },
  { name: "help", description: "Show help and available commands", argumentHint: "" },
  { name: "doctor", description: "Diagnose your Claude Code installation", argumentHint: "" },
  { name: "status", description: "Show model, account, and tool status", argumentHint: "" },
  { name: "fast", description: "Toggle fast mode", argumentHint: "" },
  { name: "effort", description: "Set reasoning effort level", argumentHint: "[low|medium|high|max]" },
];
const EMPTY_MESSAGES: ConversationMessage[] = [];

interface AgentChatProps {
  agentId: null | string;
  onRestartWithModel?: (model: string) => Promise<void>;
  onTogglePlanMode?: () => Promise<void>;
  permissionMode?: string;
  workspaceId: string;
}

export function AgentChat({
  agentId,
  onRestartWithModel,
  onTogglePlanMode,
  permissionMode,
  workspaceId,
}: AgentChatProps) {
  const conversation = useConversationStore((s) =>
    agentId ? (s.conversations[agentId] ?? null) : null,
  );
  const agentStatus = useAgentStore((s) =>
    agentId ? (s.getAgent(agentId)?.status ?? null) : null,
  );
  const addUserMessage = useConversationStore((s) => s.addUserMessage);
  const queueMessage = useConversationStore((s) => s.queueMessage);
  const clearConversation = useConversationStore((s) => s.clearConversation);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [commandMetrics, setCommandMetrics] = useState<Record<string, number>>({});

  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const queuedMessages = conversation?.queuedMessages ?? [];
  const model = conversation?.model;
  const totalCost = conversation?.totalCost;
  const totalDuration = conversation?.totalDuration;
  const slashCommands = conversation?.slashCommands;

  // Fetch per-project command metrics for popularity sorting.
  const repoRoot = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === workspaceId)?.repo_root ?? null,
  );
  useEffect(() => {
    if (!repoRoot) return;
    getCommandMetrics(repoRoot).then(setCommandMetrics).catch(() => {});
  }, [repoRoot]);

  // Group consecutive tool-call-only assistant messages into collapsed segments
  const segments = useMemo(() => groupMessages(messages), [messages]);

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
      if (countA !== countB) return countB - countA; // Most-used first.
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

  // Scroll to bottom when switching to this agent tab
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
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
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
    [agentStatus, lastEventType, pendingToolName, pendingToolInput, hasPendingPermission],
  );

  const isAlive = agentStatus === "running" || agentStatus === "idle";

  const handleModelSelect = useCallback(
    async (selectedModel: string) => {
      if (!agentId || !onRestartWithModel) return;
      await onRestartWithModel(selectedModel);
    },
    [agentId, onRestartWithModel],
  );

  const handlePermissionRespond = useCallback(
    async (
      toolUseId: string,
      decision: "allow" | "deny",
      allowRule?: string,
      allowAll?: boolean,
    ) => {
      if (!agentId) return;
      useConversationStore.getState().clearPermission(agentId, toolUseId);
      try {
        await respondToPermission(
          agentId,
          toolUseId,
          decision,
          allowRule,
          allowAll,
        );
      } catch {
        // Best-effort — the hook may have already timed out.
      }
    },
    [agentId],
  );

  const handleInterrupt = useCallback(async () => {
    if (!agentId) return;
    try {
      await interruptAgent(agentId);
    } catch {
      // Best-effort — process may have already finished.
    }
  }, [agentId]);

  const handleSend = useCallback(
    async (message: string, images?: ImageAttachment[]) => {
      if (!agentId) return;

      // Handle client-side commands
      const trimmed = message.trim();
      if (trimmed.startsWith("/")) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        if (cmd === "clear") {
          clearConversation(agentId);
          return;
        }
      }

      const status = useAgentStore.getState().getAgent(agentId)?.status;

      // If the agent is busy (running/starting), queue the message for later.
      if (status === "running") {
        queueMessage(agentId, message, images);
        return;
      }

      // Agent is idle — send directly.
      const label = images?.length
        ? `${message} [${images.length} image${images.length > 1 ? "s" : ""}]`
        : message;
      addUserMessage(agentId, label);
      useAgentStore.getState().updateAgent(agentId, { status: "running" });
      try {
        await sendAgentMessage(agentId, message, images);
        // Refresh command metrics after sending a slash command so sorting
        // updates immediately.
        if (trimmed.startsWith("/") && repoRoot) {
          getCommandMetrics(repoRoot).then(setCommandMetrics).catch(() => {});
        }
      } catch {
        // Message failed — user sees the optimistic message
      }
    },
    [agentId, addUserMessage, queueMessage, clearConversation],
  );

  if (!agentId) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No agent selected.</p>
      </div>
    );
  }

  const durationStr =
    totalDuration !== undefined && totalDuration > 0
      ? formatDuration(totalDuration)
      : null;
  const costStr =
    totalCost !== undefined && totalCost > 0
      ? `$${totalCost.toFixed(4)}`
      : null;

  return (
    <div className={styles.chat}>
      <div className={styles.messages} ref={messagesContainerRef}>
        {messages.length === 0 && queuedMessages.length === 0 && (
          <div className={styles.emptyMessages}>
            <p className={styles.emptyText}>Send a message to get started.</p>
          </div>
        )}

        {segments.map((segment) =>
          segment.type === "collapsed" ? (
            <CollapsedToolGroup
              key={segment.messages[0].id}
              messages={segment.messages}
              agentId={agentId ?? undefined}
              onPermissionRespond={handlePermissionRespond}
            />
          ) : (
            <ChatMessage
              key={segment.message.id}
              message={segment.message}
              agentId={agentId ?? undefined}
              onPermissionRespond={handlePermissionRespond}
            />
          ),
        )}

        {activity && activity.state !== "stopped" && activity.state !== "idle" && (
          <div className={`${styles.activityBubble} ${
            activity.state === "working"
              ? styles.activityWorking
              : styles.activityBlocked
          }`}>
            <span className={styles.activityDot} />
            <span className={styles.activityText}>{activity.description}</span>
            {activity.state === "working" && (
              <span className={styles.activityDots}>
                <span className={styles.thinkingDot} />
                <span className={styles.thinkingDot} />
                <span className={styles.thinkingDot} />
              </span>
            )}
          </div>
        )}

        {queuedMessages.length > 0 && (
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
          className={styles.scrollToBottom}
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ChevronDownIcon size={12} />
          Scroll to bottom
        </button>
      )}

      <ChatInput
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        agentStatus={agentStatus}
        disabled={!isAlive}
        slashCommands={allCommands}
        model={model}
        durationStr={durationStr}
        costStr={costStr}
        onModelSelect={onRestartWithModel ? handleModelSelect : undefined}
        planMode={permissionMode === "plan"}
        onTogglePlanMode={onTogglePlanMode}
        textareaRef={chatInputRef}
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
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
    !msg.toolCalls.some((tc) => tc.name === "Agent")
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
