import type {
  ConversationMessage,
  ToolCallInfo,
} from "../../../stores/conversationStore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  HoverActionButton,
  Icons,
  MessageBubble,
  type MessageImage,
} from "@argus/peacock";
import { showImageContextMenu } from "../../../lib/ipc";
import {
  buildLinkedProjectsPreamble,
  parseLinkedProjectsPreamble,
} from "../../../lib/linkedProjectsPreamble";
import { useIsMessageUnread } from "../../../stores/conversationStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { Markdown } from "../../shared/Markdown";
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
  ) => Promise<void> | void;
  onRestore?: (message: ConversationMessage) => void;
  onSaveToolCallToDisk?: (toolCall: ToolCallInfo) => void;
}

function TimestampGutter({ timestamp }: { timestamp: number }) {
  const d = new Date(timestamp);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <time
      className={styles.timestamp}
      dateTime={d.toISOString()}
      title={d.toLocaleString()}
    >
      {time}
    </time>
  );
}

function MessageActions({
  onCopy,
  onEdit,
  onFork,
  onRestore,
}: {
  onCopy?: () => void;
  onEdit?: () => void;
  onFork?: () => void;
  onRestore?: () => void;
}) {
  if (!onCopy && !onEdit && !onFork && !onRestore) {
    return null;
  }

  return (
    <>
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
      {onRestore && (
        <HoverActionButton
          icon={<Icons.HistoryIcon size={12} />}
          label="Restore files and chat to this point"
          onClick={onRestore}
        />
      )}
      {onFork && (
        <HoverActionButton
          icon={<Icons.BranchIcon size={12} />}
          label="Fork workspace and chat from here"
          onClick={onFork}
        />
      )}
    </>
  );
}

/** Build MessageImage descriptors for an attachment strip. */
function toMessageImages(
  images: { data: string; media_type: string }[],
  ctxPrefix: string,
): MessageImage[] {
  return images.map((img, i) => {
    const src = `data:${img.media_type};base64,${img.data}`;
    const alt = `Attachment ${i + 1}`;

    return {
      src,
      alt,
      onActivate: () => openImageViewer(src, alt),
      onContextMenu: (e) => {
        e.preventDefault();
        showImageContextMenu(src, `${ctxPrefix}-${i + 1}`);
      },
    };
  });
}

export function ChatMessage({
  agentId,
  message,
  onCopy,
  onEdit,
  onFork,
  onPermissionRespond,
  onRestore,
  onSaveToolCallToDisk,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [bubbleSize, setBubbleSize] = useState<{
    height: number;
    width: number;
  } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const userMsgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      const len = editRef.current.value.length;
      editRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const isUnread = useIsMessageUnread(agentId, message.id);

  const handleCopy = onCopy ? () => onCopy(message) : undefined;
  const handleFork = onFork ? () => onFork(message) : undefined;
  const handleRestore =
    onRestore && message.checkpointId ? () => onRestore(message) : undefined;
  const handleStartEdit = onEdit
    ? () => {
        const root = userMsgRef.current;
        if (root) {
          const paragraphs =
            root.querySelectorAll<HTMLElement>("[data-bubble-text]");
          let maxW = 0;
          let totalH = 0;
          paragraphs.forEach((p) => {
            const r = p.getBoundingClientRect();
            if (r.width > maxW) {
              maxW = r.width;
            }
            totalH += r.height;
          });
          if (paragraphs.length > 1) {
            totalH += (paragraphs.length - 1) * 8;
          }
          if (maxW > 0 && totalH > 0) {
            setBubbleSize({ width: maxW, height: totalH });
          } else {
            setBubbleSize(null);
          }
        }
        const first = message.textBlocks[0];
        const parsedForEdit =
          first !== undefined ? parseLinkedProjectsPreamble(first) : null;
        let seedBlocks = message.textBlocks;
        if (parsedForEdit) {
          seedBlocks =
            parsedForEdit.rest.length > 0
              ? [parsedForEdit.rest, ...message.textBlocks.slice(1)]
              : message.textBlocks.slice(1);
        }
        setDraft(seedBlocks.join("\n\n"));
        setIsEditing(true);
      }
    : undefined;

  const editPreamblePaths = useMemo(() => {
    const first = message.textBlocks[0];
    if (first === undefined) {
      return [] as string[];
    }
    const parsed = parseLinkedProjectsPreamble(first);

    return parsed?.paths ?? [];
  }, [message.textBlocks]);

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || !onEdit) {
      return;
    }
    const next = buildLinkedProjectsPreamble(editPreamblePaths, trimmed);
    if (next === message.textBlocks.join("\n\n").trim()) {
      setIsEditing(false);

      return;
    }
    onEdit(message, next);
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
        <MessageBubble
          role="system"
          mcp={{ label: sourceLabel }}
          timestamp={message.timestamp}
          textBlocks={trimmed}
          renderText={(text) => <MentionedText text={text} />}
          images={toMessageImages(images, "mcp-attachment")}
          Container={FileLinkHandler}
        />
      );
    }

    return (
      <MessageBubble
        role="system"
        tone={message.tone}
        timestamp={message.timestamp}
        textBlocks={trimmed}
      />
    );
  }

  if (message.role === "user") {
    const images = message.images ?? [];
    // The first text block may carry the synthetic "[Linked project
    // directories — …]" preamble. Surface those paths as chips and hide the
    // raw bracket text from the bubble.
    const rawBlocks = message.textBlocks;
    let linkedPaths: string[] = [];
    let displayBlocks = rawBlocks;
    if (rawBlocks.length > 0) {
      const parsed = parseLinkedProjectsPreamble(rawBlocks[0]);
      if (parsed) {
        linkedPaths = parsed.paths;
        displayBlocks =
          parsed.rest.length > 0
            ? [parsed.rest, ...rawBlocks.slice(1)]
            : rawBlocks.slice(1);
      }
    }
    const trimmedUserBlocks = displayBlocks
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (
      trimmedUserBlocks.length === 0 &&
      images.length === 0 &&
      linkedPaths.length === 0
    ) {
      return null;
    }

    if (isEditing) {
      return (
        <div ref={userMsgRef} className={styles.userMsg}>
          <TimestampGutter timestamp={message.timestamp} />
          <div
            className={styles.userEdit}
            style={bubbleSize ? { minWidth: bubbleSize.width } : undefined}
          >
            <div className={styles.userEditGrow} data-value={draft}>
              <textarea
                ref={editRef}
                cols={1}
                rows={1}
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
            </div>
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

    // Derive from the raw props (not the ref-reading `handleStartEdit`
    // closure) so this stays a pure render-time check.
    const hasUserActions = !!(
      onCopy ||
      onEdit ||
      onFork ||
      (onRestore && message.checkpointId)
    );
    const userActions = hasUserActions ? (
      <MessageActions
        onCopy={handleCopy}
        onEdit={handleStartEdit}
        onFork={handleFork}
        onRestore={handleRestore}
      />
    ) : undefined;

    const chips =
      linkedPaths.length > 0
        ? linkedPaths.map((path) => {
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
          })
        : undefined;

    return (
      <MessageBubble
        role="user"
        rootRef={userMsgRef}
        author={message.author}
        timestamp={message.timestamp}
        textBlocks={trimmedUserBlocks}
        renderText={(text) => <MentionedText text={text} />}
        actions={userActions}
        chips={chips}
        images={toMessageImages(images, "attachment")}
        Container={FileLinkHandler}
      />
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

  const assistantActions =
    handleCopy || handleFork ? (
      <MessageActions onCopy={handleCopy} onFork={handleFork} />
    ) : undefined;

  const toolCallsNode = hasToolCalls
    ? message.toolCalls.map((tc) => (
        <ToolCallCard
          key={tc.id}
          agentId={agentId}
          toolCall={tc}
          onFork={handleFork}
          onPermissionRespond={onPermissionRespond}
          onSaveToDisk={onSaveToolCallToDisk}
        />
      ))
    : undefined;

  return (
    <MessageBubble
      role="assistant"
      messageId={message.id}
      unread={isUnread}
      toolOnly={toolOnly}
      timestamp={message.timestamp}
      textBlocks={trimmedBlocks}
      renderMarkdown={(text) => (
        <Markdown className={styles.markdown} text={text} />
      )}
      actions={assistantActions}
      toolCalls={toolCallsNode}
      Container={FileLinkHandler}
    />
  );
}
