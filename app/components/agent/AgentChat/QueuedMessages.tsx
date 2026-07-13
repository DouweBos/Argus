import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Chip,
  Icons,
  QueuedMessage,
  QueuedMessageAction,
  QueuedMessageList,
} from "@argus/peacock";
import {
  buildLinkedProjectsPreamble,
  parseLinkedProjectsPreamble,
} from "../../../lib/linkedProjectsPreamble";
import {
  type QueuedMessage as QueuedMessageData,
  removeQueuedMessage,
  updateQueuedMessage,
} from "../../../stores/conversationStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import styles from "./AgentChat.module.css";

interface QueuedMessagesProps {
  agentId: string;
  messages: QueuedMessageData[];
}

export function QueuedMessages({ agentId, messages }: QueuedMessagesProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (messages.length === 0) {
    return null;
  }

  return (
    <QueuedMessageList className={styles.queuedSection}>
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
    </QueuedMessageList>
  );
}

interface QueuedMessageItemProps {
  agentId: string;
  editing: boolean;
  message: QueuedMessageData;
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

  const { linkedPaths, displayText } = useMemo(() => {
    const parsed = parseLinkedProjectsPreamble(message.text);
    if (!parsed) {
      return { linkedPaths: [] as string[], displayText: message.text };
    }

    return { linkedPaths: parsed.paths, displayText: parsed.rest };
  }, [message.text]);

  const handleDelete = useCallback(() => {
    removeQueuedMessage(agentId, message.id);
  }, [agentId, message.id]);

  return (
    <QueuedMessage
      text={editing ? undefined : displayText || undefined}
      actions={
        editing ? undefined : (
          <>
            <QueuedMessageAction
              icon={<Icons.PencilIcon size={11} />}
              label="Edit queued message"
              onClick={onStartEdit}
            />
            <QueuedMessageAction
              icon={<Icons.TrashIcon size={12} />}
              label="Delete queued message"
              onClick={handleDelete}
            />
          </>
        )
      }
      footer={
        <>
          {linkedPaths.length > 0 && (
            <div className={styles.queuedLinkedProjects}>
              {linkedPaths.map((path) => {
                const label = path.split("/").filter(Boolean).pop() ?? path;

                return (
                  <Chip
                    key={path}
                    muted
                    title={path}
                    leading={<Icons.FolderIcon size={11} />}
                  >
                    {label}
                  </Chip>
                );
              })}
            </div>
          )}
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
        </>
      }
    >
      {editing ? (
        <QueuedMessageEditor
          agentId={agentId}
          initialText={displayText}
          linkedPaths={linkedPaths}
          message={message}
          onDone={onStopEdit}
        />
      ) : undefined}
    </QueuedMessage>
  );
}

interface QueuedMessageEditorProps {
  agentId: string;
  initialText: string;
  linkedPaths: readonly string[];
  message: QueuedMessageData;
  onDone: () => void;
}

function QueuedMessageEditor({
  agentId,
  initialText,
  linkedPaths,
  message,
  onDone,
}: QueuedMessageEditorProps) {
  const [draft, setDraft] = useState(initialText);
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
    if (trimmed.length === 0 && linkedPaths.length === 0) {
      removeQueuedMessage(agentId, message.id);
    } else {
      const next = buildLinkedProjectsPreamble(linkedPaths, trimmed);
      if (next !== message.text) {
        updateQueuedMessage(agentId, message.id, next);
      }
    }
    onDone();
  }, [agentId, draft, linkedPaths, message.id, message.text, onDone]);

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
