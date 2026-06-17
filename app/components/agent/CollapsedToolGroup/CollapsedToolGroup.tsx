import type {
  ConversationMessage,
  ToolCallInfo,
} from "../../../stores/conversationStore";
import { useState } from "react";
import { HoverTimestamp, Icons } from "@argus/peacock";
import { ToolCallCard } from "../ToolCallCard";
import { categorizeTools } from "../categorizeTools";
import styles from "./CollapsedToolGroup.module.css";

interface CollapsedToolGroupProps {
  agentId?: string;
  messages: ConversationMessage[];
  onPermissionRespond?: (
    toolUseId: string,
    decision: "allow" | "deny",
    allowRule?: string,
    allowAll?: boolean,
  ) => Promise<void> | void;
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

  const body = (
    <>
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
    </>
  );

  if (firstTimestamp === undefined) {
    return <div className={styles.group}>{body}</div>;
  }

  return (
    <HoverTimestamp
      className={styles.group}
      timestamp={firstTimestamp}
      endTimestamp={lastTimestamp}
    >
      {body}
    </HoverTimestamp>
  );
}
