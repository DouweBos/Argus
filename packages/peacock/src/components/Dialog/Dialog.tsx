import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../../icons/Icons";
import { useDismissOnEscape } from "../../lib/modalStack";
import styles from "./Dialog.module.css";

export type DialogSize = "content" | "full" | "medium";

export interface DialogProps {
  children: ReactNode;
  /** Optional className merged onto the dialog container. */
  className?: string;
  onClose: () => void;
  /**
   * `content` (default) — dialog hugs its children, capped at ~420px wide;
   * right for confirmations and short forms.
   *
   * `medium` — capped at ~640px; right for multi-field forms, pickers,
   * config panels.
   *
   * `full` — dialog fills most of the viewport (~min(1100px, 95vw) wide,
   * full max-height); right for workspace-style modals like PR detail where
   * content is long and layout stability matters.
   */
  size?: DialogSize;
  title: ReactNode;
  /** Optional extra content shown in the header (next to the title). */
  titleExtra?: ReactNode;
  /** Stable id used for `aria-labelledby`; required for a11y. */
  titleId: string;
}

/**
 * Standard modal dialog shell: blurred backdrop, dialog container, header with
 * title and close button. Body content is rendered as children.
 *
 * The backdrop only dismisses when both mousedown and mouseup land on it,
 * preventing accidental close when text-selecting inside the dialog.
 */
export function Dialog({
  children,
  className,
  onClose,
  size = "content",
  title,
  titleId,
  titleExtra,
}: DialogProps) {
  const mouseDownTarget = useRef<EventTarget | null>(null);
  useDismissOnEscape(onClose);

  const onOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownTarget.current = e.target;
  }, []);

  const onOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        e.target === e.currentTarget &&
        mouseDownTarget.current === e.currentTarget
      ) {
        onClose();
      }
    },
    [onClose],
  );

  const sizeClasses: Record<DialogSize, string> = {
    content: styles.content,
    medium: styles.medium,
    full: styles.full,
  };
  const sizeClass = sizeClasses[size];
  const dialogClass = [styles.dialog, sizeClass, className]
    .filter(Boolean)
    .join(" ");

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      onClick={onOverlayClick}
      onMouseDown={onOverlayMouseDown}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={dialogClass}
        role="dialog"
      >
        <div className={styles.header}>
          <h2 className={styles.title} id={titleId}>
            {title}
            {titleExtra}
          </h2>
          <button
            aria-label="Close"
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
          >
            <CloseIcon size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
