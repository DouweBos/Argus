import type {
  ConversationMessage,
  ToolCallInfo,
} from "../../../stores/conversationStore";
import { useEffect, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import {
  markMessageRead,
  useUnreadMessageIds,
} from "../../../stores/conversationStore";
import { ToolCallCard } from "../ToolCallCard";
import { categorizeTools } from "../categorizeTools";
import { findScrollParent } from "../ChatMessage/ChatMessage";
import styles from "./CollapsedToolGroup.module.css";

interface CollapsedToolGroupProps {
  agentId?: string;
  messages: ConversationMessage[];
  onPermissionRespond?: (
    toolUseId: string,
    decision: "allow" | "deny",
    allowRule?: string,
    allowAll?: boolean,
  ) => void;
  onSaveToolCallToDisk?: (toolCall: ToolCallInfo) => void;
}

export function CollapsedToolGroup({
  agentId,
  messages,
  onPermissionRespond,
  onSaveToolCallToDisk,
}: CollapsedToolGroupProps) {
  const hasPendingPermission = messages.some((m) =>
    m.toolCalls.some((tc) => tc.pendingPermission),
  );
  const [userExpanded, setUserExpanded] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  // Self-mark contained messages as read when the collapsed group becomes
  // visible — mirrors the per-message observer in ChatMessage. Without this,
  // unread messages folded into a collapsed group never clear.
  const unreadMessageIds = useUnreadMessageIds(agentId);
  const unreadInGroup = messages.some((m) => unreadMessageIds.has(m.id));
  useEffect(() => {
    if (!agentId || !unreadInGroup) {
      return;
    }
    const el = groupRef.current;
    if (!el) {
      return;
    }
    const root = findScrollParent(el);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            for (const m of messages) {
              if (unreadMessageIds.has(m.id)) {
                markMessageRead(agentId, m.id);
              }
            }
          }
        }
      },
      { root, threshold: 0 },
    );
    observer.observe(el);

    return () => observer.disconnect();
  }, [agentId, unreadInGroup, messages, unreadMessageIds]);

  // Auto-expand when a permission request is pending; user toggle applies otherwise.
  const expanded = hasPendingPermission || userExpanded;

  const totalToolCalls = messages.reduce(
    (sum, m) => sum + m.toolCalls.length,
    0,
  );
  const messageCount = messages.length;
  const categories = categorizeTools(messages);

  const firstTimestamp = messages[0]?.timestamp;
  const lastTimestamp = messages[messages.length - 1]?.timestamp;
  const formatTime = (t: number) =>
    new Date(t).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  const hasRange =
    firstTimestamp !== undefined &&
    lastTimestamp !== undefined &&
    lastTimestamp !== firstTimestamp;
  let timestampLabel: string | null = null;
  let timestampTitle: string | undefined;
  if (firstTimestamp !== undefined) {
    if (hasRange && lastTimestamp !== undefined) {
      timestampLabel = `${formatTime(firstTimestamp)}–${formatTime(lastTimestamp)}`;
      timestampTitle = `${new Date(firstTimestamp).toLocaleString()} – ${new Date(lastTimestamp).toLocaleString()}`;
    } else {
      timestampLabel = formatTime(firstTimestamp);
      timestampTitle = new Date(firstTimestamp).toLocaleString();
    }
  }

  return (
    <div ref={groupRef} className={styles.group}>
      <button
        aria-expanded={expanded}
        className={styles.toggle}
        onClick={() => setUserExpanded((v) => !v)}
      >
        <span className={styles.chevron}>
          {expanded ? (
            <Icons.ChevronDownIcon size={10} />
          ) : (
            <Icons.ChevronRightIcon size={10} />
          )}
        </span>
        <span className={styles.summary}>
          {totalToolCalls} tool {totalToolCalls === 1 ? "call" : "calls"},{" "}
          {messageCount} {messageCount === 1 ? "message" : "messages"}
        </span>
        <span className={styles.icons}>
          {categories.read > 0 && (
            <span className={styles.icon} title={`${categories.read} reads`}>
              <Icons.FileIcon size={14} />
            </span>
          )}
          {categories.search > 0 && (
            <span
              className={styles.icon}
              title={`${categories.search} searches`}
            >
              <Icons.SearchIcon size={14} />
            </span>
          )}
          {categories.bash > 0 && (
            <span className={styles.icon} title={`${categories.bash} commands`}>
              <Icons.TerminalIcon size={14} />
            </span>
          )}
          {categories.edit > 0 && (
            <span className={styles.icon} title={`${categories.edit} edits`}>
              <Icons.PencilIcon size={14} />
            </span>
          )}
          {categories.web > 0 && (
            <span
              className={styles.icon}
              title={`${categories.web} web requests`}
            >
              <Icons.WebIcon size={14} />
            </span>
          )}
          {categories.agent > 0 && (
            <span className={styles.icon} title={`${categories.agent} agents`}>
              <Icons.AgentIcon size={14} />
            </span>
          )}
          {timestampLabel && (
            <time
              className={styles.timestamp}
              dateTime={new Date(firstTimestamp!).toISOString()}
              title={timestampTitle}
            >
              {timestampLabel}
            </time>
          )}
        </span>
      </button>

      {expanded && (
        <div className={styles.expandedList}>
          {messages.map((msg) =>
            msg.toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id}
                agentId={agentId}
                toolCall={tc}
                onPermissionRespond={onPermissionRespond}
                onSaveToDisk={onSaveToolCallToDisk}
              />
            )),
          )}
        </div>
      )}
    </div>
  );
}
