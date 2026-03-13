import type { ConversationMessage } from "../../stores/conversationStore";
import { renderMarkdown } from "../../lib/markdown";
import { ToolCallCard } from "./ToolCallCard";
import styles from "./ChatMessage.module.css";

interface ChatMessageProps {
  agentId?: string;
  message: ConversationMessage;
  onPermissionRespond?: (
    toolUseId: string,
    decision: "allow" | "deny",
    allowRule?: string,
    allowAll?: boolean,
  ) => void;
}

export function ChatMessage({
  agentId,
  message,
  onPermissionRespond,
}: ChatMessageProps) {
  if (message.role === "system") {
    return (
      <div className={styles.systemMsg}>
        {message.textBlocks.map((text, i) => (
          <span key={i}>{text}</span>
        ))}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className={styles.userMsg}>
        {message.textBlocks.map((text, i) => (
          <p key={i} className={styles.userText}>
            {text}
          </p>
        ))}
      </div>
    );
  }

  // assistant role
  const hasToolCalls = message.toolCalls.length > 0;
  const hasText = message.textBlocks.length > 0;

  return (
    <div className={styles.assistantMsg}>
      {hasText && (
        <div className={styles.textContent}>
          {message.textBlocks.map((text, i) => (
            <div
              key={i}
              className={styles.markdown}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
            />
          ))}
        </div>
      )}

      {hasToolCalls && (
        <div className={styles.toolCallsSection}>
          {message.toolCalls.map((tc) => (
            <ToolCallCard
              key={tc.id}
              toolCall={tc}
              agentId={agentId}
              onPermissionRespond={onPermissionRespond}
            />
          ))}
        </div>
      )}
    </div>
  );
}
