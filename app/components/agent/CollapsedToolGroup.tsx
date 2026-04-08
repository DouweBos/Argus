import { useState } from "react";
import type { ConversationMessage } from "../../stores/conversationStore";
import { ToolCallCard } from "./ToolCallCard";
import { categorizeTools } from "./categorizeTools";
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
}

/** Icons representing tool call categories. */
function FileReadIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.414A2 2 0 0 0 13.414 3L11 .586A2 2 0 0 0 9.586 0H4zm5.586 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.414a1 1 0 0 0-.293-.707L9.586 1z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
    </svg>
  );
}

function TerminalSmallIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9zM3.854 4.146a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2z" />
      <path d="M2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5z" />
    </svg>
  );
}

function WebIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z" />
    </svg>
  );
}

export function CollapsedToolGroup({
  agentId,
  messages,
  onPermissionRespond,
}: CollapsedToolGroupProps) {
  const hasPendingPermission = messages.some((m) =>
    m.toolCalls.some((tc) => tc.pendingPermission),
  );
  const [userExpanded, setExpanded] = useState(false);
  // Auto-expand when a permission request is pending; user toggle applies otherwise.
  const expanded = hasPendingPermission || userExpanded;

  const totalToolCalls = messages.reduce(
    (sum, m) => sum + m.toolCalls.length,
    0,
  );
  const messageCount = messages.length;
  const categories = categorizeTools(messages);

  return (
    <div className={styles.group}>
      <button
        className={styles.toggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron}>{expanded ? "\u25BE" : "\u25B8"}</span>
        <span className={styles.summary}>
          {totalToolCalls} tool {totalToolCalls === 1 ? "call" : "calls"},{" "}
          {messageCount} {messageCount === 1 ? "message" : "messages"}
        </span>
        <span className={styles.icons}>
          {categories.read > 0 && (
            <span className={styles.icon} title={`${categories.read} reads`}>
              <FileReadIcon />
            </span>
          )}
          {categories.search > 0 && (
            <span
              className={styles.icon}
              title={`${categories.search} searches`}
            >
              <SearchIcon />
            </span>
          )}
          {categories.bash > 0 && (
            <span className={styles.icon} title={`${categories.bash} commands`}>
              <TerminalSmallIcon />
            </span>
          )}
          {categories.edit > 0 && (
            <span className={styles.icon} title={`${categories.edit} edits`}>
              <EditIcon />
            </span>
          )}
          {categories.web > 0 && (
            <span
              className={styles.icon}
              title={`${categories.web} web requests`}
            >
              <WebIcon />
            </span>
          )}
          {categories.agent > 0 && (
            <span className={styles.icon} title={`${categories.agent} agents`}>
              <AgentIcon />
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
                toolCall={tc}
                agentId={agentId}
                onPermissionRespond={onPermissionRespond}
              />
            )),
          )}
        </div>
      )}
    </div>
  );
}
