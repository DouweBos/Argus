import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../Avatar/Avatar";
import styles from "./QueuedMessage.module.css";

export interface QueuedMessageListProps extends HTMLAttributes<HTMLDivElement> {
  /** Section heading above the queued rows. */
  label?: string;
  children: ReactNode;
}

/** Section wrapping a stack of queued messages with an eyebrow label. */
export function QueuedMessageList({
  label = "Queued",
  children,
  className,
  ...rest
}: QueuedMessageListProps) {
  return (
    <div
      className={[styles.section, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}

export interface QueuedMessageProps {
  /** Message text, shown in the default dashed bubble. Ignored when `children` is set. */
  text?: string;
  /** Custom body (e.g. an inline editor) replacing the default text bubble. */
  children?: ReactNode;
  /** Hover actions pinned to the row's top-right (e.g. edit / remove buttons). */
  actions?: ReactNode;
  /** Content beneath the row — linked-project chips, attachment thumbnails. */
  footer?: ReactNode;
  /** Who queued it, when someone other than the local user did (huddle guest). */
  author?: string;
}

/** A single queued message awaiting flush: dashed bubble + hover actions + footer. */
export function QueuedMessage({
  text,
  children,
  actions,
  footer,
  author,
}: QueuedMessageProps) {
  const body =
    children ?? (text ? <div className={styles.message}>{text}</div> : null);

  return (
    <div className={styles.wrap}>
      {author && (
        <div className={styles.author}>
          <Avatar name={author} size={16} />
          <span className={styles.authorName}>{author}</span>
        </div>
      )}
      <div className={styles.row}>
        {body}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {footer}
    </div>
  );
}

export interface QueuedMessageActionProps {
  /** Icon glyph for the button. */
  icon: ReactNode;
  /** Accessible label + tooltip. */
  label: string;
  onClick: () => void;
}

/** A compact bordered action button styled for a queued message row. */
export function QueuedMessageAction({
  icon,
  label,
  onClick,
}: QueuedMessageActionProps) {
  return (
    <button
      type="button"
      className={styles.actionButton}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export interface QueuedMessageEditorProps {
  /** Text the editor opens on — the message without any machine preamble. */
  initialText: string;
  /**
   * Commit the edit. Fires on Enter and on blur, so the caller must tolerate
   * being handed the same text twice; an empty string means "the user cleared
   * it", which callers generally treat as a delete.
   */
  onSave: (text: string) => void;
  /** Escape — leave the message exactly as it was. */
  onCancel: () => void;
}

/**
 * Inline editor for a message still waiting in the queue. Enter saves and
 * Shift+Enter adds a line, matching the composer it was typed in; blur saves
 * too, so clicking away doesn't silently throw the edit out.
 */
export function QueuedMessageEditor({
  initialText,
  onSave,
  onCancel,
}: QueuedMessageEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Blur fires on unmount after Escape too, which would save what the user just
  // discarded.
  const cancelled = useRef(false);

  useEffect(() => {
    const ta = ref.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  const save = () => {
    if (!cancelled.current) {
      onSave(draft.trim());
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled.current = true;
      onCancel();
    }
  };

  return (
    <textarea
      ref={ref}
      aria-label="Edit queued message"
      className={styles.editArea}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={save}
      rows={Math.min(8, Math.max(1, draft.split("\n").length))}
    />
  );
}
