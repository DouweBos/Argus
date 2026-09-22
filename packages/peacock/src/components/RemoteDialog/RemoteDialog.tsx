import { useEffect, useId, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { Input } from "../Input/Input";
import styles from "./RemoteDialog.module.css";

export interface RemoteDialogResult {
  name: string;
  fetchUrl: string;
  pushUrl?: string;
}

export interface RemoteDialogProps {
  open: boolean;
  mode: "add" | "edit";
  defaultName?: string;
  defaultFetchUrl?: string;
  defaultPushUrl?: string;
  /** Inline validation message shown below the URL field. */
  validationError?: string;
  onConfirm: (result: RemoteDialogResult) => void;
  onCancel: () => void;
}

/**
 * Add / edit a git remote. The push URL field is optional — leaving it empty
 * means the remote uses the fetch URL for both directions.
 */
export function RemoteDialog({
  open,
  mode,
  defaultName = "",
  defaultFetchUrl = "",
  defaultPushUrl = "",
  validationError,
  onConfirm,
  onCancel,
}: RemoteDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const fetchId = useId();
  const pushId = useId();

  const [name, setName] = useState(defaultName);
  const [fetchUrl, setFetchUrl] = useState(defaultFetchUrl);
  const [pushUrl, setPushUrl] = useState(defaultPushUrl);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setFetchUrl(defaultFetchUrl);
      setPushUrl(defaultPushUrl);
    }
  }, [open, defaultName, defaultFetchUrl, defaultPushUrl]);

  if (!open) {
    return null;
  }

  const submit = () => {
    if (!name.trim() || !fetchUrl.trim()) {
      return;
    }
    const result: RemoteDialogResult = {
      name: name.trim(),
      fetchUrl: fetchUrl.trim(),
    };
    if (pushUrl.trim().length > 0 && pushUrl.trim() !== fetchUrl.trim()) {
      result.pushUrl = pushUrl.trim();
    }
    onConfirm(result);
  };

  const title = mode === "add" ? "Add remote" : "Edit remote";
  const confirmLabel = mode === "add" ? "Add remote" : "Save";

  return (
    <Dialog onClose={onCancel} title={title} titleId={titleId}>
      <DialogBody className={styles.body}>
        <label className={styles.fieldLabel} htmlFor={nameId}>
          Name
        </label>
        <Input
          autoFocus
          id={nameId}
          placeholder="origin"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={mode === "edit"}
        />

        <label className={styles.fieldLabel} htmlFor={fetchId}>
          Fetch URL
        </label>
        <Input
          id={fetchId}
          placeholder="git@github.com:owner/repo.git"
          value={fetchUrl}
          onChange={(e) => setFetchUrl(e.target.value)}
        />
        {validationError && (
          <div className={styles.error}>{validationError}</div>
        )}

        <label className={styles.fieldLabel} htmlFor={pushId}>
          Push URL (optional)
        </label>
        <Input
          id={pushId}
          placeholder="Same as fetch URL"
          value={pushUrl}
          onChange={(e) => setPushUrl(e.target.value)}
        />
        <span className={styles.hint}>
          Set a separate push URL only if your provider requires it.
        </span>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!name.trim() || !fetchUrl.trim()}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
