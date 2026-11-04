import { useState } from "react";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import styles from "./AccountMemberActions.module.css";

export interface AccountMemberActionsProps {
  name: string;
  canRename: boolean;
  canRemove: boolean;
  /** Settles once the rename is on the account; a rejection goes to `onError`. */
  onRename: (name: string) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onChanged?: () => void;
  onError: (message: string) => void;
}

/**
 * Rename and Remove for one device or computer on an Argus account: an inline
 * name field, and an inline "Remove …?" confirmation.
 */
export function AccountMemberActions({
  name,
  canRename,
  canRemove,
  onRename,
  onRemove,
  onChanged,
  onError,
}: AccountMemberActionsProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    action()
      .then(() => {
        setDraft(null);
        setConfirming(false);
        onChanged?.();
      })
      .catch((e: unknown) =>
        onError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(false));
  };

  if (draft !== null) {
    return (
      <form
        className={styles.actions}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => onRename(draft));
        }}
      >
        <Input
          aria-label={`New name for ${name}`}
          value={draft}
          maxLength={64}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <Button
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => setDraft(null)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy || draft.trim() === ""}>
          Save
        </Button>
      </form>
    );
  }
  if (confirming) {
    return (
      <div className={styles.actions}>
        <span className={styles.prompt}>Remove {name}?</span>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Keep
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => run(onRemove)}>
          Remove
        </Button>
      </div>
    );
  }
  if (!canRename && !canRemove) {
    return null;
  }

  return (
    <div className={styles.actions}>
      {canRename && (
        <Button variant="ghost" onClick={() => setDraft(name)}>
          Rename
        </Button>
      )}
      {canRemove && (
        <Button variant="ghost" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      )}
    </div>
  );
}
