import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icons } from "@argus/peacock";
import {
  type QueuedMessage,
  removeQueuedMessage,
  updateQueuedMessage,
} from "../../../stores/conversationStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import styles from "./AgentChat.module.css";

interface QueuedMessagesProps {
  agentId: string;
  messages: QueuedMessage[];
}

export function QueuedMessages({ agentId, messages }: QueuedMessagesProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className={styles.queuedSection}>
      <span className={styles.queuedLabel}>Queued</span>
      {messages.map((qm) => (
        <QueuedMessageItem
          key={qm.id}
          agentId={agentId}
          message={qm}
          editing={editingId === qm.id}
          onStartEdit={() => setEditingId(qm.id)}
          onStopEdit={() => setEditingId(null)}
        />
      ))}
    </div>
  );
}

interface QueuedMessageItemProps {
  agentId: string;
  editing: boolean;
  message: QueuedMessage;
  onStartEdit: () => void;
  onStopEdit: () => void;
}

function QueuedMessageItem({
  agentId,
  editing,
  message,
  onStartEdit,
  onStopEdit,
}: QueuedMessageItemProps) {
  const images = message.images ?? [];

  const handleDelete = useCallback(() => {
    removeQueuedMessage(agentId, message.id);
  }, [agentId, message.id]);

  return (
    <div className={styles.queuedMessageWrap}>
      <div className={styles.queuedMessageRow}>
        {editing ? (
          <QueuedMessageEditor
            agentId={agentId}
            message={message}
            onDone={onStopEdit}
          />
        ) : (
          <div className={styles.queuedMessage}>{message.text}</div>
        )}
        {!editing && (
          <div className={styles.queuedActions}>
            <button
              aria-label="Edit queued message"
              className={styles.queuedActionButton}
              title="Edit"
              type="button"
              onClick={onStartEdit}
            >
              <Icons.PencilIcon size={11} />
            </button>
            <button
              aria-label="Delete queued message"
              className={styles.queuedActionButton}
              title="Delete"
              type="button"
              onClick={handleDelete}
            >
              <Icons.TrashIcon size={12} />
            </button>
          </div>
        )}
      </div>
      {images.length > 0 && (
        <div className={styles.queuedAttachments}>
          {images.map((img, i) => {
            const src = `data:${img.media_type};base64,${img.data}`;

            return (
              <button
                key={i}
                className={styles.queuedAttachment}
                title={`Image ${i + 1}`}
                type="button"
                onClick={() => openImageViewer(src, `Attachment ${i + 1}`)}
              >
                <img
                  alt={`Attachment ${i + 1}`}
                  className={styles.queuedAttachmentImg}
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

interface QueuedMessageEditorProps {
  agentId: string;
  message: QueuedMessage;
  onDone: () => void;
}

function QueuedMessageEditor({
  agentId,
  message,
  onDone,
}: QueuedMessageEditorProps) {
  const [draft, setDraft] = useState(message.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      removeQueuedMessage(agentId, message.id);
    } else if (trimmed !== message.text) {
      updateQueuedMessage(agentId, message.id, trimmed);
    }
    onDone();
  }, [agentId, draft, message.id, message.text, onDone]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDone();
      }
    },
    [handleSave, onDone],
  );

  return (
    <textarea
      ref={textareaRef}
      className={styles.queuedEditArea}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleSave}
      rows={Math.min(8, Math.max(1, draft.split("\n").length))}
    />
  );
}
