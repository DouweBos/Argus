import {
  buildLinkedProjectsPreamble,
  parseLinkedProjectsPreamble,
} from "@argus/client-core";
import {
  Icons,
  QueuedMessage,
  QueuedMessageAction,
  QueuedMessageEditor,
} from "@argus/peacock";
import type { RemoteQueuedMessage } from "../../lib/protocol";
import { useAgentsStore } from "../../stores/agents";

/**
 * One message still waiting in the queue: editable in place, since a remote is
 * usually where you notice you've typed the wrong thing.
 */
export function QueuedRow({
  agentId,
  editing,
  message,
  onStartEdit,
  onStopEdit,
}: {
  agentId: string;
  editing: boolean;
  message: RemoteQueuedMessage;
  onStartEdit: () => void;
  onStopEdit: () => void;
}) {
  const removeQueued = useAgentsStore((s) => s.removeQueued);
  const updateQueued = useAgentsStore((s) => s.updateQueued);
  const sendQueuedNow = useAgentsStore((s) => s.sendQueuedNow);

  // `text` carries the linked-projects preamble; the editor only ever shows
  // what the user typed, and the preamble is rebuilt around whatever they save.
  const parsed = parseLinkedProjectsPreamble(message.text);
  const linkedPaths = parsed?.paths ?? [];
  const displayText = parsed?.rest ?? message.display_text ?? message.text;

  const remove = () => {
    // Dropping it throws away what you typed, so ask first.
    if (
      !window.confirm(
        `Remove this queued message?\n\n${displayText.slice(0, 200)}`,
      )
    ) {
      return;
    }
    removeQueued(agentId, message.id).catch(() => {});
  };

  return (
    <QueuedMessage
      author={message.author}
      text={editing ? undefined : displayText}
      actions={
        editing ? undefined : (
          <>
            <QueuedMessageAction
              icon={<Icons.SendIcon size={11} />}
              label="Send now (joins the current turn)"
              onClick={() => {
                sendQueuedNow(agentId, message.id).catch(() => {});
              }}
            />
            <QueuedMessageAction
              icon={<Icons.PencilIcon size={11} />}
              label="Edit queued message"
              onClick={onStartEdit}
            />
            <QueuedMessageAction
              icon={<Icons.CloseIcon size={12} />}
              label="Remove queued message"
              onClick={remove}
            />
          </>
        )
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
              removeQueued(agentId, message.id).catch(() => {});
            } else {
              const next = buildLinkedProjectsPreamble(linkedPaths, text);
              if (next !== message.text) {
                updateQueued(agentId, message.id, next).catch(() => {});
              }
            }
            onStopEdit();
          }}
        />
      ) : undefined}
    </QueuedMessage>
  );
}
