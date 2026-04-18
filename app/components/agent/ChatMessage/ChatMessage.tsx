import type { ConversationMessage } from "../../../stores/conversationStore";
import { renderMarkdown } from "../../../lib/markdown";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { FileLinkHandler, MentionedText } from "../FileLinkHandler";
import { ToolCallCard } from "../ToolCallCard";
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
      <div
        className={`${styles.systemMsg}${message.isError ? ` ${styles.systemMsgError}` : ""}`}
      >
        {message.textBlocks.map((text, i) => (
          <span key={i}>{text}</span>
        ))}
      </div>
    );
  }

  if (message.role === "user") {
    const images = message.images ?? [];

    return (
      <div className={styles.userMsg}>
        <FileLinkHandler>
          {message.textBlocks.map((text, i) => (
            <p key={i} className={styles.userText}>
              <MentionedText text={text} />
            </p>
          ))}
        </FileLinkHandler>
        {images.length > 0 && (
          <div className={styles.userAttachments}>
            {images.map((img, i) => {
              const src = `data:${img.media_type};base64,${img.data}`;

              return (
                <button
                  key={i}
                  className={styles.userAttachment}
                  title={`Image ${i + 1}`}
                  type="button"
                  onClick={() => openImageViewer(src, `Attachment ${i + 1}`)}
                >
                  <img
                    alt={`Attachment ${i + 1}`}
                    className={styles.userAttachmentImg}
                    src={src}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // assistant role
  const hasToolCalls = message.toolCalls.length > 0;
  const hasText = message.textBlocks.length > 0;
  const toolOnly = hasToolCalls && !hasText;

  return (
    <div
      className={`${styles.assistantMsg} ${toolOnly ? styles.assistantMsgToolOnly : ""}`}
    >
      {hasText && (
        <FileLinkHandler className={styles.textContent}>
          {message.textBlocks.map((text, i) => (
            <div
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
              key={i}
              className={styles.markdown}
            />
          ))}
        </FileLinkHandler>
      )}

      {hasToolCalls && (
        <div className={styles.toolCallsSection}>
          {message.toolCalls.map((tc) => (
            <ToolCallCard
              key={tc.id}
              agentId={agentId}
              toolCall={tc}
              onPermissionRespond={onPermissionRespond}
            />
          ))}
        </div>
      )}
    </div>
  );
}
