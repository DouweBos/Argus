import type { QueuedMessage as QueuedMessageData } from "../../../lib/types";
import { useCallback, useMemo, useState } from "react";
import {
  Chip,
  Icons,
  QueuedMessage,
  QueuedMessageAction,
  QueuedMessageEditor,
  QueuedMessageList,
} from "@argus/peacock";
import {
  buildLinkedProjectsPreamble,
  parseLinkedProjectsPreamble,
} from "../../../lib/linkedProjectsPreamble";
import { openImageViewer } from "../../../stores/imageViewerStore";
import {
  removeQueuedMessage,
  sendQueuedMessageNow,
  updateQueuedMessage,
} from "../../../stores/queueStore";
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

  const handleSendNow = useCallback(() => {
    sendQueuedMessageNow(agentId, message.id);
  }, [agentId, message.id]);

  return (
    <QueuedMessage
      author={message.author}
      text={editing ? undefined : displayText || undefined}
      actions={
        editing ? undefined : (
          <>
            <QueuedMessageAction
              icon={<Icons.SendIcon size={11} />}
              label="Send now (joins the current turn)"
              onClick={handleSendNow}
            />
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
          initialText={displayText}
          onCancel={onStopEdit}
          onSave={(text) => {
            // Cleared to nothing with no projects attached is a delete — there
            // would be no message left to send.
            if (text.length === 0 && linkedPaths.length === 0) {
              removeQueuedMessage(agentId, message.id);
            } else {
              const next = buildLinkedProjectsPreamble(linkedPaths, text);
              if (next !== message.text) {
                updateQueuedMessage(agentId, message.id, next);
              }
            }
            onStopEdit();
          }}
        />
      ) : undefined}
    </QueuedMessage>
  );
}
