/**
 * Dialog shown after dropping one or more file rows onto the Stashes sidebar
 * entry. Lets the user enter an optional stash message before the partial
 * stash (`git stash push -- <paths>`) runs.
 */
import { useId, useState } from "react";
import { Button, Dialog, Input } from "@argus/peacock";
import styles from "./SidebarRefSection.module.css";

interface StashFromDropDialogProps {
  onCancel: () => void;
  onConfirm: (message: string | undefined) => void;
  paths: string[];
}

export function StashFromDropDialog({
  paths,
  onCancel,
  onConfirm,
}: StashFromDropDialogProps) {
  const titleId = useId();
  const [message, setMessage] = useState("");

  const submit = () => {
    const trimmed = message.trim();
    onConfirm(trimmed.length > 0 ? trimmed : undefined);
  };

  const summary =
    paths.length === 1
      ? paths[0]
      : `${paths.length} files (${paths.slice(0, 2).join(", ")}${paths.length > 2 ? ", …" : ""})`;

  return (
    <Dialog title="Stash dropped files" titleId={titleId} onClose={onCancel}>
      <div className={styles.dialogBody}>
        <p className={styles.dialogDesc}>
          Stash {summary} into a new entry. The stash will only contain the
          selected paths.
        </p>
        <Input
          autoFocus
          placeholder="Optional stash message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className={styles.dialogFooter}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          Stash
        </Button>
      </div>
    </Dialog>
  );
}
