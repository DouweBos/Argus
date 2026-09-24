import type { ComponentType, MouseEvent, ReactNode, Ref } from "react";
import { Avatar } from "../Avatar/Avatar";
import { HoverActionBar } from "../HoverActionBar/HoverActionBar";
import { Markdown } from "../Markdown/Markdown";
import styles from "./MessageBubble.module.css";

export interface MessageImage {
  src: string;
  alt: string;
  onActivate?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void;
}

export interface MessageBubbleProps {
  role: "assistant" | "system" | "user";
  timestamp?: number;
  /**
   * Severity of a system notice. `error` for a failure (stderr, a dead
   * process), `warning` for a diagnostic the run survived. Omit for a plain
   * divider.
   */
  tone?: "error" | "warning";
  unread?: boolean;
  messageId?: string;
  /** True for an assistant message that contains only tool calls (tight stack). */
  toolOnly?: boolean;
  /** Visible text blocks — trimmed/filtered by the consumer. */
  textBlocks: string[];
  /** Render user/system/mcp plain text (linkified on desktop). Default: raw. */
  renderText?: (text: string) => ReactNode;
  /** Render assistant markdown. Default: Peacock Markdown. */
  renderMarkdown?: (text: string) => ReactNode;
  /** MCP framing for a system message (renders a full-width card). */
  mcp?: { label: string };
  /**
   * Who sent this user message, when it wasn't the person reading it — a
   * huddle guest or a remote client. Omitted for the local user's own sends.
   */
  author?: string;
  /** Hover action buttons (desktop copy/edit/fork/restore). */
  actions?: ReactNode;
  /** Rendered tool calls (assistant). */
  toolCalls?: ReactNode;
  /** Linked-project chips (user). */
  chips?: ReactNode;
  /** Image attachments (user / mcp). */
  images?: MessageImage[];
  /** Link-click delegation wrapper for text (desktop FileLinkHandler). */
  Container?: ComponentType<{ className?: string; children: ReactNode }>;
  /** Ref on the role container — e.g. desktop edit-mode bubble measurement. */
  rootRef?: Ref<HTMLDivElement>;
}

const DefaultContainer: ComponentType<{
  className?: string;
  children: ReactNode;
}> = ({ className, children }) => <div className={className}>{children}</div>;

function TimestampGutter({ timestamp }: { timestamp?: number }) {
  if (timestamp == null) {
    return null;
  }
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

function Attachments({
  images,
  wrapClass,
  buttonClass,
  imgClass,
}: {
  images: MessageImage[];
  wrapClass: string;
  buttonClass: string;
  imgClass: string;
}) {
  return (
    <div className={wrapClass}>
      {images.map((img, i) => (
        <button
          key={i}
          className={buttonClass}
          title={img.alt}
          type="button"
          onClick={img.onActivate}
          onContextMenu={img.onContextMenu}
        >
          <img alt={img.alt} className={imgClass} src={img.src} />
        </button>
      ))}
    </div>
  );
}

/**
 * Role-bubble chrome shared by the desktop chat and web client — user bubble,
 * assistant block, plain system divider, and MCP card. Text rendering is
 * injected (`renderText` / `renderMarkdown`); tool calls, actions, chips and
 * image viewers are slots so each platform wires its own behaviour.
 */
export function MessageBubble({
  role,
  timestamp,
  tone,
  unread,
  messageId,
  toolOnly,
  textBlocks,
  mcp,
  author,
  actions,
  toolCalls,
  chips,
  images,
  renderText = (t) => t,
  renderMarkdown,
  Container = DefaultContainer,
  rootRef,
}: MessageBubbleProps) {
  const renderMd =
    renderMarkdown ?? ((text: string) => <Markdown text={text} />);

  if (role === "system") {
    if (mcp) {
      return (
        <div className={styles.mcpMsg} ref={rootRef}>
          <TimestampGutter timestamp={timestamp} />
          <div className={styles.mcpHeader}>
            <span className={styles.mcpBadge}>MCP</span>
            <span className={styles.mcpLabel}>{mcp.label}</span>
          </div>
          <Container className={styles.mcpBody}>
            {textBlocks.map((text, i) => (
              <p key={i} className={styles.mcpText}>
                {renderText(text)}
              </p>
            ))}
          </Container>
          {images && images.length > 0 && (
            <Attachments
              images={images}
              wrapClass={styles.mcpAttachments}
              buttonClass={styles.mcpAttachment}
              imgClass={styles.mcpAttachmentImg}
            />
          )}
        </div>
      );
    }

    return (
      <div
        className={`${styles.systemMsg}${toneClass(tone)}`}
        ref={rootRef}
      >
        <TimestampGutter timestamp={timestamp} />
        {textBlocks.map((text, i) => (
          <span key={i}>{text}</span>
        ))}
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className={styles.userMsg} ref={rootRef}>
        <TimestampGutter timestamp={timestamp} />
        {author && (
          <div className={styles.userAuthor}>
            <Avatar name={author} size={16} />
            <span className={styles.userAuthorName}>{author}</span>
          </div>
        )}
        {actions && (
          <HoverActionBar className={styles.actions} placement="top-right">
            {actions}
          </HoverActionBar>
        )}
        {textBlocks.length > 0 && (
          <Container className={styles.userTextWrap}>
            {textBlocks.map((text, i) => (
              <p key={i} className={styles.userText} data-bubble-text="">
                {renderText(text)}
              </p>
            ))}
          </Container>
        )}
        {chips && <div className={styles.userLinkedProjects}>{chips}</div>}
        {images && images.length > 0 && (
          <Attachments
            images={images}
            wrapClass={styles.userAttachments}
            buttonClass={styles.userAttachment}
            imgClass={styles.userAttachmentImg}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`${styles.assistantMsg} ${toolOnly ? styles.assistantMsgToolOnly : ""}`}
      data-message-id={messageId}
      data-unread={unread ? "" : undefined}
      ref={rootRef}
    >
      <TimestampGutter timestamp={timestamp} />
      {!toolOnly && actions && (
        <HoverActionBar className={styles.actions} placement="top-right">
          {actions}
        </HoverActionBar>
      )}
      {textBlocks.length > 0 && (
        <Container className={styles.textContent}>
          {textBlocks.map((text, i) => (
            <div key={i}>{renderMd(text)}</div>
          ))}
        </Container>
      )}
      {toolCalls && <div className={styles.toolCallsSection}>{toolCalls}</div>}
    </div>
  );
}

function toneClass(tone: MessageBubbleProps["tone"]): string {
  if (tone === "error") {
    return ` ${styles.systemMsgError}`;
  }
  if (tone === "warning") {
    return ` ${styles.systemMsgWarning}`;
  }

  return "";
}
