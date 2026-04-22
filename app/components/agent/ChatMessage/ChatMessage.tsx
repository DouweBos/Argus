import type { ConversationMessage } from "../../../stores/conversationStore";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  HoverActionBar,
  HoverActionButton,
  Icons,
} from "@argus/peacock";
import { showImageContextMenu } from "../../../lib/ipc";
import { renderMarkdown } from "../../../lib/markdown";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { FileLinkHandler, MentionedText } from "../FileLinkHandler";
import { ToolCallCard } from "../ToolCallCard";
import styles from "./ChatMessage.module.css";

interface ChatMessageProps {
  agentId?: string;
  message: ConversationMessage;
  onCopy?: (message: ConversationMessage) => void;
  onEdit?: (message: ConversationMessage, newText: string) => void;
  onFork?: (message: ConversationMessage) => void;
  onPermissionRespond?: (
    toolUseId: string,
    decision: "allow" | "deny",
    allowRule?: string,
    allowAll?: boolean,
  ) => void;
}

function MessageActions({
  onCopy,
  onEdit,
  onFork,
  placement,
}: {
  onCopy?: () => void;
  onEdit?: () => void;
  onFork?: () => void;
  placement: "top-left" | "top-right";
}) {
  if (!onCopy && !onFork && !onEdit) {
    return null;
  }

  return (
    <HoverActionBar className={styles.actions} placement={placement}>
      {onCopy && (
        <HoverActionButton
          icon={<Icons.CopyIcon size={12} />}
          label="Copy message"
          onClick={onCopy}
        />
      )}
      {onEdit && (
        <HoverActionButton
          icon={<Icons.PencilIcon size={12} />}
          label="Edit message"
          onClick={onEdit}
        />
      )}
      {onFork && (
        <HoverActionButton
          icon={<Icons.BranchIcon size={12} />}
          label="Fork workspace and chat from here"
          onClick={onFork}
        />
      )}
    </HoverActionBar>
  );
}

export function ChatMessage({
  agentId,
  message,
  onCopy,
  onEdit,
  onFork,
  onPermissionRespond,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      const len = editRef.current.value.length;
      editRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const handleCopy = onCopy ? () => onCopy(message) : undefined;
  const handleFork = onFork ? () => onFork(message) : undefined;
  const handleStartEdit = onEdit
    ? () => {
        setDraft(message.textBlocks.join("\n\n"));
        setIsEditing(true);
      }
    : undefined;

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || !onEdit) {
      return;
    }
    const original = message.textBlocks.join("\n\n").trim();
    if (trimmed === original) {
      setIsEditing(false);

      return;
    }
    onEdit(message, trimmed);
    setIsEditing(false);
  };

  if (message.role === "system") {
    const trimmed = message.textBlocks
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const images = message.images ?? [];
    if (trimmed.length === 0 && images.length === 0) {
      return null;
    }

    if (message.source?.kind === "mcp") {
      const sourceLabel = message.source.parentLabel?.trim()
        ? `${message.source.parentLabel} → ${message.source.tool}`
        : `MCP · ${message.source.tool}`;

      return (
        <div className={styles.mcpMsg}>
          <div className={styles.mcpHeader}>
            <span className={styles.mcpBadge}>MCP</span>
            <span className={styles.mcpLabel}>{sourceLabel}</span>
          </div>
          <FileLinkHandler className={styles.mcpBody}>
            {trimmed.map((text, i) => (
              <p key={i} className={styles.mcpText}>
                <MentionedText text={text} />
              </p>
            ))}
          </FileLinkHandler>
          {images.length > 0 && (
            <div className={styles.mcpAttachments}>
              {images.map((img, i) => {
                const src = `data:${img.media_type};base64,${img.data}`;

                return (
                  <button
                    key={i}
                    className={styles.mcpAttachment}
                    title={`Image ${i + 1}`}
                    type="button"
                    onClick={() => openImageViewer(src, `Attachment ${i + 1}`)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      showImageContextMenu(src, `mcp-attachment-${i + 1}`);
                    }}
                  >
                    <img
                      alt={`Attachment ${i + 1}`}
                      className={styles.mcpAttachmentImg}
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

    if (isEditing) {
      return (
        <div className={styles.userMsg}>
          <div className={styles.userEdit}>
            <textarea
              ref={editRef}
              className={styles.userEditArea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsEditing(false);
                } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submitEdit();
                }
              }}
            />
            <div className={styles.userEditActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!draft.trim()}
                onClick={submitEdit}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.userMsg}>
        <MessageActions
          onCopy={handleCopy}
          onEdit={handleStartEdit}
          onFork={handleFork}
          placement="top-right"
        />
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    showImageContextMenu(src, `attachment-${i + 1}`);
                  }}
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
      {!toolOnly && (
        <MessageActions
          onCopy={handleCopy}
          onFork={handleFork}
          placement="top-right"
        />
      )}
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
              onFork={handleFork}
              onPermissionRespond={onPermissionRespond}
            />
          ))}
        </div>
      )}
    </div>
  );
}
