import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import styles from "./DestructiveConfirm.module.css";

export interface DestructiveConfirmProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "destructive" | "warning";
  /**
   * If set, shows a "Don't ask again for <action>" checkbox. The current
   * checkbox value is passed to `onConfirm(skipNextTime)` so the consumer
   * can persist the preference however it wants.
   */
  rememberKey?: string;
  /** Optional human-readable label for the remember key (used in the checkbox copy). */
  rememberLabel?: string;
  onConfirm: (skipNextTime: boolean) => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for irreversible operations (stash drop, discard,
 * force-push, hard reset, …). Always renders a destructive-tinted confirm
 * button; supports an opt-in "don't ask again" checkbox the consumer can
 * persist via its own preferences store.
 */
export function DestructiveConfirm({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "destructive",
  rememberKey,
  rememberLabel,
  onConfirm,
  onCancel,
}: DestructiveConfirmProps) {
  const titleId = useId();
  const [skip, setSkip] = useState(false);

  if (!open) {
    return null;
  }

  return (
    <Dialog onClose={onCancel} title={title} titleId={titleId}>
      <DialogBody className={styles.body}>
        <div className={styles.description}>{description}</div>
        {rememberKey && (
          <label className={styles.rememberRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={skip}
              onChange={(e) => setSkip(e.target.checked)}
            />
            <span>
              Don&rsquo;t ask again
              {rememberLabel ? ` for ${rememberLabel}` : ""}
            </span>
          </label>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "destructive" ? "danger" : "primary"}
          onClick={() => onConfirm(skip)}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
