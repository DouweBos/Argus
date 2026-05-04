import type {
  ConversationMessage,
  ToolCallInfo,
} from "../../../stores/conversationStore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  HoverActionBar,
  HoverActionButton,
  Icons,
} from "@argus/peacock";
import { showImageContextMenu } from "../../../lib/ipc";
import {
  buildLinkedProjectsPreamble,
  parseLinkedProjectsPreamble,
} from "../../../lib/linkedProjectsPreamble";
import {
  markMessageUnread,
  useIsMessageUnread,
} from "../../../stores/conversationStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { Markdown } from "../../shared/Markdown";
import { FileLinkHandler, MentionedText } from "../FileLinkHandler";
import { ToolCallCard } from "../ToolCallCard";
import styles from "./ChatMessage.module.css";

function TimestampGutter({ timestamp }: { timestamp: number }) {
  const d = new Date(timestamp);
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

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
  onSaveToolCallToDisk?: (toolCall: ToolCallInfo) => void;
}

function MessageActions({
  onCopy,
  onEdit,
  onFork,
  onMarkUnread,
  placement,
}: {
  onCopy?: () => void;
  onEdit?: () => void;
  onFork?: () => void;
  onMarkUnread?: () => void;
  placement: "top-left" | "top-right";
}) {
  if (!onCopy && !onFork && !onEdit && !onMarkUnread) {
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
      {onMarkUnread && (
        <HoverActionButton
          icon={<Icons.EnvelopeIcon size={12} />}
          label="Mark as unread"
          onClick={onMarkUnread}
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
  const handleMarkUnread =
    agentId && message.role === "assistant" && !isUnread
      ? () => markMessageUnread(agentId, message.id)
      : undefined;
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
        <div className={styles.mcpMsg}>
          <TimestampGutter timestamp={message.timestamp} />
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
        <TimestampGutter timestamp={message.timestamp} />
        {trimmed.map((text, i) => (
          <span key={i}>{text}</span>
        ))}
      </div>
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
            style={bubbleSize ? { width: bubbleSize.width } : undefined}
          >
            <textarea
              ref={editRef}
              className={styles.userEditArea}
              style={bubbleSize ? { minHeight: bubbleSize.height } : undefined}
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
      <div ref={userMsgRef} className={styles.userMsg}>
        <TimestampGutter timestamp={message.timestamp} />
        <MessageActions
          onCopy={handleCopy}
          onEdit={handleStartEdit}
          onFork={handleFork}
          placement="top-right"
        />
        {trimmedUserBlocks.length > 0 && (
          <FileLinkHandler className={styles.userTextWrap}>
            {trimmedUserBlocks.map((text, i) => (
              <p key={i} className={styles.userText} data-bubble-text="">
                <MentionedText text={text} />
              </p>
            ))}
          </FileLinkHandler>
        )}
        {linkedPaths.length > 0 && (
          <div className={styles.userLinkedProjects}>
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
      data-message-id={message.id}
      data-unread={isUnread ? "" : undefined}
    >
      <TimestampGutter timestamp={message.timestamp} />
      {!toolOnly && (
        <MessageActions
          onCopy={handleCopy}
          onFork={handleFork}
          onMarkUnread={handleMarkUnread}
          placement="top-right"
        />
      )}
      {hasText && (
        <FileLinkHandler className={styles.textContent}>
          {trimmedBlocks.map((text, i) => (
            <Markdown key={i} className={styles.markdown} text={text} />
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
              onSaveToDisk={onSaveToolCallToDisk}
            />
          ))}
        </div>
      )}
    </div>
  );
}
