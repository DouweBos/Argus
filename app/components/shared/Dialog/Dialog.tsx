import type { ReactNode } from "react";
import { useOverlayDismiss } from "../../../hooks/useOverlayDismiss";
import { CloseIcon } from "../Icons";
import styles from "./Dialog.module.css";

interface DialogProps {
  children: ReactNode;
  /** Optional className merged onto the dialog container (e.g. styles.dialogLarge). */
  className?: string;
  onClose: () => void;
  title: ReactNode;
  /** Optional extra content shown in the header (next to the title). */
  titleExtra?: ReactNode;
  /** Stable id used for `aria-labelledby`; required for a11y. */
  titleId: string;
}

/**
 * Standard modal dialog shell: backdrop overlay, dialog container, header with
 * title and close button. Body content is rendered as children — consumers
 * supply their own `<form>` or scrollable container using classes from
 * `Dialog.module.css`.
 */
export function Dialog({
  children,
  className,
  onClose,
  title,
  titleId,
  titleExtra,
}: DialogProps) {
  const overlay = useOverlayDismiss(onClose);
  const dialogClass = className
    ? `${styles.dialog} ${className}`
    : styles.dialog;

  return (
    <div className={styles.overlay} {...overlay}>
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
          >
            <CloseIcon size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
