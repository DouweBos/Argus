import { useEffect, useId, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { Input } from "../Input/Input";
import styles from "./TagDialog.module.css";

export interface TagDialogConfirm {
  name: string;
  ref?: string;
  message?: string;
  sign?: boolean;
}

export interface TagDialogProps {
  open: boolean;
  mode: "create" | "delete";
  defaultName?: string;
  defaultRef?: string;
  /** Optional list of refs the user can pick as the tag target. */
  refOptions?: string[];
  onConfirm: (opts: TagDialogConfirm) => void;
  onCancel: () => void;
}

/**
 * Modal dialog for `git tag` create / delete. Annotated mode kicks in when
 * the user types a message; an optional sign checkbox surfaces `git tag -s`.
 */
export function TagDialog({
  open,
  mode,
  defaultName = "",
  defaultRef,
  refOptions,
  onConfirm,
  onCancel,
}: TagDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const refId = useId();
  const messageId = useId();
  const signId = useId();

  const [name, setName] = useState(defaultName);
  const [ref, setRef] = useState(defaultRef ?? "HEAD");
  const [message, setMessage] = useState("");
  const [sign, setSign] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setRef(defaultRef ?? "HEAD");
      setMessage("");
      setSign(false);
    }
  }, [open, defaultName, defaultRef]);

  if (!open) {
    return null;
  }

  const submit = () => {
    if (!name.trim()) {
      return;
    }
    if (mode === "delete") {
      onConfirm({ name: name.trim() });

      return;
    }
    const result: TagDialogConfirm = { name: name.trim() };
    if (ref && ref !== "HEAD") {
      result.ref = ref;
    }
    if (message.trim().length > 0) {
      result.message = message;
    }
    if (sign) {
      result.sign = true;
    }
    onConfirm(result);
  };

  const title = mode === "create" ? "New tag" : "Delete tag";
  const confirmLabel = mode === "create" ? "Create tag" : "Delete tag";

  return (
    <Dialog onClose={onCancel} title={title} titleId={titleId}>
      <div className={styles.body}>
        <label className={styles.fieldLabel} htmlFor={nameId}>
          Tag name
        </label>
        <Input
          autoFocus
          id={nameId}
          placeholder="v1.2.3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />

        {mode === "create" && (
          <>
            <label className={styles.fieldLabel} htmlFor={refId}>
              At ref
            </label>
            {refOptions && refOptions.length > 0 ? (
              <select
                id={refId}
                className={styles.select}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              >
                <option value="HEAD">HEAD (current)</option>
                {refOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={refId}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            )}

            <label className={styles.fieldLabel} htmlFor={messageId}>
              Message (annotated tag)
            </label>
            <textarea
              id={messageId}
              className={styles.textarea}
              placeholder="Leave empty for a lightweight tag"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />

            <label className={styles.checkRow} htmlFor={signId}>
              <input
                id={signId}
                type="checkbox"
                className={styles.checkbox}
                checked={sign}
                onChange={(e) => setSign(e.target.checked)}
              />
              <span>Sign tag with GPG (-s)</span>
            </label>
          </>
        )}

        {mode === "delete" && (
          <div className={styles.warning}>
            This removes the tag locally. Use Push tag to remove it from the
            remote separately.
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={mode === "delete" ? "danger" : "primary"}
          onClick={submit}
          disabled={!name.trim()}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
