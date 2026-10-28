import { useState } from "react";
import { Button, Input } from "@argus/peacock";
import { accountRenameMember, accountRevokeMember } from "../../../lib/ipc";
import styles from "./AccountSection.module.css";

/**
 * Rename and Remove for one account member. `canRename`/`canRemove` follow
 * who may sign: this window's device for anyone, the host only for itself.
 */
export function AccountMemberActions({
  id,
  name,
  canRemove,
  canRename,
  onChanged,
  onError,
}: {
  canRemove: boolean;
  canRename: boolean;
  id: string;
  name: string;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = (action: () => Promise<unknown>) => {
    action()
      .then(() => {
        setDraft(null);
        setConfirming(false);
        onChanged();
      })
      .catch((e: unknown) =>
        onError(e instanceof Error ? e.message : String(e)),
      );
  };

  if (draft !== null) {
    return (
      <form
        className={styles.actions}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => accountRenameMember(id, draft));
        }}
      >
        <Input
          aria-label={`New name for ${name}`}
          value={draft}
          maxLength={64}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <Button variant="ghost" type="button" onClick={() => setDraft(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={draft.trim() === ""}>
          Save
        </Button>
      </form>
    );
  }
  if (confirming) {
    return (
      <div className={styles.actions}>
        <span className={styles.muted}>Remove {name}?</span>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Keep
        </Button>
        <Button
          variant="danger"
          onClick={() => run(() => accountRevokeMember(id))}
        >
          Remove
        </Button>
      </div>
    );
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
