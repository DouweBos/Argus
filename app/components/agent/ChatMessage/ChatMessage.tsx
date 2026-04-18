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
    const trimmed = message.textBlocks
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (trimmed.length === 0) {
      return null;
    }

    return (
      <div
        className={`${styles.systemMsg}${message.isError ? ` ${styles.systemMsgError}` : ""}`}
      >
        {trimmed.map((text, i) => (
          <span key={i}>{text}</span>
        ))}
      </div>
    );
  }

  if (message.role === "user") {
    const images = message.images ?? [];
    const trimmedUserBlocks = message.textBlocks
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (trimmedUserBlocks.length === 0 && images.length === 0) {
      return null;
    }

    return (
      <div className={styles.userMsg}>
        <FileLinkHandler className={styles.userTextWrap}>
          {trimmedUserBlocks.map((text, i) => (
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
  const trimmedBlocks = message.textBlocks
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const hasText = trimmedBlocks.length > 0;
  const toolOnly = hasToolCalls && !hasText;

  if (!hasText && !hasToolCalls) {
    return null;
  }

  return (
    <div
      className={`${styles.assistantMsg} ${toolOnly ? styles.assistantMsgToolOnly : ""}`}
    >
      {hasText && (
        <FileLinkHandler className={styles.textContent}>
          {trimmedBlocks.map((text, i) => (
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
